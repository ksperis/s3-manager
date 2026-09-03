# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Bucket configuration routes for the Manager workspace."""

from fastapi import APIRouter

from app.routers.manager import (
    bucket_config_access,
    bucket_config_core,
    bucket_config_rules,
)

router = APIRouter()
router.include_router(bucket_config_core.router)
router.include_router(bucket_config_access.router)
router.include_router(bucket_config_rules.router)
