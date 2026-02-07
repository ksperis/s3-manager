# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import json
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db.s3_connection import S3Connection as DBS3Connection, UserS3Connection
from app.models.s3_connection import S3Connection, S3ConnectionCreate, S3ConnectionUpdate
from app.utils.s3_connection_endpoint import (
    build_custom_endpoint_config,
    parse_custom_endpoint_config,
    resolve_connection_details,
)


class S3ConnectionsService:
    """CRUD for user-scoped S3 connections.

    This intentionally keeps things simple (private-by-default) and does not
    attempt to infer IAM/account concepts.
    """

    def __init__(self, db: Session):
        self.db = db

    def list_for_user(self, user_id: int) -> list[S3Connection]:
        """List connections visible to a UI user."""
        rows = (
            self.db.query(DBS3Connection)
            .outerjoin(UserS3Connection, UserS3Connection.s3_connection_id == DBS3Connection.id)
            .filter(
                DBS3Connection.is_temporary.is_(False),
                (DBS3Connection.is_public.is_(True))
                | (DBS3Connection.owner_user_id == user_id)
                | (UserS3Connection.user_id == user_id)
            )
            .distinct()
            .order_by(DBS3Connection.name.asc())
            .all()
        )
        return [self._to_model(r) for r in rows]

    def touch_last_used(self, user_id: int, connection_id: int) -> None:
        """Update last_used_at for UX/audit purposes.

        This is intentionally lightweight and does not record an audit event
        by itself (audit is handled at router/service call sites).
        """
        try:
            row = self.get_visible(user_id, connection_id)
        except KeyError:
            return
        row.last_used_at = datetime.utcnow()
        row.updated_at = datetime.utcnow()
        self.db.commit()

    def update_credentials(self, user_id: int, connection_id: int, *, access_key_id: str, secret_access_key: str) -> S3Connection:
        """Rotate credentials without mixing with metadata updates."""
        row = self.get_owned(user_id, connection_id)
        row.access_key_id = access_key_id
        row.secret_access_key = secret_access_key
        row.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(row)
        return self._to_model(row)

    def get_owned(self, user_id: int, connection_id: int) -> DBS3Connection:
        row = (
            self.db.query(DBS3Connection)
            .filter(DBS3Connection.owner_user_id == user_id, DBS3Connection.id == connection_id)
            .first()
        )
        if not row or row.is_temporary:
            raise KeyError("S3Connection not found")
        return row

    def get_visible(self, user_id: int, connection_id: int) -> DBS3Connection:
        row = self.db.query(DBS3Connection).filter(DBS3Connection.id == connection_id).first()
        if not row or row.is_temporary:
            raise KeyError("S3Connection not found")
        if not row.is_public and row.owner_user_id != user_id:
            link = (
                self.db.query(UserS3Connection)
                .filter(
                    UserS3Connection.user_id == user_id,
                    UserS3Connection.s3_connection_id == row.id,
                )
                .first()
            )
            if not link:
                raise KeyError("S3Connection not found")
        return row

    def create_temporary(
        self,
        *,
        owner_user_id: int,
        name: str,
        storage_endpoint_id: int,
        access_key_id: str,
        secret_access_key: str,
        session_token: Optional[str],
        expires_at: Optional[datetime],
        temp_user_uid: Optional[str],
        temp_access_key_id: Optional[str],
    ) -> DBS3Connection:
        now = datetime.utcnow()
        row = DBS3Connection(
            owner_user_id=owner_user_id,
            name=name,
            storage_endpoint_id=storage_endpoint_id,
            custom_endpoint_config=None,
            is_public=False,
            is_temporary=True,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            session_token=session_token,
            expires_at=expires_at,
            temp_user_uid=temp_user_uid,
            temp_access_key_id=temp_access_key_id,
            capabilities_json=json.dumps({}),
            created_at=now,
            updated_at=now,
            last_used_at=now,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def create(self, user_id: int, payload: S3ConnectionCreate) -> S3Connection:
        is_public = bool(payload.is_public)
        endpoint_url = (payload.endpoint_url or "").strip()
        region = payload.region
        force_path_style = bool(payload.force_path_style)
        verify_tls = bool(payload.verify_tls)
        custom_endpoint_config = None
        if payload.storage_endpoint_id is not None:
            endpoint_url = None
            region = None
            force_path_style = False
            verify_tls = True
        else:
            endpoint_url = endpoint_url.rstrip("/") if endpoint_url else None
            custom_endpoint_config = build_custom_endpoint_config(
                endpoint_url,
                region,
                force_path_style,
                verify_tls,
                payload.provider_hint,
            )
        row = DBS3Connection(
            owner_user_id=None if is_public else user_id,
            name=payload.name,
            storage_endpoint_id=payload.storage_endpoint_id,
            custom_endpoint_config=custom_endpoint_config,
            is_public=is_public,
            access_key_id=payload.access_key_id,
            secret_access_key=payload.secret_access_key,
            capabilities_json=json.dumps({}),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return self._to_model(row)

    def update(self, user_id: int, connection_id: int, payload: S3ConnectionUpdate) -> S3Connection:
        row = self.get_owned(user_id, connection_id)
        payload_data = payload.model_dump(exclude_unset=True)
        if payload.name is not None:
            row.name = payload.name
        if payload.is_public is not None:
            row.is_public = bool(payload.is_public)
            if row.is_public:
                row.owner_user_id = None
        if "storage_endpoint_id" in payload_data:
            row.storage_endpoint_id = payload.storage_endpoint_id
            if payload.storage_endpoint_id is not None:
                row.custom_endpoint_config = None
        if row.storage_endpoint_id is None:
            current = parse_custom_endpoint_config(row.custom_endpoint_config)
            endpoint_url = current.get("endpoint_url")
            region = current.get("region")
            force_path_style = bool(current.get("force_path_style", False))
            verify_tls = bool(current.get("verify_tls", True))
            provider = current.get("provider") or current.get("provider_hint")
            if payload.endpoint_url is not None:
                endpoint_url = payload.endpoint_url.rstrip("/")
            if payload.region is not None:
                region = payload.region
            if payload.force_path_style is not None:
                force_path_style = bool(payload.force_path_style)
            if payload.verify_tls is not None:
                verify_tls = bool(payload.verify_tls)
            if payload.provider_hint is not None:
                provider = payload.provider_hint
            row.custom_endpoint_config = build_custom_endpoint_config(
                endpoint_url,
                region,
                force_path_style,
                verify_tls,
                provider,
            )
        if payload.access_key_id is not None:
            row.access_key_id = payload.access_key_id
        if payload.secret_access_key is not None:
            row.secret_access_key = payload.secret_access_key
        row.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(row)
        return self._to_model(row)

    def delete(self, user_id: int, connection_id: int) -> None:
        row = self.get_owned(user_id, connection_id)
        self.db.delete(row)
        self.db.commit()

    def get_capabilities(self, user_id: int, connection_id: int) -> dict[str, Any]:
        row = self.get_visible(user_id, connection_id)
        return self._parse_capabilities(row.capabilities_json)

    def set_capabilities(self, user_id: int, connection_id: int, caps: dict[str, Any]) -> None:
        row = self.get_owned(user_id, connection_id)
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
        masked_access_key = self._mask_access_key_id(row.access_key_id)
        details = resolve_connection_details(row)
        return S3Connection(
            id=row.id,
            name=row.name,
            provider_hint=details.provider,
            storage_endpoint_id=row.storage_endpoint_id,
            is_public=bool(row.is_public),
            endpoint_url=details.endpoint_url or "",
            region=details.region,
            access_key_id=masked_access_key,
            force_path_style=details.force_path_style,
            verify_tls=details.verify_tls,
            capabilities=self._parse_capabilities(row.capabilities_json),
            created_at=row.created_at,
            updated_at=row.updated_at,
            last_used_at=row.last_used_at,
        )

    def _mask_access_key_id(self, value: str) -> str:
        if not value:
            return ""
        trimmed = value.strip()
        if len(trimmed) <= 8:
            return "***" + trimmed[-2:]
        return f"{trimmed[:4]}***{trimmed[-4:]}"
