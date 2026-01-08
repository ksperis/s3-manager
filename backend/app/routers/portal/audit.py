# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.models.audit import AuditLogEntry, AuditLogListResponse
from app.routers.dependencies import get_audit_logger
from app.routers.portal.dependencies import PortalContext, require_portal_permission
from app.services.audit_service import AuditService


router = APIRouter()


@router.get("/audit/logs", response_model=AuditLogListResponse)
def list_portal_audit_logs(
    limit: int = Query(200, ge=1, le=500),
    cursor: Optional[int] = Query(None, description="Use the id from the last entry of the previous page"),
    search: Optional[str] = Query(None, description="Search by actor, action, or target"),
    ctx: PortalContext = Depends(require_portal_permission("portal.audit.view")),
    audit_service: AuditService = Depends(get_audit_logger),
) -> AuditLogListResponse:
    effective_limit = min(max(limit, 1), 500)
    logs = audit_service.list_logs(
        limit=effective_limit,
        scope="portal",
        account_id=ctx.account.id,
        cursor=cursor,
        search=search,
    )
    entries = [AuditLogEntry(**audit_service.serialize_log(item)) for item in logs]
    next_cursor = entries[-1].id if entries and len(entries) == effective_limit else None
    return AuditLogListResponse(logs=entries, next_cursor=next_cursor)

