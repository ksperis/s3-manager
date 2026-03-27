# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.exception_handlers import http_exception_handler as fastapi_http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from botocore.exceptions import ClientError

from app.core.config import collect_secret_warnings, get_settings, has_non_local_cors_origins
from app.core.database import engine, SessionLocal
from app.core.db_init import init_db
from app.routers import auth, users, settings as public_settings, browser as user_browser
from app.routers import execution_contexts
from app.routers import connections as user_connections
from app.routers.admin import s3_accounts as admin_s3_accounts
from app.routers.admin import audit as admin_audit
from app.routers.admin import stats as admin_stats
from app.routers.admin import billing as admin_billing
from app.routers.admin import users as admin_users
from app.routers.admin import s3_users as admin_s3_users
from app.routers.admin import s3_connections as admin_s3_connections
from app.routers.admin import tag_definitions as admin_tag_definitions
from app.routers.admin import storage_endpoints as admin_storage_endpoints
from app.routers.admin import settings as admin_settings
from app.routers.admin import key_rotation as admin_key_rotation
from app.routers.admin import onboarding as admin_onboarding
from app.routers.admin import automation as admin_automation
from app.routers.admin import healthchecks as admin_healthchecks
from app.routers.ceph_admin import endpoints as ceph_admin_endpoints
from app.routers.ceph_admin import accounts as ceph_admin_accounts
from app.routers.ceph_admin import users as ceph_admin_users
from app.routers.ceph_admin import buckets as ceph_admin_buckets
from app.routers.ceph_admin import metrics as ceph_admin_metrics
from app.routers.storage_ops import buckets as storage_ops_buckets
from app.routers.internal import billing_collect as internal_billing
from app.routers.internal import healthchecks as internal_healthchecks
from app.routers.internal import quota_monitor as internal_quota_monitor
from app.routers.internal import s3_connections as internal_s3_connections
from app.routers.manager import s3_accounts as manager_accounts
from app.routers.manager import buckets as manager_buckets
from app.routers.manager import context as manager_context
from app.routers.manager import ceph_keys as manager_ceph_keys
from app.routers.manager import iam_groups, iam_roles, iam_users
from app.routers.manager import iam_overview
from app.routers.manager import objects as manager_objects
from app.routers.manager import iam_policies as manager_iam_policies
from app.routers.manager import topics as manager_topics
from app.routers.manager import stats as manager_stats
from app.routers.manager import migrations as manager_migrations
from app.services.bucket_migration_service import get_bucket_migration_worker
from app.routers.dependencies import (
    require_browser_enabled,
    require_ceph_admin_enabled,
    require_manager_context_enabled,
    require_manager_enabled,
    require_storage_ops_enabled,
)

settings = get_settings()

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
for noisy_logger in ("boto3", "botocore", "s3transfer", "urllib3"):
    logging.getLogger(noisy_logger).setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


def _startup_security_warnings() -> list[str]:
    warnings = collect_secret_warnings(settings)
    if not settings.refresh_token_cookie_secure and has_non_local_cors_origins(settings.cors_origins):
        warnings.append(
            "REFRESH_TOKEN_COOKIE_SECURE=false while non-local CORS origins are configured. "
            "Production deployments should enable secure refresh cookies."
        )
    return warnings


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db(engine, SessionLocal)
    for warning_message in _startup_security_warnings():
        logger.warning(warning_message)
    worker = None
    if settings.bucket_migration_worker_enabled:
        worker = get_bucket_migration_worker(SessionLocal)
        worker.start()
    try:
        yield
    finally:
        if worker:
            worker.stop()


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {"status": "ok"}


