# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Bucket configuration routes for the Browser workspace."""

from fastapi import APIRouter

from app.routers import (
    browser_bucket_config_access,
    browser_bucket_config_core,
    browser_bucket_config_rules,
)

router = APIRouter()
router.include_router(browser_bucket_config_core.router)
router.include_router(browser_bucket_config_access.router)
router.include_router(browser_bucket_config_rules.router)
