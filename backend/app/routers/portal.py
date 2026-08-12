# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal API composed from domain-specific sub-routers."""

from fastapi import APIRouter

from app.routers import (
    portal_access_keys,
    portal_access_logs,
    portal_billing,
    portal_collaboration,
    portal_context,
    portal_monitoring,
    portal_objects,
    portal_sharing,
    portal_storage_spaces,
    portal_traffic,
    portal_usage,
)

router = APIRouter(prefix="/portal", tags=["portal"])
router.include_router(portal_access_keys.router)
router.include_router(portal_access_logs.router)
router.include_router(portal_billing.router)
router.include_router(portal_collaboration.router)
router.include_router(portal_context.router)
router.include_router(portal_monitoring.router)
router.include_router(portal_objects.router)
router.include_router(portal_sharing.router)
router.include_router(portal_storage_spaces.router)
router.include_router(portal_traffic.router)
router.include_router(portal_usage.router)
