# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import ApiToken, User
from app.models.api_token import ApiTokenCreateRequest, ApiTokenCreateResponse, ApiTokenInfo
from app.routers.dependencies import get_audit_service, get_current_super_admin
from app.services.api_token_service import ApiTokenError, ApiTokenNotFoundError, ApiTokenService
from app.services.audit_service import AuditService
from app.services.identity_security_policy import (
    require_admin_interactive_session,
    require_admin_sensitive_action,
)
from app.utils.http_errors import raise_http_exception_from_exception


router = APIRouter()


def _to_api_token_info(row: ApiToken) -> ApiTokenInfo:
    return ApiTokenInfo(
        id=row.id,
        name=row.name,
        created_at=row.created_at,
        last_used_at=row.last_used_at,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
        scopes=json.loads(row.scopes_json or "[]"),
    )


@router.get("/api-tokens", response_model=list[ApiTokenInfo])
def list_api_tokens(
    request: Request,
    include_revoked: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
) -> list[ApiTokenInfo]:
    require_admin_interactive_session(request, db, current_user)
    return [
        _to_api_token_info(row)
        for row in ApiTokenService(db).list_for_user(current_user.id, include_revoked=include_revoked)
    ]


@router.post("/api-tokens", response_model=ApiTokenCreateResponse, status_code=status.HTTP_201_CREATED)
def create_api_token(
    request: Request,
    payload: ApiTokenCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> ApiTokenCreateResponse:
    require_admin_sensitive_action(request, db, current_user)
    try:
        token, row = ApiTokenService(db).create_for_user(
            current_user,
            name=payload.name,
            scopes=payload.scopes,
            expires_in_days=payload.expires_in_days,
        )
    except ApiTokenError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)
    audit_service.record_action(
        user=current_user,
        scope="auth",
        action="create_api_token",
        entity_type="api_token",
        entity_id=row.id,
        metadata={"name": row.name, "scopes": payload.scopes, "expires_at": row.expires_at.isoformat()},
    )
    return ApiTokenCreateResponse(access_token=token, api_token=_to_api_token_info(row))


@router.delete("/api-tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_api_token(
    request: Request,
    token_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    require_admin_interactive_session(request, db, current_user)
    try:
        row = ApiTokenService(db).revoke_for_user(user_id=current_user.id, token_id=token_id)
    except ApiTokenNotFoundError as exc:
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)
    audit_service.record_action(
        user=current_user,
        scope="auth",
        action="revoke_api_token",
        entity_type="api_token",
        entity_id=row.id,
        metadata={"name": row.name},
    )
