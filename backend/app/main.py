# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging

from fastapi import Depends, FastAPI, Request
from fastapi.exception_handlers import http_exception_handler as fastapi_http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from botocore.exceptions import ClientError

from app.core.config import get_settings
from app.core.database import engine, SessionLocal
from app.core.db_init import init_db
from app.routers import auth, users, portal, settings as public_settings, browser as user_browser
from app.routers import connections as user_connections
from app.routers.admin import s3_accounts as admin_s3_accounts
from app.routers.admin import audit as admin_audit
from app.routers.admin import stats as admin_stats
from app.routers.admin import users as admin_users
from app.routers.admin import s3_users as admin_s3_users
from app.routers.admin import s3_connections as admin_s3_connections
from app.routers.admin import storage_endpoints as admin_storage_endpoints
from app.routers.admin import settings as admin_settings
from app.routers.admin import onboarding as admin_onboarding
from app.routers.manager import s3_accounts as manager_accounts
from app.routers.manager import browser as manager_browser
from app.routers.manager import buckets as manager_buckets
from app.routers.manager import context as manager_context
from app.routers.manager import iam_groups, iam_roles, iam_users
from app.routers.manager import iam_overview
from app.routers.manager import objects as manager_objects
from app.routers.manager import iam_policies as manager_iam_policies
from app.routers.manager import topics as manager_topics
from app.routers.manager import stats as manager_stats
from app.routers.dependencies import (
    require_browser_enabled,
    require_manager_context_enabled,
    require_manager_enabled,
    require_portal_enabled,
)

settings = get_settings()

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
for noisy_logger in ("boto3", "botocore", "s3transfer", "urllib3"):
    logging.getLogger(noisy_logger).setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db(engine, SessionLocal)


@app.get("/health")
def health_check():
    return {"status": "ok"}


# API routers
app.include_router(auth.router, prefix=settings.api_v1_prefix)
app.include_router(users.router, prefix=settings.api_v1_prefix)
app.include_router(user_connections.router, prefix=settings.api_v1_prefix)
app.include_router(portal.router, prefix=settings.api_v1_prefix, dependencies=[Depends(require_portal_enabled)])
app.include_router(public_settings.router, prefix=settings.api_v1_prefix)
app.include_router(admin_s3_accounts.router, prefix=settings.api_v1_prefix)
app.include_router(admin_s3_users.router, prefix=settings.api_v1_prefix)
app.include_router(admin_s3_connections.router, prefix=settings.api_v1_prefix)
app.include_router(admin_audit.router, prefix=settings.api_v1_prefix)
app.include_router(admin_stats.router, prefix=settings.api_v1_prefix)
app.include_router(admin_users.router, prefix=settings.api_v1_prefix)
app.include_router(admin_storage_endpoints.router, prefix=settings.api_v1_prefix)
app.include_router(admin_settings.router, prefix=settings.api_v1_prefix)
app.include_router(admin_onboarding.router, prefix=settings.api_v1_prefix)
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
    manager_buckets.router,
    prefix=settings.api_v1_prefix,
    dependencies=[Depends(require_manager_enabled)],
)
app.include_router(
    manager_browser.router,
    prefix=settings.api_v1_prefix,
    dependencies=[Depends(require_browser_enabled)],
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
