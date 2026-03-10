# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional, Union

from fastapi import HTTPException, status
from pydantic import BaseModel

from app.db import S3Account, User
from app.models.session import ManagerSessionPrincipal
from app.services.audit_service import AuditService
from app.utils.storage_endpoint_features import resolve_feature_flags

BrowserAuditActor = Union[User, ManagerSessionPrincipal]


class CreateFolderPayload(BaseModel):
    prefix: str


class ProxyUploadResponse(BaseModel):
    message: str
    key: str


class EnsureCorsPayload(BaseModel):
    origin: str


def require_sse_feature(account: S3Account) -> None:
    endpoint = getattr(account, "storage_endpoint", None)
    if endpoint is None:
        return
    if not resolve_feature_flags(endpoint).sse_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Server-side encryption is disabled for this endpoint",
        )


def record_browser_action(
    audit_service: AuditService,
    *,
    actor: BrowserAuditActor,
    scope: str,
    action: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    account: Optional[S3Account] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> None:
    if isinstance(actor, User):
        audit_service.record_action(
            user=actor,
            scope=scope,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            account=account,
            metadata=metadata,
        )
        return
    user_email, user_role = actor.audit_fallbacks()
    audit_service.record_action(
        user=None,
        user_email=user_email,
        user_role=user_role,
        scope=scope,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        account=account,
        metadata=metadata,
    )