# API routers
app.include_router(auth.router, prefix=settings.api_v1_prefix)
app.include_router(users.router, prefix=settings.api_v1_prefix)
app.include_router(execution_contexts.router, prefix=settings.api_v1_prefix)
app.include_router(user_connections.router, prefix=settings.api_v1_prefix)
app.include_router(public_settings.router, prefix=settings.api_v1_prefix)
app.include_router(admin_s3_accounts.router, prefix=settings.api_v1_prefix)
app.include_router(admin_s3_users.router, prefix=settings.api_v1_prefix)
app.include_router(admin_s3_connections.router, prefix=settings.api_v1_prefix)
app.include_router(admin_tag_definitions.router, prefix=settings.api_v1_prefix)
app.include_router(admin_audit.router, prefix=settings.api_v1_prefix)
app.include_router(admin_stats.router, prefix=settings.api_v1_prefix)
app.include_router(admin_billing.router, prefix=settings.api_v1_prefix)
app.include_router(admin_users.router, prefix=settings.api_v1_prefix)
app.include_router(admin_storage_endpoints.router, prefix=settings.api_v1_prefix)
app.include_router(admin_settings.router, prefix=settings.api_v1_prefix)
app.include_router(admin_key_rotation.router, prefix=settings.api_v1_prefix)
app.include_router(admin_onboarding.router, prefix=settings.api_v1_prefix)
app.include_router(admin_automation.router, prefix=settings.api_v1_prefix)
app.include_router(admin_healthchecks.router, prefix=settings.api_v1_prefix)
app.include_router(ceph_admin_endpoints.router, prefix=settings.api_v1_prefix, dependencies=[Depends(require_ceph_admin_enabled)])
app.include_router(ceph_admin_accounts.router, prefix=settings.api_v1_prefix, dependencies=[Depends(require_ceph_admin_enabled)])
app.include_router(ceph_admin_users.router, prefix=settings.api_v1_prefix, dependencies=[Depends(require_ceph_admin_enabled)])
app.include_router(ceph_admin_buckets.router, prefix=settings.api_v1_prefix, dependencies=[Depends(require_ceph_admin_enabled)])
app.include_router(ceph_admin_metrics.router, prefix=settings.api_v1_prefix, dependencies=[Depends(require_ceph_admin_enabled)])
app.include_router(storage_ops_buckets.router, prefix=settings.api_v1_prefix, dependencies=[Depends(require_storage_ops_enabled)])
app.include_router(internal_billing.router, prefix=settings.api_v1_prefix)
app.include_router(internal_healthchecks.router, prefix=settings.api_v1_prefix)
app.include_router(internal_quota_monitor.router, prefix=settings.api_v1_prefix)
app.include_router(internal_s3_connections.router, prefix=settings.api_v1_prefix)
app.include_router(
    manager_accounts.router,
    prefix=settings.api_v1_prefix,
    dependencies=[Depends(require_manager_context_enabled)],
)
app.include_router(
    manager_context.router,
    prefix=settings.api_v1_prefix,
    dependencies=[Depends(require_manager_context_enabled)],
)
app.include_router(
    manager_ceph_keys.router,
    prefix=settings.api_v1_prefix,
    dependencies=[Depends(require_manager_enabled)],
)
app.include_router(
    manager_buckets.router,
    prefix=settings.api_v1_prefix,
    dependencies=[Depends(require_manager_enabled)],
)
app.include_router(
    user_browser.router,
    prefix=settings.api_v1_prefix,
    dependencies=[Depends(require_browser_enabled)],
)
app.include_router(
    iam_users.router,
    prefix=settings.api_v1_prefix,
    dependencies=[Depends(require_manager_enabled)],
)
app.include_router(
    iam_groups.router,
    prefix=settings.api_v1_prefix,
    dependencies=[Depends(require_manager_enabled)],
)
app.include_router(
    iam_roles.router,
    prefix=settings.api_v1_prefix,
    dependencies=[Depends(require_manager_enabled)],
)
app.include_router(
    iam_overview.router,
    prefix=settings.api_v1_prefix,
    dependencies=[Depends(require_manager_enabled)],
)
app.include_router(
    manager_objects.router,
    prefix=settings.api_v1_prefix,
    dependencies=[Depends(require_manager_enabled)],
)
app.include_router(
    manager_iam_policies.router,
    prefix=settings.api_v1_prefix,
    dependencies=[Depends(require_manager_enabled)],
)
app.include_router(
    manager_topics.router,
    prefix=settings.api_v1_prefix,
    dependencies=[Depends(require_manager_enabled)],
)
app.include_router(
    manager_stats.router,
    prefix=settings.api_v1_prefix,
    dependencies=[Depends(require_manager_enabled)],
)
app.include_router(
    manager_migrations.router,
    prefix=settings.api_v1_prefix,
    dependencies=[Depends(require_manager_enabled)],
)


@app.exception_handler(StarletteHTTPException)
async def log_http_exceptions(request: Request, exc: StarletteHTTPException):
    if exc.status_code >= 500:
        cause = exc.__cause__
        while cause and not isinstance(cause, ClientError):
            cause = cause.__cause__
        error_code = None
        if isinstance(cause, ClientError):
            error_code = cause.response.get("Error", {}).get("Code")
        if error_code == "AccessDenied":
            logger.error(
                "Request %s %s responded with %s: %s",
                request.method,
                request.url.path,
                exc.status_code,
                exc.detail,
            )
        else:
            logger.error(
                "Request %s %s responded with %s: %s",
                request.method,
                request.url.path,
                exc.status_code,
                exc.detail,
                exc_info=exc.__cause__ or exc,
            )
    return await fastapi_http_exception_handler(request, exc)
