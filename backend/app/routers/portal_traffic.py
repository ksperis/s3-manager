# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal traffic endpoint."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.db import User
from app.models.access_context import AccountAccess
from app.routers.dependencies import get_portal_account_access
from app.routers.portal_common import get_portal_service_dependency
from app.services.portal_service import PortalService
from app.services.rgw_admin import RGWAdminError
from app.services.traffic_service import TrafficService, TrafficWindow
from app.utils.http_errors import raise_bad_gateway_from_runtime, raise_http_exception_from_exception
from app.utils.storage_endpoint_features import resolve_feature_flags

router = APIRouter()


@router.get("/traffic")
def portal_traffic(
    window: TrafficWindow = Query(TrafficWindow.WEEK),
    bucket: Optional[str] = Query(None),
    access: AccountAccess = Depends(get_portal_account_access),
    portal_service: PortalService = Depends(get_portal_service_dependency),
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
