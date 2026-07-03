# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import os
import socket
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import BackendOperationLease
from app.utils.time import utcnow


STARTUP_INIT_DB_OPERATION = "startup:init_db"
HEALTHCHECK_RUN_OPERATION = "healthchecks:run"
QUOTA_MONITOR_ALERTS_OPERATION = "quota-monitor:alerts"
USAGE_HISTORY_COLLECT_OPERATION = "quota-monitor:usage-history"


def billing_daily_operation_name(day_iso: str) -> str:
    return f"billing:daily:{day_iso}"


def default_operation_lease_ttl_seconds() -> int:
    return max(15, int(get_settings().operation_lease_ttl_seconds))


def billing_operation_lease_ttl_seconds() -> int:
    return max(60, int(get_settings().billing_operation_lease_ttl_seconds))


def generate_operation_owner(prefix: str = "backend") -> str:
    hostname = socket.gethostname() or "unknown-host"
    return f"{prefix}:{hostname}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


@dataclass(frozen=True)
class OperationLeaseHandle:
    operation_name: str
    owner: str
    lease_until: datetime


class OperationLeaseService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def acquire(
        self,
        operation_name: str,
        *,
        ttl_seconds: int,
        owner: Optional[str] = None,
        lease_context: Optional[dict[str, Any]] = None,
    ) -> Optional[OperationLeaseHandle]:
        name = self._normalize_operation_name(operation_name)
        lease_owner = owner or generate_operation_owner()
        now = utcnow()
        ttl = max(15, int(ttl_seconds))
        lease_until = now + timedelta(seconds=ttl)
        metadata_json = json.dumps(lease_context, ensure_ascii=True, sort_keys=True) if lease_context else None
        values = {
            BackendOperationLease.lease_owner: lease_owner,
            BackendOperationLease.lease_until: lease_until,
            BackendOperationLease.acquired_at: now,
            BackendOperationLease.updated_at: now,
            BackendOperationLease.metadata_json: metadata_json,
        }

        updated = (
            self.db.query(BackendOperationLease)
            .filter(
                BackendOperationLease.operation_name == name,
                or_(
                    BackendOperationLease.lease_until <= now,
                    BackendOperationLease.lease_owner == lease_owner,
                ),
            )
            .update(values, synchronize_session=False)
        )
        if updated == 1:
            self.db.commit()
            return OperationLeaseHandle(operation_name=name, owner=lease_owner, lease_until=lease_until)

        self.db.rollback()
        row = BackendOperationLease(
            operation_name=name,
            lease_owner=lease_owner,
            lease_until=lease_until,
            acquired_at=now,
            updated_at=now,
            metadata_json=metadata_json,
        )
        self.db.add(row)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            return None
        return OperationLeaseHandle(operation_name=name, owner=lease_owner, lease_until=lease_until)

    def release(self, handle: OperationLeaseHandle) -> None:
        now = utcnow()
        (
            self.db.query(BackendOperationLease)
            .filter(
                BackendOperationLease.operation_name == handle.operation_name,
                BackendOperationLease.lease_owner == handle.owner,
            )
            .update(
                {
                    BackendOperationLease.lease_until: now,
                    BackendOperationLease.updated_at: now,
                },
                synchronize_session=False,
            )
        )
        self.db.commit()

    def current_owner(self, operation_name: str) -> Optional[str]:
        name = self._normalize_operation_name(operation_name)
        now = utcnow()
        row = (
            self.db.query(BackendOperationLease.lease_owner)
            .filter(
                BackendOperationLease.operation_name == name,
                BackendOperationLease.lease_until > now,
            )
            .first()
        )
        return str(row[0]) if row else None

    @staticmethod
    def _normalize_operation_name(operation_name: str) -> str:
        normalized = str(operation_name or "").strip()
        if not normalized:
            raise ValueError("operation_name is required")
        return normalized
