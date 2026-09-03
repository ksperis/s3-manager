# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Aggregate Ceph Admin bucket configuration feature routers."""

from fastapi import APIRouter

from app.routers.ceph_admin import (
    bucket_config_access,
    bucket_config_core,
    bucket_config_rules,
)

router = APIRouter()
router.include_router(bucket_config_core.router)
router.include_router(bucket_config_access.router)
router.include_router(bucket_config_rules.router)
