# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal server access-log endpoints."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.core.database import get_db
from app.core.sensitive_data import sanitize_error_detail
from app.db import User
from app.models.access_context import AccountAccess
from app.models.portal import (
    PortalServerAccessLogEntry,
    PortalServerAccessLogFilterQuery,
    PortalServerAccessLogPage,
)
from app.routers.ceph_admin.listing_common import parse_filter_query
from app.routers.dependencies import require_portal_manager
from app.routers.portal_common import raise_portal_storage_runtime
from app.services.portal_service import PortalService, get_portal_service
from app.utils.http_headers import build_attachment_content_disposition

router = APIRouter()


def _parse_server_access_log_filter(raw: Optional[str]) -> Optional[PortalServerAccessLogFilterQuery]:
    return parse_filter_query(raw, query_cls=PortalServerAccessLogFilterQuery)


@router.get("/access-logs", response_model=list[PortalServerAccessLogEntry])
def portal_server_access_logs(
    date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    space_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    timezone_offset_minutes: int = Query(0, ge=-840, le=840),
    advanced_filter: Optional[str] = Query(None),
    access: AccountAccess = Depends(require_portal_manager),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalServerAccessLogEntry]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        parsed_filter = _parse_server_access_log_filter(advanced_filter)
        return service.list_portal_server_access_logs(
            actor,
            access,
            date=date,
            space_id=space_id,
            timezone_offset_minutes=timezone_offset_minutes,
            limit=limit,
            offset=offset,
            advanced_filter=parsed_filter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.get("/access-logs/page", response_model=PortalServerAccessLogPage)
def portal_server_access_logs_page(
    date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    space_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    timezone_offset_minutes: int = Query(0, ge=-840, le=840),
    advanced_filter: Optional[str] = Query(None),
    access: AccountAccess = Depends(require_portal_manager),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalServerAccessLogPage:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        parsed_filter = _parse_server_access_log_filter(advanced_filter)
        return service.list_portal_server_access_log_page(
            actor,
            access,
            date=date,
            space_id=space_id,
            timezone_offset_minutes=timezone_offset_minutes,
            limit=limit,
            offset=offset,
            advanced_filter=parsed_filter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.get("/access-logs/raw")
def portal_server_access_logs_raw(
    date_from: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    space_id: Optional[str] = Query(None),
    timezone_offset_minutes: int = Query(0, ge=-840, le=840),
    access: AccountAccess = Depends(require_portal_manager),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> Response:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        content = service.get_portal_server_access_logs_raw(
            actor,
            access,
            date_from=date_from,
            date_to=date_to,
            space_id=space_id,
            timezone_offset_minutes=timezone_offset_minutes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
    filename = (
        f"portal-server-access-logs-{date_from}.log"
        if date_from == date_to
        else f"portal-server-access-logs-{date_from}-{date_to}.log"
    )
    return Response(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": build_attachment_content_disposition(filename)},
    )
