# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from app.db import S3Connection, User
from app.models.admin_automation import (
    AdminAutomationItemResult,
    S3ConnectionApply,
    S3ConnectionSpec,
)
from app.models.s3_connection_admin import (
    S3ConnectionAdminCreate,
    S3ConnectionAdminUpdate,
)
from app.services.admin_automation_results import AdminAutomationResultFactory
from app.services.audit_service import AuditService
from app.services.mappers.s3_connection import mask_access_key_id
from app.services.s3_connections_service import S3ConnectionsService
from app.utils.s3_connection_endpoint import resolve_connection_details


class AdminAutomationConnectionHandler(AdminAutomationResultFactory):
    def __init__(self, connections: S3ConnectionsService) -> None:
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
                self.s3_connections.delete_admin_shared(conn.id)
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
                create_payload = self._build_create(spec)
                self.s3_connections.validate_admin_shared_create(create_payload)
                if dry_run:
                    return self._created("s3_connection", key, dry_run=dry_run)
                conn = self.s3_connections.create_admin_shared(
                    current_user.id,
                    create_payload,
                )
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
            if spec is None:
                raise RuntimeError("S3 connection update diff requires a specification")
            update_payload = self._build_update(spec)
            credential_fields = self._changed_credential_fields(conn, item)
            conn = self.s3_connections.update_admin_shared(
                conn.id,
                update_payload,
                activate_manager=spec.remediation_action == "activate_manager",
                access_key_id=(
                    spec.access_key_id
                    if "access_key_id" in credential_fields
                    else None
                ),
                secret_access_key=(
                    spec.secret_access_key
                    if "secret_access_key" in credential_fields
                    else None
                ),
            )
            metadata = update_payload.model_dump(
                exclude_unset=True,
            )
            if spec.remediation_action == "activate_manager":
                metadata["remediation_action"] = "activate_manager"
            if credential_fields:
                metadata["credential_fields_updated"] = sorted(credential_fields)
            audit_service.record_action(
                user=current_user,
                scope="admin",
                action="connection.update",
                entity_type="s3_connection",
                entity_id=str(conn.id),
                metadata=metadata,
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
        update_payload = self._build_update(spec)
        credential_fields = self._changed_credential_fields(conn, item)
        self.s3_connections.validate_admin_shared_update(
            conn,
            update_payload,
            update_credentials=bool(credential_fields),
        )
        if "name" in fields_set and spec.name and spec.name != conn.name:
            diff["name"] = {"from": conn.name, "to": spec.name}
        if "storage_endpoint_id" in fields_set:
            desired = spec.storage_endpoint_id
            if desired != conn.storage_endpoint_id:
                diff["storage_endpoint_id"] = {"from": conn.storage_endpoint_id, "to": desired}
        if {"endpoint_url", "region", "force_path_style", "verify_tls", "provider_hint"} & fields_set:
            details = resolve_connection_details(conn)
            if "endpoint_url" in fields_set:
                desired = (spec.endpoint_url or "").rstrip("/")
                current = (details.endpoint_url or "").rstrip("/")
                if desired != current:
                    diff["endpoint_url"] = {"from": details.endpoint_url, "to": desired}
            if "region" in fields_set and spec.region != details.region:
                diff["region"] = {"from": details.region, "to": spec.region}
            if "force_path_style" in fields_set:
                if bool(spec.force_path_style) != bool(details.force_path_style):
                    diff["force_path_style"] = {"from": bool(details.force_path_style), "to": bool(spec.force_path_style)}
            if "verify_tls" in fields_set:
                if bool(spec.verify_tls) != bool(details.verify_tls):
                    diff["verify_tls"] = {"from": bool(details.verify_tls), "to": bool(spec.verify_tls)}
            if "provider_hint" in fields_set and spec.provider_hint != details.provider:
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
        if "access_key_id" in credential_fields:
            diff["access_key_id"] = {
                "from": mask_access_key_id(conn.access_key_id),
                "to": mask_access_key_id(spec.access_key_id),
            }
        if "secret_access_key" in credential_fields:
            diff["secret_access_key"] = {
                "from": "<redacted>",
                "to": "<redacted>",
            }
        return diff

    @staticmethod
    def _build_create(spec: S3ConnectionSpec) -> S3ConnectionAdminCreate:
        payload = spec.model_dump(exclude_unset=True)
        payload.pop("remediation_action", None)
        return S3ConnectionAdminCreate(**payload)

    @staticmethod
    def _build_update(spec: S3ConnectionSpec) -> S3ConnectionAdminUpdate:
        payload = spec.model_dump(exclude_unset=True)
        for field in ("access_key_id", "secret_access_key", "remediation_action"):
            payload.pop(field, None)
        return S3ConnectionAdminUpdate(**payload)

    @staticmethod
    def _changed_credential_fields(
        conn: S3Connection,
        item: S3ConnectionApply,
    ) -> set[str]:
        spec = item.spec
        if not item.update_credentials or spec is None:
            return set()
        changed: set[str] = set()
        fields_set = spec.model_fields_set
        if (
            "access_key_id" in fields_set
            and spec.access_key_id is not None
            and spec.access_key_id != conn.access_key_id
        ):
            changed.add("access_key_id")
        if (
            "secret_access_key" in fields_set
            and spec.secret_access_key is not None
            and spec.secret_access_key != conn.secret_access_key
        ):
            changed.add("secret_access_key")
        return changed

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
