# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.database import engine, SessionLocal
from app.core.db_init import init_db
from app.routers import auth, users, portal
from app.routers.admin import s3_accounts as admin_s3_accounts
from app.routers.admin import audit as admin_audit
from app.routers.admin import stats as admin_stats
from app.routers.admin import users as admin_users
from app.routers.admin import s3_users as admin_s3_users
from app.routers.admin import storage_endpoints as admin_storage_endpoints
from app.routers.admin import settings as admin_settings
from app.routers.manager import s3_accounts as manager_accounts
from app.routers.manager import buckets as manager_buckets
from app.routers.manager import context as manager_context
from app.routers.manager import iam_groups, iam_roles, iam_users
from app.routers.manager import iam_overview
from app.routers.manager import objects as manager_objects
from app.routers.manager import iam_policies as manager_iam_policies
from app.routers.manager import topics as manager_topics
from app.routers.manager import stats as manager_stats

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
app.include_router(portal.router, prefix=settings.api_v1_prefix)
app.include_router(admin_s3_accounts.router, prefix=settings.api_v1_prefix)
app.include_router(admin_s3_users.router, prefix=settings.api_v1_prefix)
app.include_router(admin_audit.router, prefix=settings.api_v1_prefix)
app.include_router(admin_stats.router, prefix=settings.api_v1_prefix)
app.include_router(admin_users.router, prefix=settings.api_v1_prefix)
app.include_router(admin_storage_endpoints.router, prefix=settings.api_v1_prefix)
app.include_router(admin_settings.router, prefix=settings.api_v1_prefix)
app.include_router(manager_accounts.router, prefix=settings.api_v1_prefix)
app.include_router(manager_context.router, prefix=settings.api_v1_prefix)
app.include_router(manager_buckets.router, prefix=settings.api_v1_prefix)
app.include_router(iam_users.router, prefix=settings.api_v1_prefix)
app.include_router(iam_groups.router, prefix=settings.api_v1_prefix)
app.include_router(iam_roles.router, prefix=settings.api_v1_prefix)
app.include_router(iam_overview.router, prefix=settings.api_v1_prefix)
app.include_router(manager_objects.router, prefix=settings.api_v1_prefix)
app.include_router(manager_iam_policies.router, prefix=settings.api_v1_prefix)
app.include_router(manager_topics.router, prefix=settings.api_v1_prefix)
app.include_router(manager_stats.router, prefix=settings.api_v1_prefix)
