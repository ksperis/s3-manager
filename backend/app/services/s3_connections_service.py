# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.utils.time import utcnow
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db.s3_connection import ManagedPrivateAccess, S3Connection as DBS3Connection, UserS3Connection
from app.models.s3_connection import S3Connection, S3ConnectionCreate, S3ConnectionUpdate
from app.services.mappers.s3_connection import mask_access_key_id, s3_connection_from_db
from app.services.s3_connection_capabilities_service import refresh_connection_detected_capabilities
from app.services.tags_service import TagsService
from app.utils.s3_connection_capabilities import (
    parse_s3_connection_capabilities,
    s3_connection_can_manage_iam,
)
from app.utils.s3_connection_endpoint import (
    build_custom_endpoint_config,
    parse_custom_endpoint_config,
)
from app.utils.s3_connection_ordering import s3_connection_name_order_by
from app.utils.s3_endpoint import validate_user_supplied_s3_endpoint


class S3ConnectionsService:
    """CRUD for S3 connections."""

    def __init__(self, db: Session):
        self.db = db
        self.tags = TagsService(db)

    def list_for_user(self, user_id: int) -> list[S3Connection]:
        """List connections visible to a UI user."""
        rows = (
            self.db.query(DBS3Connection)
            .outerjoin(UserS3Connection, UserS3Connection.s3_connection_id == DBS3Connection.id)
            .filter(
                DBS3Connection.is_temporary.is_(False),
                ((DBS3Connection.is_shared.is_(False)) & (DBS3Connection.created_by_user_id == user_id))
                | ((DBS3Connection.is_shared.is_(True)) & (UserS3Connection.user_id == user_id)),
            )
            .distinct()
            .order_by(*s3_connection_name_order_by(DBS3Connection))
            .all()
        )
        return [self._to_model(r) for r in rows]

    def list_owned_private(self, user_id: int) -> list[S3Connection]:
        """List private connections managed by the authenticated creator."""
        rows = (
            self.db.query(DBS3Connection)
            .filter(
                DBS3Connection.created_by_user_id == user_id,
                DBS3Connection.is_shared.is_(False),
                DBS3Connection.is_temporary.is_(False),
            )
            .order_by(*s3_connection_name_order_by(DBS3Connection))
            .all()
        )
        return [self._to_model(r) for r in rows]

    @staticmethod
    def admin_shared_predicates():
        """Return the single scope used by every Admin/automation selector."""
        return (
            DBS3Connection.is_shared.is_(True),
            DBS3Connection.is_temporary.is_(False),
        )

    def admin_shared_query(self):
        return self.db.query(DBS3Connection).filter(*self.admin_shared_predicates())

    def get_admin_shared(self, connection_id: int) -> DBS3Connection:
        row = self.admin_shared_query().filter(DBS3Connection.id == connection_id).first()
        if row is None:
            raise KeyError("S3Connection not found")
        return row

    def touch_last_used(self, user_id: int, connection_id: int) -> None:
        """Update last_used_at for UX/audit purposes."""
        try:
            row = self.get_visible(user_id, connection_id)
        except KeyError:
            return
        row.last_used_at = utcnow()
        row.updated_at = utcnow()
        self.db.commit()

    def update_credentials(self, user_id: int, connection_id: int, *, access_key_id: str, secret_access_key: str) -> S3Connection:
        """Rotate credentials without mixing with metadata updates."""
        row = self.get_owned(user_id, connection_id)
        if row.server_managed:
            raise ValueError("Server-managed connection credentials must be rotated by the provisioning service")
        if self.is_active_managed_source(row.id):
            raise ValueError("Connection credentials are locked while managed private accesses depend on this source")
        row.access_key_id = access_key_id
        row.secret_access_key = secret_access_key
        self._refresh_detected_capabilities(row)
        row.updated_at = utcnow()
        self.db.commit()
        self.db.refresh(row)
        return self._to_model(row)

    def get_owned(self, user_id: int, connection_id: int) -> DBS3Connection:
        row = (
            self.db.query(DBS3Connection)
            .filter(DBS3Connection.created_by_user_id == user_id, DBS3Connection.id == connection_id)
            .first()
        )
        if not row or row.is_temporary:
            raise KeyError("S3Connection not found")
        if row.is_shared:
            raise KeyError("S3Connection not found")
        return row

    def get_visible(self, user_id: int, connection_id: int) -> DBS3Connection:
        row = self.db.query(DBS3Connection).filter(DBS3Connection.id == connection_id).first()
        if not row or row.is_temporary:
            raise KeyError("S3Connection not found")
        if row.is_shared:
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
        if row.created_by_user_id != user_id:
            raise KeyError("S3Connection not found")
        return row

    def create_temporary(
        self,
        *,
        created_by_user_id: int,
        name: str,
        storage_endpoint_id: int,
        access_key_id: str,
        secret_access_key: str,
        session_token: Optional[str],
        expires_at: Optional[datetime],
        temp_user_uid: Optional[str],
        temp_access_key_id: Optional[str],
    ) -> DBS3Connection:
        now = utcnow()
        row = DBS3Connection(
            created_by_user_id=created_by_user_id,
            name=name,
            storage_endpoint_id=storage_endpoint_id,
            custom_endpoint_config=None,
            is_shared=False,
            access_manager=False,
            access_browser=True,
            is_temporary=True,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            session_token=session_token,
            expires_at=expires_at,
            temp_user_uid=temp_user_uid,
            temp_access_key_id=temp_access_key_id,
            created_at=now,
            updated_at=now,
            last_used_at=now,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def create(self, user_id: int, payload: S3ConnectionCreate) -> S3Connection:
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
            endpoint_url = self._validate_manual_endpoint(endpoint_url, verify_tls)
            custom_endpoint_config = build_custom_endpoint_config(
                endpoint_url,
                region,
                force_path_style,
                verify_tls,
                payload.provider_hint,
            )
        access_manager, access_browser = self._resolve_access_flags(
            access_manager=payload.access_manager,
            access_browser=payload.access_browser,
        )
        row = DBS3Connection(
            created_by_user_id=user_id,
            name=payload.name,
            storage_endpoint_id=payload.storage_endpoint_id,
            custom_endpoint_config=custom_endpoint_config,
            is_shared=False,
            is_active=True,
            access_manager=access_manager,
            access_browser=access_browser,
            credential_owner_type=payload.credential_owner_type,
            credential_owner_identifier=payload.credential_owner_identifier,
            access_key_id=payload.access_key_id,
            secret_access_key=payload.secret_access_key,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(row)
        self.db.flush()
        self.tags.replace_connection_tags(row, payload.tags)
        self._refresh_detected_capabilities(row)
        self.db.commit()
        self.db.refresh(row)
        return self._to_model(row)

    def update(self, user_id: int, connection_id: int, payload: S3ConnectionUpdate) -> S3Connection:
        row = self.get_owned(user_id, connection_id)
        payload_data = payload.model_dump(exclude_unset=True)
        if row.server_managed:
            immutable_fields = {
                "provider_hint",
                "storage_endpoint_id",
                "credential_owner_type",
                "credential_owner_identifier",
                "endpoint_url",
                "region",
                "access_key_id",
                "secret_access_key",
                "force_path_style",
                "verify_tls",
            }
            attempted = sorted(immutable_fields.intersection(payload_data))
            if attempted:
                raise ValueError(
                    "Server-managed connection provenance, endpoint, and credentials are immutable"
                )
        source_immutable_fields = {
            "provider_hint",
            "storage_endpoint_id",
            "endpoint_url",
            "region",
            "access_key_id",
            "secret_access_key",
            "force_path_style",
            "verify_tls",
        }
        if self.is_active_managed_source(row.id) and source_immutable_fields.intersection(payload_data):
            raise ValueError("Connection endpoint and credentials are locked while managed private accesses depend on it")
        should_probe_iam = False
        if payload.name is not None:
            row.name = payload.name
        if "is_active" in payload_data:
            row.is_active = bool(payload.is_active)
        if "storage_endpoint_id" in payload_data:
            row.storage_endpoint_id = payload.storage_endpoint_id
            if payload.storage_endpoint_id is not None:
                row.custom_endpoint_config = None
            should_probe_iam = True
        endpoint_fields = {
            "endpoint_url",
            "region",
            "force_path_style",
            "verify_tls",
            "provider_hint",
            "storage_endpoint_id",
        }
        should_rebuild_custom_endpoint = not row.server_managed or bool(endpoint_fields.intersection(payload_data))
        if row.storage_endpoint_id is None and should_rebuild_custom_endpoint:
            current = parse_custom_endpoint_config(row.custom_endpoint_config)
            endpoint_url = current.get("endpoint_url")
            region = current.get("region")
            force_path_style = bool(current.get("force_path_style", False))
            verify_tls = bool(current.get("verify_tls", True))
            provider = current.get("provider") or current.get("provider_hint")
            if payload.endpoint_url is not None:
                endpoint_url = payload.endpoint_url.rstrip("/")
                should_probe_iam = True
            if payload.region is not None:
                region = payload.region
                should_probe_iam = True
            if payload.force_path_style is not None:
                force_path_style = bool(payload.force_path_style)
            if payload.verify_tls is not None:
                verify_tls = bool(payload.verify_tls)
                should_probe_iam = True
            if payload.provider_hint is not None:
                provider = payload.provider_hint
            endpoint_url = self._validate_manual_endpoint(endpoint_url, verify_tls)
            row.custom_endpoint_config = build_custom_endpoint_config(
                endpoint_url,
                region,
                force_path_style,
                verify_tls,
                provider,
            )
        if payload.access_key_id is not None:
            row.access_key_id = payload.access_key_id
            should_probe_iam = True
        if payload.secret_access_key is not None:
            row.secret_access_key = payload.secret_access_key
            should_probe_iam = True
        if "access_manager" in payload_data or "access_browser" in payload_data:
            access_manager, access_browser = self._resolve_access_flags(
                access_manager=payload.access_manager if "access_manager" in payload_data else bool(row.access_manager),
                access_browser=payload.access_browser if "access_browser" in payload_data else bool(row.access_browser),
            )
            row.access_manager = access_manager
            row.access_browser = access_browser
        if "credential_owner_type" in payload_data:
            row.credential_owner_type = payload.credential_owner_type
        if "credential_owner_identifier" in payload_data:
            row.credential_owner_identifier = payload.credential_owner_identifier
        if "tags" in payload_data:
            self.tags.replace_connection_tags(row, payload.tags)
        if should_probe_iam:
            self._refresh_detected_capabilities(row)
        row.updated_at = utcnow()
        self.db.commit()
        self.db.refresh(row)
        return self._to_model(row)

    def delete(self, user_id: int, connection_id: int) -> None:
        row = self.get_owned(user_id, connection_id)
        if row.server_managed:
            raise ValueError("Server-managed connections must be deleted by the provisioning service")
        if self.is_active_managed_source(row.id):
            raise ValueError("Delete managed private accesses created from this source connection first")
        self.db.delete(row)
        self.db.flush()
        self.tags.cleanup_orphan_definitions()
        self.db.commit()

    def get_capabilities(self, user_id: int, connection_id: int) -> dict[str, Any]:
        row = self.get_visible(user_id, connection_id)
        return self._capabilities(row)

    def _resolve_access_flags(self, *, access_manager: Optional[bool], access_browser: Optional[bool]) -> tuple[bool, bool]:
        manager = bool(access_manager)
        browser = bool(access_browser)
        if not manager and not browser:
            raise ValueError("At least one access flag must be enabled")
        return manager, browser

    def _refresh_detected_capabilities(self, row: DBS3Connection) -> None:
        refresh_connection_detected_capabilities(row)

    def _capabilities(self, row: DBS3Connection) -> dict[str, Any]:
        return parse_s3_connection_capabilities(row.capabilities_json)

    def _to_model(self, row: DBS3Connection) -> S3Connection:
        return s3_connection_from_db(
            row,
            capabilities=self._capabilities(row),
            tags=self.tags.get_connection_tags(row),
        )

    def serialize(self, row: DBS3Connection) -> S3Connection:
        return self._to_model(row)

    def is_active_managed_source(self, connection_id: int) -> bool:
        return (
            self.db.query(ManagedPrivateAccess.id)
            .filter(
                ManagedPrivateAccess.source_context_type == "connection",
                ManagedPrivateAccess.source_context_id == connection_id,
                ManagedPrivateAccess.state.in_(("provisioning", "active", "deleting", "cleanup_pending")),
            )
            .first()
            is not None
        )

    def _mask_access_key_id(self, value: str) -> str:
        return mask_access_key_id(value)

    def _validate_manual_endpoint(self, endpoint_url: Optional[str], verify_tls: bool) -> str:
        normalized = (endpoint_url or "").strip()
        if not normalized:
            raise ValueError("Endpoint URL is required.")
        if not verify_tls:
            raise ValueError("Manual private connections require TLS verification.")
        return validate_user_supplied_s3_endpoint(normalized, field_name="Endpoint URL")
