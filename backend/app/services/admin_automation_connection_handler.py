# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db import S3Connection, StorageEndpoint, User, UserS3Connection
from app.models.admin_automation import (
    AdminAutomationItemResult,
    S3ConnectionApply,
    S3ConnectionSpec,
)
from app.services.admin_automation_results import AdminAutomationResultFactory
from app.services.audit_service import AuditService
from app.services.mappers.s3_connection import mask_access_key_id
from app.services.s3_connection_capabilities_service import refresh_connection_detected_capabilities
from app.services.s3_connections_service import S3ConnectionsService
from app.utils.s3_connection_endpoint import (
    build_custom_endpoint_config,
    custom_endpoint_update_base,
    resolve_connection_details,
)


class AdminAutomationConnectionHandler(AdminAutomationResultFactory):
    def __init__(self, db: Session, connections: S3ConnectionsService) -> None:
        self.db = db
        self.s3_connections = connections

    def apply(
        self,
        item: S3ConnectionApply,
        dry_run: bool,
        current_user: User,
        audit_service: AuditService,
    ) -> AdminAutomationItemResult:
        key = self._s3_connection_key(item)
        try:
            conn = self._find_s3_connection(item)
            if item.state == "absent":
                if not conn:
                    return self._skipped("s3_connection", key, dry_run=dry_run)
                if dry_run:
                    return self._deleted("s3_connection", key, conn.id, dry_run=dry_run)
                (
                    self.db.query(UserS3Connection)
                    .filter(UserS3Connection.s3_connection_id == conn.id)
                    .delete(synchronize_session=False)
                )
                self.db.delete(conn)
                self.db.commit()
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="connection.delete",
                    entity_type="s3_connection",
                    entity_id=str(conn.id),
                )
                return self._deleted("s3_connection", key, conn.id, dry_run=dry_run)

            spec = item.spec
            if not conn:
                if not spec:
                    raise ValueError("s3_connections.spec is required to create a new connection")
                if not spec.name:
                    raise ValueError("s3_connections.spec.name is required to create a new connection")
                if not spec.access_key_id or not spec.secret_access_key:
                    raise ValueError("s3_connections.spec.access_key_id and secret_access_key are required to create a new connection")
                if spec.storage_endpoint_id is None and not spec.endpoint_url:
                    raise ValueError("s3_connections.spec.endpoint_url or storage_endpoint_id is required to create a new connection")
                if dry_run:
                    return self._created("s3_connection", key, dry_run=dry_run)
                conn = self._create_s3_connection(spec, current_user)
                details = resolve_connection_details(conn)
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="connection.create",
                    entity_type="s3_connection",
                    entity_id=str(conn.id),
                    metadata={
                        "name": conn.name,
                        "endpoint_url": details.endpoint_url,
                        "provider_hint": details.provider,
                    },
                )
                return self._created("s3_connection", key, conn.id, dry_run=dry_run)

            diff = self._diff_s3_connection(conn, item)
            if not diff:
                return self._skipped("s3_connection", key, dry_run=dry_run)
            if dry_run:
                return self._updated("s3_connection", key, conn.id, diff, dry_run=dry_run)
            conn = self._update_s3_connection(conn, item)
            audit_service.record_action(
                user=current_user,
                scope="admin",
                action="connection.update",
                entity_type="s3_connection",
                entity_id=str(conn.id),
                metadata=item.spec.model_dump(exclude_none=True, exclude_unset=True) if item.spec else None,
            )
            return self._updated("s3_connection", key, conn.id, diff, dry_run=dry_run)
        except Exception as exc:  # noqa: BLE001
            return self._failed("s3_connection", key, exc, dry_run=dry_run)

    def _diff_s3_connection(self, conn: S3Connection, item: S3ConnectionApply) -> dict[str, dict[str, Any]]:
        spec = item.spec
        if not spec:
            return {}
        diff: dict[str, dict[str, Any]] = {}
        fields_set = spec.model_fields_set
        if "name" in fields_set and spec.name and spec.name != conn.name:
            diff["name"] = {"from": conn.name, "to": spec.name}
        if "storage_endpoint_id" in fields_set:
            desired = spec.storage_endpoint_id
            if desired != conn.storage_endpoint_id:
                diff["storage_endpoint_id"] = {"from": conn.storage_endpoint_id, "to": desired}
        if {"endpoint_url", "region", "force_path_style", "verify_tls", "provider_hint"} & fields_set:
            details = resolve_connection_details(conn)
            if "endpoint_url" in fields_set and spec.endpoint_url is not None:
                desired = spec.endpoint_url.rstrip("/")
                current = (details.endpoint_url or "").rstrip("/")
                if desired != current:
                    diff["endpoint_url"] = {"from": details.endpoint_url, "to": desired}
            if "region" in fields_set and spec.region is not None and spec.region != details.region:
                diff["region"] = {"from": details.region, "to": spec.region}
            if "force_path_style" in fields_set and spec.force_path_style is not None:
                if bool(spec.force_path_style) != bool(details.force_path_style):
                    diff["force_path_style"] = {"from": bool(details.force_path_style), "to": bool(spec.force_path_style)}
            if "verify_tls" in fields_set and spec.verify_tls is not None:
                if bool(spec.verify_tls) != bool(details.verify_tls):
                    diff["verify_tls"] = {"from": bool(details.verify_tls), "to": bool(spec.verify_tls)}
            if "provider_hint" in fields_set and spec.provider_hint is not None and spec.provider_hint != details.provider:
                diff["provider_hint"] = {"from": details.provider, "to": spec.provider_hint}
        if spec.remediation_action == "activate_manager" and conn.remediation_required:
            diff["execution_status"] = {"from": "remediation_required", "to": "ready"}
        if "credential_owner_type" in fields_set and spec.credential_owner_type != conn.credential_owner_type:
            diff["credential_owner_type"] = {"from": conn.credential_owner_type, "to": spec.credential_owner_type}
        if "credential_owner_identifier" in fields_set and spec.credential_owner_identifier != conn.credential_owner_identifier:
            diff["credential_owner_identifier"] = {
                "from": conn.credential_owner_identifier,
                "to": spec.credential_owner_identifier,
            }
        if item.update_credentials:
            if "access_key_id" in fields_set and spec.access_key_id is not None and spec.access_key_id != conn.access_key_id:
                diff["access_key_id"] = {
                    "from": mask_access_key_id(conn.access_key_id),
                    "to": mask_access_key_id(spec.access_key_id),
                }
            if "secret_access_key" in fields_set and spec.secret_access_key is not None and spec.secret_access_key != conn.secret_access_key:
                diff["secret_access_key"] = {"from": "<redacted>", "to": "<redacted>"}
        return diff

    def _create_s3_connection(
        self,
        spec: S3ConnectionSpec,
        current_user: User,
    ) -> S3Connection:
        storage_endpoint_id = spec.storage_endpoint_id
        endpoint_url = (spec.endpoint_url or "").strip()
        if storage_endpoint_id is not None:
            storage_endpoint = (
                self.db.query(StorageEndpoint)
                .filter(StorageEndpoint.id == storage_endpoint_id)
                .first()
            )
            if not storage_endpoint:
                raise ValueError("Storage endpoint not found")
            custom_endpoint_config = None
        else:
            if not endpoint_url:
                raise ValueError("Endpoint URL is required for manual connections")
            endpoint_url = endpoint_url.rstrip("/")
            custom_endpoint_config = build_custom_endpoint_config(
                endpoint_url,
                spec.region,
                bool(spec.force_path_style or False),
                bool(spec.verify_tls if spec.verify_tls is not None else True),
                spec.provider_hint,
            )
        conn = S3Connection(
            created_by_user_id=current_user.id,
            name=spec.name,
            storage_endpoint_id=storage_endpoint_id,
            custom_endpoint_config=custom_endpoint_config,
            is_shared=True,
            access_manager=True,
            access_browser=False,
            remediation_required=False,
            remediation_reason=None,
            credential_owner_type=spec.credential_owner_type,
            credential_owner_identifier=spec.credential_owner_identifier,
            access_key_id=spec.access_key_id,
            secret_access_key=spec.secret_access_key,
        )
        self.db.add(conn)
        self.db.flush()
        self._refresh_detected_capabilities(conn)
        self.db.commit()
        self.db.refresh(conn)
        return conn

    def _update_s3_connection(
        self,
        conn: S3Connection,
        item: S3ConnectionApply,
    ) -> S3Connection:
        spec = item.spec
        if not spec:
            return conn
        payload_data = spec.model_dump(exclude_unset=True)
        should_probe_iam = False
        if "name" in payload_data and spec.name is not None:
            conn.name = spec.name
        if "storage_endpoint_id" in payload_data:
            if spec.storage_endpoint_id is not None:
                storage_endpoint = (
                    self.db.query(StorageEndpoint)
                    .filter(StorageEndpoint.id == spec.storage_endpoint_id)
                    .first()
                )
                if not storage_endpoint:
                    raise ValueError("Storage endpoint not found")
                conn.storage_endpoint_id = storage_endpoint.id
                conn.custom_endpoint_config = None
                should_probe_iam = True
            else:
                conn.storage_endpoint_id = None
                should_probe_iam = True
        if conn.storage_endpoint_id is None:
            current = custom_endpoint_update_base(conn.custom_endpoint_config)
            endpoint_url = current.endpoint_url
            region = current.region
            force_path_style = current.force_path_style
            verify_tls = current.verify_tls
            provider = current.provider
            if "endpoint_url" in payload_data and spec.endpoint_url is not None:
                endpoint_url = spec.endpoint_url.rstrip("/")
                should_probe_iam = True
            if "region" in payload_data and spec.region is not None:
                region = spec.region
                should_probe_iam = True
            if "force_path_style" in payload_data and spec.force_path_style is not None:
                force_path_style = bool(spec.force_path_style)
            if "verify_tls" in payload_data and spec.verify_tls is not None:
                verify_tls = bool(spec.verify_tls)
                should_probe_iam = True
            if "provider_hint" in payload_data and spec.provider_hint is not None:
                provider = spec.provider_hint
            if not endpoint_url:
                raise ValueError("Endpoint URL is required for manual connections")
            conn.custom_endpoint_config = build_custom_endpoint_config(
                endpoint_url,
                region,
                force_path_style,
                verify_tls,
                provider,
            )
        conn.access_browser = False
        if spec.remediation_action == "activate_manager":
            conn.access_manager = True
            conn.remediation_required = False
            conn.remediation_reason = None
            conn.is_active = True
        if "credential_owner_type" in payload_data:
            conn.credential_owner_type = spec.credential_owner_type
        if "credential_owner_identifier" in payload_data:
            conn.credential_owner_identifier = spec.credential_owner_identifier
        if item.update_credentials:
            if "access_key_id" in payload_data and spec.access_key_id is not None:
                conn.access_key_id = spec.access_key_id
                should_probe_iam = True
            if "secret_access_key" in payload_data and spec.secret_access_key is not None:
                conn.secret_access_key = spec.secret_access_key
                should_probe_iam = True
        if should_probe_iam:
            self._refresh_detected_capabilities(conn)
        self.db.add(conn)
        self.db.commit()
        self.db.refresh(conn)
        return conn

    def _refresh_detected_capabilities(self, conn: S3Connection) -> None:
        refresh_connection_detected_capabilities(conn)

    def _find_s3_connection(
        self,
        item: S3ConnectionApply,
    ) -> Optional[S3Connection]:
        match = item.match
        query = self.s3_connections.admin_shared_query()
        if match.id is not None:
            return query.filter(S3Connection.id == match.id).first()
        if match.name:
            return query.filter(S3Connection.name == match.name).first()
        return None

    def _s3_connection_key(self, item: S3ConnectionApply) -> str:
        if item.match.name:
            return f"name={item.match.name}"
        return f"id={item.match.id}"
