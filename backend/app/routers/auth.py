# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Aggregate authentication routers."""

from fastapi import APIRouter

from app.routers import (
    auth_api_tokens,
    auth_ldap,
    auth_local,
    auth_mfa,
    auth_oidc,
    auth_s3,
    auth_sessions,
)

router = APIRouter(prefix="/auth", tags=["auth"])
router.include_router(auth_api_tokens.router)
router.include_router(auth_local.router)
router.include_router(auth_ldap.router)
router.include_router(auth_s3.router)
router.include_router(auth_oidc.router)
router.include_router(auth_mfa.router)
router.include_router(auth_sessions.router)
