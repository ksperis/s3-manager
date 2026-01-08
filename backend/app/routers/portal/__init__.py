# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter

from app.routers.portal import accounts, access, audit, browser, buckets, context, members


router = APIRouter(prefix="/portal", tags=["portal"])

router.include_router(accounts.router)
router.include_router(context.router)
router.include_router(members.router)
router.include_router(audit.router)
router.include_router(browser.router)
router.include_router(access.router)
router.include_router(buckets.router)
