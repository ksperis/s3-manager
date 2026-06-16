# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.db import S3Account
from app.models.manager_activity import ManagerActivityEntry
from app.routers.dependencies import get_account_context, get_audit_logger
from app.services.audit_service import AuditService

router = APIRouter(prefix="/manager/activity", tags=["manager-activity"])


@router.get("", response_model=list[ManagerActivityEntry])
def list_manager_activity(
    limit: int = Query(5, ge=1, le=20),
    account: S3Account = Depends(get_account_context),
    audit_service: AuditService = Depends(get_audit_logger),
) -> list[ManagerActivityEntry]:
    account_id = account.id if isinstance(account.id, int) and account.id > 0 else None
    if account_id is None:
        return []

    logs = audit_service.list_logs(limit=limit, scope="manager", account_id=account_id)
    return [
        ManagerActivityEntry(
            id=log.id,
            created_at=log.created_at,
            action=log.action,
            entity_type=log.entity_type,
            entity_id=log.entity_id,
            account_id=log.account_id,
            account_name=log.account_name,
            status=log.status,
            user_email=log.user_email,
        )
        for log in logs
    ]
