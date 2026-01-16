# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import json
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db.s3_connection import S3Connection as DBS3Connection
from app.models.s3_connection import S3Connection, S3ConnectionCreate, S3ConnectionUpdate


class S3ConnectionsService:
    """CRUD for user-scoped S3 connections.

    This intentionally keeps things simple (private-by-default) and does not
    attempt to infer IAM/account concepts.
    """

    def __init__(self, db: Session):
        self.db = db

    def list_for_user(self, user_id: int) -> list[S3Connection]:
        rows = (
            self.db.query(DBS3Connection)
            .filter(DBS3Connection.owner_user_id == user_id)
            .order_by(DBS3Connection.name.asc())
            .all()
        )
        return [self._to_model(r) for r in rows]

    def get(self, user_id: int, connection_id: int) -> DBS3Connection:
        row = (
            self.db.query(DBS3Connection)
            .filter(DBS3Connection.owner_user_id == user_id, DBS3Connection.id == connection_id)
            .first()
        )
        if not row:
            raise KeyError("S3Connection not found")
        return row

    def create(self, user_id: int, payload: S3ConnectionCreate) -> S3Connection:
        row = DBS3Connection(
            owner_user_id=user_id,
            name=payload.name,
            provider_hint=payload.provider_hint,
            endpoint_url=payload.endpoint_url.rstrip("/"),
            region=payload.region,
            access_key_id=payload.access_key_id,
            secret_access_key=payload.secret_access_key,
            force_path_style=bool(payload.force_path_style),
            verify_tls=bool(payload.verify_tls),
            capabilities_json=json.dumps({}),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return self._to_model(row)

    def update(self, user_id: int, connection_id: int, payload: S3ConnectionUpdate) -> S3Connection:
        row = self.get(user_id, connection_id)
        if payload.name is not None:
            row.name = payload.name
        if payload.provider_hint is not None:
            row.provider_hint = payload.provider_hint
        if payload.endpoint_url is not None:
            row.endpoint_url = payload.endpoint_url.rstrip("/")
        if payload.region is not None:
            row.region = payload.region
        if payload.access_key_id is not None:
            row.access_key_id = payload.access_key_id
        if payload.secret_access_key is not None:
            row.secret_access_key = payload.secret_access_key
        if payload.force_path_style is not None:
            row.force_path_style = bool(payload.force_path_style)
        if payload.verify_tls is not None:
            row.verify_tls = bool(payload.verify_tls)
        row.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(row)
        return self._to_model(row)

    def delete(self, user_id: int, connection_id: int) -> None:
        row = self.get(user_id, connection_id)
        self.db.delete(row)
        self.db.commit()

    def get_capabilities(self, user_id: int, connection_id: int) -> dict[str, Any]:
        row = self.get(user_id, connection_id)
        return self._parse_capabilities(row.capabilities_json)

    def set_capabilities(self, user_id: int, connection_id: int, caps: dict[str, Any]) -> None:
        row = self.get(user_id, connection_id)
        row.capabilities_json = json.dumps(caps)
        row.updated_at = datetime.utcnow()
        self.db.commit()

    def _parse_capabilities(self, value: Optional[str]) -> dict[str, Any]:
        if not value:
            return {}
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}

    def _to_model(self, row: DBS3Connection) -> S3Connection:
        return S3Connection(
            id=row.id,
            name=row.name,
            provider_hint=row.provider_hint,
            endpoint_url=row.endpoint_url,
            region=row.region,
            access_key_id=row.access_key_id,
            force_path_style=bool(row.force_path_style),
            verify_tls=bool(row.verify_tls),
            capabilities=self._parse_capabilities(row.capabilities_json),
            created_at=row.created_at,
            updated_at=row.updated_at,
            last_used_at=row.last_used_at,
        )
