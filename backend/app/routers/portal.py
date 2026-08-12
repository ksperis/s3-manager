# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, User
from app.models.access_context import AccountAccess
from app.routers.dependencies import get_portal_account_access
from app.routers import (
    portal_access_keys,
    portal_access_logs,
    portal_collaboration,
    portal_context,
    portal_monitoring,
    portal_objects,
    portal_sharing,
    portal_storage_spaces,
    portal_usage,
)
from app.utils.http_errors import (
    raise_bad_gateway_from_runtime,
    raise_http_exception_from_exception,
)
from app.services.portal_service import (
    PortalService,
    get_portal_service,
)
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.s3_endpoint import resolve_s3_endpoint
from app.services.traffic_service import TrafficService, TrafficWindow, WINDOW_RESOLUTION_LABELS, WINDOW_DELTAS
from app.services.rgw_admin import RGWAdminError
from app.services.billing_service import BillingService
from app.services.app_settings_service import load_app_settings
from app.models.billing import BillingSubjectDetail
router = APIRouter(prefix="/portal", tags=["portal"])
router.include_router(portal_access_keys.router)
router.include_router(portal_access_logs.router)
router.include_router(portal_collaboration.router)
router.include_router(portal_context.router)
router.include_router(portal_monitoring.router)
router.include_router(portal_objects.router)
router.include_router(portal_sharing.router)
router.include_router(portal_storage_spaces.router)
router.include_router(portal_usage.router)


@router.get("/billing/me", response_model=BillingSubjectDetail)
def portal_billing_me(
    month: str = Query(..., description="YYYY-MM"),
    access: AccountAccess = Depends(get_portal_account_access),
    db: Session = Depends(get_db),
) -> BillingSubjectDetail:
    app_settings = load_app_settings()
    if not app_settings.general.billing_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Billing is disabled")
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    account = access.account
    if account.storage_endpoint_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Storage endpoint is not configured")
    service = BillingService(db)
    try:
        return service.subject_detail(month, account.storage_endpoint_id, "account", account.id)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)


@router.get("/traffic")
def portal_traffic(
    window: TrafficWindow = Query(TrafficWindow.WEEK),
    bucket: Optional[str] = Query(None),
    access: AccountAccess = Depends(get_portal_account_access),
    portal_service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> dict:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    account = access.account
    endpoint = getattr(account, "storage_endpoint", None)
    if endpoint and not resolve_feature_flags(endpoint).usage_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage logs are disabled for this endpoint")
    requested_bucket = (bucket or "").strip()
    allowed_buckets = set(portal_service.list_existing_user_bucket_access(actor, account, access.role))
    if requested_bucket and requested_bucket not in allowed_buckets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket access not allowed for this role.")
    bucket_filters: Optional[set[str]] = None
    if requested_bucket:
        bucket = requested_bucket
    else:
        bucket = None
        bucket_filters = allowed_buckets
    try:
        traffic_service = TrafficService(account)
    except ValueError as exc:
        raise_bad_gateway_from_runtime(exc)
    try:
        return traffic_service.get_traffic(window=window, bucket=bucket, bucket_filters=bucket_filters)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
