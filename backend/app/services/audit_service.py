# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import String, cast, func, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitize_audit_metadata
from app.db import AuditLog, User
from app.models.access_context import ManagerActor
from app.services.s3_execution_context import S3ExecutionTarget
from app.services.audit_policy import should_persist_audit_action

logger = logging.getLogger(__name__)

MAX_AUDIT_METADATA_LENGTH = 16384


def parse_audit_metadata(metadata_json: Optional[str]) -> Optional[dict[str, Any]]:
    if metadata_json is None:
        return None
    value = json.loads(metadata_json)
    if not isinstance(value, dict):
        raise ValueError("Persisted audit metadata must be a JSON object")
    return value


def _truncate_audit_metadata(serialized: str) -> str:
    lower = 0
    upper = len(serialized)
    best = ""
    while lower <= upper:
        preview_length = (lower + upper) // 2
        candidate = json.dumps(
            {
                "truncated": True,
                "original_length": len(serialized),
                "preview": serialized[:preview_length],
            },
            separators=(",", ":"),
        )
        if len(candidate) <= MAX_AUDIT_METADATA_LENGTH:
            best = candidate
            lower = preview_length + 1
        else:
            upper = preview_length - 1
    return best


class AuditService:
    def __init__(self, db: Session) -> None:
        self.db = db

    @staticmethod
    def _resolve_account_reference(
        account: Optional[S3ExecutionTarget],
        account_id: Optional[int],
        account_name: Optional[str],
    ) -> tuple[Optional[int], Optional[str]]:
        if account is None:
            resolved_account_id = account_id if isinstance(account_id, int) and account_id > 0 else None
            return resolved_account_id, account_name

        resolved_account_name = account.name if account.name else account_name
        raw_account_id = getattr(account, "id", None)
        if isinstance(raw_account_id, int) and raw_account_id > 0:
            return raw_account_id, resolved_account_name
        return None, resolved_account_name

    def record_action(
        self,
        *,
        user: Optional[ManagerActor],
        scope: str,
        action: str,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        account: Optional[S3ExecutionTarget] = None,
        account_id: Optional[int] = None,
        account_name: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
        status: str = "success",
        message: Optional[str] = None,
        user_email: Optional[str] = None,
        user_role: Optional[str] = None,
        request_id: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> None:
        if not should_persist_audit_action(action):
            return

        resolved_account_id, resolved_account_name = self._resolve_account_reference(
            account,
            account_id,
            account_name,
        )
        resolved_user_email = user.email if user else (user_email or "unknown")
        resolved_user_role = user.role if user else (user_role or "unknown")
        resolved_user_id = user.id if isinstance(user, User) else None

        payload = AuditLog(
            user_id=resolved_user_id,
            user_email=resolved_user_email,
            user_role=resolved_user_role,
            scope=scope,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            account_id=resolved_account_id,
            account_name=resolved_account_name,
            status=status,
            message=message,
            metadata_json=self._serialize_metadata(metadata),
            request_id=request_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        self.db.add(payload)
        try:
            self.db.commit()
        except SQLAlchemyError as exc:
            self.db.rollback()
            logger.warning("Failed to persist audit log for action %s: %s", action, exc)

    def list_logs(
        self,
        *,
        limit: int = 200,
        scope: Optional[str] = None,
        role: Optional[str] = None,
        account_id: Optional[int] = None,
        cursor: Optional[int] = None,
        search: Optional[str] = None,
    ) -> list[AuditLog]:
        query = self.db.query(AuditLog)
        if scope:
            query = query.filter(AuditLog.scope == scope)
        if role:
            query = query.filter(AuditLog.user_role == role)
        if account_id is not None:
            query = query.filter(AuditLog.account_id == account_id)
        if cursor:
            query = query.filter(AuditLog.id < cursor)
        if search:
            trimmed = search.strip()
            if trimmed:
                pattern = f"%{trimmed}%"
                query = query.filter(
                    or_(
                        AuditLog.user_email.ilike(pattern),
                        AuditLog.user_role.ilike(pattern),
                        AuditLog.scope.ilike(pattern),
                        AuditLog.action.ilike(pattern),
                        AuditLog.entity_type.ilike(pattern),
                        AuditLog.entity_id.ilike(pattern),
                        AuditLog.account_name.ilike(pattern),
                        cast(AuditLog.account_id, String).ilike(pattern),
                        AuditLog.status.ilike(pattern),
                        AuditLog.message.ilike(pattern),
                        AuditLog.metadata_json.ilike(pattern),
                    )
                )
        sliced_limit = min(max(limit, 1), 500)
        return (
            query.order_by(AuditLog.id.desc())
            .limit(sliced_limit)
            .all()
        )

    def count_recent_actions(
        self,
        *,
        action: str,
        since: datetime,
        user_email: Optional[str] = None,
        ip_address: Optional[str] = None,
        status: Optional[str] = None,
    ) -> int:
        query = self.db.query(func.count(AuditLog.id)).filter(
            AuditLog.action == action,
            AuditLog.created_at >= since,
        )
        if user_email is not None:
            query = query.filter(AuditLog.user_email == user_email)
        if ip_address is not None:
            query = query.filter(AuditLog.ip_address == ip_address)
        if status is not None:
            query = query.filter(AuditLog.status == status)
        return int(query.scalar() or 0)

    def serialize_log(self, log: AuditLog) -> dict[str, Any]:
        return {
            "id": log.id,
            "created_at": log.created_at,
            "user_email": log.user_email,
            "user_role": log.user_role,
            "scope": log.scope,
            "action": log.action,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "account_id": log.account_id,
            "account_name": log.account_name,
            "status": log.status,
            "message": log.message,
            "metadata": parse_audit_metadata(log.metadata_json),
        }

    def _serialize_metadata(self, metadata: Optional[dict[str, Any]]) -> Optional[str]:
        if not metadata:
            return None
        sanitized_metadata = sanitize_audit_metadata(metadata)
        try:
            serialized = json.dumps(sanitized_metadata, default=self._fallback_encoder)
        except (TypeError, ValueError):
            serialized = json.dumps({"raw": sanitize_audit_metadata(str(metadata))})
        if len(serialized) > MAX_AUDIT_METADATA_LENGTH:
            return _truncate_audit_metadata(serialized)
        return serialized

    @staticmethod
    def _fallback_encoder(value: Any) -> str:
        return str(value)
