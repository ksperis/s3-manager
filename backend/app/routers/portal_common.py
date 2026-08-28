# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Shared dependencies and HTTP error translation for Portal routers."""

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.sensitive_data import sanitize_error_detail
from app.services.portal_service import PortalService, get_portal_service
from app.utils.http_errors import raise_bad_gateway_from_runtime


def get_portal_service_dependency(
    db: Session = Depends(get_db),
) -> PortalService:
    return get_portal_service(db)


def raise_portal_storage_runtime(exc: RuntimeError) -> None:
    detail = sanitize_error_detail(str(exc))
    lowered = detail.lower()
    if "not found or not allowed" in lowered:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from exc
    if "not found" in lowered:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from exc
    if "storage space is archived" in lowered:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc
    if (
        "not allowed" in lowered
        or "not provisioned" in lowered
        or "full management access required" in lowered
        or "full content access required" in lowered
        or "only project managers" in lowered
        or "portal manager rights required" in lowered
        or "ownership applies only" in lowered
        or "already own" in lowered
        or "cannot be changed" in lowered
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail) from exc
    raise_bad_gateway_from_runtime(exc)
