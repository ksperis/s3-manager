# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from sqlalchemy import String, cast, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db_models import S3Account, AuditLog, User

logger = logging.getLogger(__name__)

_SENSITIVE_KEY_PARTS: tuple[str, ...] = (
    "password",
    "secret",
    "secret_key",
    "secret_access_key",
    "access_key",
    "access_key_id",
    "session_token",
    "token",
    "authorization",
    "jwt",
)


def _looks_sensitive_key(key: object) -> bool:
    if not isinstance(key, str):
        return False
    lowered = key.strip().lower()
    if not lowered:
        return False
    return any(part in lowered for part in _SENSITIVE_KEY_PARTS)


def _redact_secrets(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for k, v in value.items():
            if _looks_sensitive_key(k):
                sanitized[str(k)] = "[REDACTED]"
            else:
                sanitized[str(k)] = _redact_secrets(v)
        return sanitized
    if isinstance(value, (list, tuple)):
        return [_redact_secrets(v) for v in value]
    return value


class AuditService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def record_action(
        self,
        *,
        user: Optional[User],
        scope: str,
        action: str,
        surface: Optional[str] = None,
        workflow: Optional[str] = None,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        account: Optional[S3Account] = None,
        account_id: Optional[int] = None,
        account_name: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
        delta: Optional[dict[str, Any]] = None,
        executor_type: Optional[str] = None,
        executor_principal: Optional[str] = None,
        status: str = "success",
        message: Optional[str] = None,
        error: Optional[str] = None,
        user_email: Optional[str] = None,
        user_role: Optional[str] = None,
    ) -> None:
        resolved_account_id = account.id if account else account_id
        resolved_account_name = account.name if account else account_name
        resolved_user_email = user.email if user else (user_email or "unknown")
        resolved_user_role = user.role if user else (user_role or "unknown")

        sanitized_metadata = _redact_secrets(metadata) if metadata else None
        sanitized_delta = _redact_secrets(delta) if delta else None

        payload = AuditLog(
            user_id=user.id if user else None,
            user_email=resolved_user_email,
            user_role=resolved_user_role,
            scope=scope,
            action=action,
            surface=surface or scope,
            workflow=workflow or action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            account_id=resolved_account_id,
            account_name=resolved_account_name,
            executor_type=executor_type,
            executor_principal=executor_principal,
            status=status,
            message=message,
            metadata_json=self._serialize_metadata(sanitized_metadata),
            delta_json=self._serialize_metadata(sanitized_delta),
            error=error,
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

    def serialize_log(self, log: AuditLog) -> dict[str, Any]:
        return {
            "id": log.id,
            "created_at": log.created_at,
            "user_id": log.user_id,
            "user_email": log.user_email,
            "user_role": log.user_role,
            "scope": log.scope,
            "action": log.action,
            "surface": getattr(log, "surface", None),
            "workflow": getattr(log, "workflow", None),
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "account_id": log.account_id,
            "account_name": log.account_name,
            "executor_type": getattr(log, "executor_type", None),
            "executor_principal": getattr(log, "executor_principal", None),
            "status": log.status,
            "message": log.message,
            "metadata": self._deserialize_metadata(log.metadata_json),
            "delta": self._deserialize_metadata(getattr(log, "delta_json", None)),
            "error": getattr(log, "error", None),
        }

    def _serialize_metadata(self, metadata: Optional[dict[str, Any]]) -> Optional[str]:
        if not metadata:
            return None
        try:
            serialized = json.dumps(metadata, default=self._fallback_encoder)
        except (TypeError, ValueError):
            serialized = json.dumps({"raw": str(metadata)})
        # Guard against overly large payloads in SQLite/Text columns
        if len(serialized) > 16384:
            truncated = serialized[:16380] + "..."
            return truncated
        return serialized

    def _deserialize_metadata(self, metadata_json: Optional[str]) -> Optional[dict[str, Any]]:
        if not metadata_json:
            return None
        try:
            value = json.loads(metadata_json)
            return value if isinstance(value, dict) else {"value": value}
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _fallback_encoder(value: Any) -> str:
        return str(value)


def get_audit_service(db: Session) -> AuditService:
    return AuditService(db)
