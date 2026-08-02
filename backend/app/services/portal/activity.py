# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.services.audit_service import parse_audit_metadata

from ._shared import *


class PortalActivityMixin:
    def _audit_metadata(self, log: AuditLog) -> dict[str, Any]:
        return parse_audit_metadata(log.metadata_json) or {}

    def _visible_storage_space_lookup(
        self,
        user: User,
        access: "AccountAccess",
    ) -> dict[str, PortalStorageSpaceSummary]:
        lookup: dict[str, PortalStorageSpaceSummary] = {}
        content_bucket_names = (
            set(self.list_existing_user_content_bucket_access(user, access.account, access.role))
            if access.role == AccountRole.PORTAL_USER.value
            else None
        )
        for item in self.list_storage_spaces(user, access):
            bucket_name = item.internal_bucket_name or item.id
            if content_bucket_names is not None and bucket_name not in content_bucket_names:
                continue
            lookup[item.id] = item
            if item.internal_bucket_name:
                lookup[item.internal_bucket_name] = item
        return lookup

    def _audit_storage_space(
        self,
        log: AuditLog,
        metadata: dict[str, Any],
        visible_spaces: dict[str, PortalStorageSpaceSummary],
    ) -> PortalStorageSpaceSummary | None:
        raw_space_id = self._audit_storage_space_id(log, metadata)
        if raw_space_id is None:
            return None
        return visible_spaces.get(raw_space_id)

    def _audit_storage_space_id(self, log: AuditLog, metadata: dict[str, Any]) -> str | None:
        raw_space_id = metadata.get("storage_space_id")
        if raw_space_id is None and log.entity_type == "storage_space":
            raw_space_id = log.entity_id
        if raw_space_id is None:
            return None
        return str(raw_space_id)

    def _audit_target_label(self, log: AuditLog, metadata: dict[str, Any], storage_space: PortalStorageSpaceSummary | None) -> str:
        if log.entity_type == "object" and log.entity_id:
            return os.path.basename(log.entity_id.rstrip("/")) or log.entity_id
        if log.entity_type == "storage_space" and storage_space:
            return storage_space.name
        if "target_user_id" in metadata:
            return f"user #{metadata['target_user_id']}"
        return log.entity_id or log.message or "workspace"

    def _portal_action_label(self, action: str) -> str:
        labels = {
            "upload_object": "Uploaded",
            "download_object": "Downloaded",
            "create_folder": "Created folder",
            "delete_object": "Deleted",
            "restore_object_version": "Restored version",
            "restore_deleted_object": "Restored from trash",
            "grant_storage_space_share": "Shared",
            "update_storage_space_share": "Updated share",
            "revoke_storage_space_share": "Removed share",
            "create_storage_space": "Created storage space",
            "update_storage_space": "Updated storage space",
            "archive_storage_space": "Archived storage space",
            "restore_storage_space": "Restored storage space",
            "create_public_link": "Created public link",
            "revoke_public_link": "Revoked public link",
        }
        return labels.get(action, action.replace("_", " ").title())

    def list_portal_activity(
        self,
        user: User,
        access: "AccountAccess",
        *,
        space_id: Optional[str] = None,
        limit: int = 100,
    ) -> list[PortalActivityItem]:
        visible_spaces = self._visible_storage_space_lookup(user, access)
        selected_space = visible_spaces.get(space_id) if space_id else None
        if space_id and selected_space is None:
            raise RuntimeError("Storage space not found or not allowed.")
        query_limit = min(max(limit, 1), 200)
        logs = (
            self.db.query(AuditLog)
            .filter(AuditLog.scope == "portal", AuditLog.account_id == access.account.id)
            .order_by(AuditLog.id.desc())
            .limit(min(query_limit * 5, 500))
            .all()
        )
        items: list[PortalActivityItem] = []
        for log in logs:
            metadata = self._audit_metadata(log)
            raw_space_id = self._audit_storage_space_id(log, metadata)
            storage_space = self._audit_storage_space(log, metadata, visible_spaces)
            if raw_space_id is not None and storage_space is None:
                continue
            if selected_space is not None and storage_space != selected_space:
                continue
            if storage_space is None and log.user_id != user.id:
                continue
            items.append(
                PortalActivityItem(
                    id=log.id,
                    created_at=log.created_at,
                    actor=log.user_email,
                    action=self._portal_action_label(log.action),
                    target=self._audit_target_label(log, metadata, storage_space),
                    storage_space_id=storage_space.id if storage_space else None,
                    storage_space_name=storage_space.name if storage_space else None,
                    ip_address=log.ip_address,
                    status=log.status,
                )
            )
            if len(items) >= query_limit:
                break
        return items

    def list_portal_transfers(
        self,
        user: User,
        access: "AccountAccess",
        *,
        space_id: Optional[str] = None,
        limit: int = 100,
    ) -> list[PortalTransfer]:
        visible_spaces = self._visible_storage_space_lookup(user, access)
        selected_space = visible_spaces.get(space_id) if space_id else None
        if space_id and selected_space is None:
            raise RuntimeError("Storage space not found or not allowed.")
        query_limit = min(max(limit, 1), 200)
        logs = (
            self.db.query(AuditLog)
            .filter(
                AuditLog.scope == "portal",
                AuditLog.account_id == access.account.id,
                AuditLog.action.in_(["upload_object", "download_object"]),
            )
            .order_by(AuditLog.id.desc())
            .limit(min(query_limit * 5, 500))
            .all()
        )
        transfers: list[PortalTransfer] = []
        for log in logs:
            metadata = self._audit_metadata(log)
            raw_space_id = self._audit_storage_space_id(log, metadata)
            storage_space = self._audit_storage_space(log, metadata, visible_spaces)
            if raw_space_id is not None and storage_space is None:
                continue
            if selected_space is not None and storage_space != selected_space:
                continue
            if storage_space is None and log.user_id != user.id:
                continue
            failed = log.status != "success"
            target = log.entity_id or "object"
            transfers.append(
                PortalTransfer(
                    id=f"audit-{log.id}",
                    name=os.path.basename(target.rstrip("/")) or target,
                    direction="Upload" if log.action == "upload_object" else "Download",
                    status="Failed" if failed else "Completed",
                    progress=0 if failed else 100,
                    size_bytes=metadata.get("size_bytes") if isinstance(metadata.get("size_bytes"), int) else None,
                    storage_space_id=storage_space.id if storage_space else None,
                    storage_space_name=storage_space.name if storage_space else None,
                    started_at=log.created_at,
                    eta_label="-" if failed else "Completed",
                    speed_label="-",
                    error_message=log.message if failed else None,
                )
            )
            if len(transfers) >= query_limit:
                break
        return transfers

    def list_portal_alerts(
        self,
        user: User,
        access: "AccountAccess",
        *,
        limit: int = 50,
    ) -> list[PortalAlert]:
        alerts: list[PortalAlert] = []
        try:
            usage = self.get_usage(user, access)
            if usage.used_bytes is not None and usage.quota_max_size_bytes and usage.quota_max_size_bytes > 0:
                ratio = usage.used_bytes / usage.quota_max_size_bytes
                if ratio >= 0.8:
                    percent_used = round(ratio * 100)
                    alerts.append(
                        PortalAlert(
                            id="quota-near",
                            tone="danger" if ratio >= 0.95 else "warning",
                            title="Quota is getting close",
                            description=f"{percent_used}% of workspace storage is used.",
                            severity_label="Critical" if ratio >= 0.95 else "Warning",
                        )
                    )
        except RuntimeError:
            pass

        for space in self.list_storage_spaces(user, access):
            bucket_name = (space.internal_bucket_name or space.id).lower()
            if "public" in bucket_name or "website" in bucket_name:
                alerts.append(
                    PortalAlert(
                        id=f"public-space-{space.id}",
                        tone="danger",
                        title="Public storage space detected",
                        description=f"{space.name} appears to be publicly reachable.",
                        severity_label="Critical",
                        storage_space_id=space.id,
                    )
                )

        now = utcnow()
        link_cutoff = now + timedelta(days=7)
        visible_spaces = self._visible_storage_space_lookup(user, access)
        active_public_links = (
            self.db.query(DBPortalPublicLink)
            .filter(
                DBPortalPublicLink.account_id == access.account.id,
                DBPortalPublicLink.revoked_at.is_(None),
                (DBPortalPublicLink.expires_at.is_(None) | (DBPortalPublicLink.expires_at >= now)),
            )
            .order_by(DBPortalPublicLink.created_at.desc(), DBPortalPublicLink.id.desc())
            .limit(20)
            .all()
        )
        for link in active_public_links:
            storage_space = visible_spaces.get(link.bucket_name)
            if storage_space is None:
                continue
            alerts.append(
                PortalAlert(
                    id=f"public-link-{link.id}",
                    tone="warning",
                    title="Public link active",
                    description=f"{self._object_name(link.object_key)} is shared through a public link.",
                    severity_label="Warning",
                    storage_space_id=storage_space.id,
                    created_at=link.created_at,
                )
            )
            break

        public_links = (
            self.db.query(DBPortalPublicLink)
            .filter(
                DBPortalPublicLink.account_id == access.account.id,
                DBPortalPublicLink.revoked_at.is_(None),
                DBPortalPublicLink.expires_at.isnot(None),
                DBPortalPublicLink.expires_at >= now,
                DBPortalPublicLink.expires_at <= link_cutoff,
            )
            .order_by(DBPortalPublicLink.expires_at.asc(), DBPortalPublicLink.id.asc())
            .limit(20)
            .all()
        )
        for link in public_links:
            storage_space = visible_spaces.get(link.bucket_name)
            if storage_space is None:
                continue
            expires_at = self._normalize_storage_space_datetime(link.expires_at)
            if expires_at is not None:
                alerts.append(
                    PortalAlert(
                        id=f"link-expiring-{link.id}",
                        tone="warning",
                        title="Shared link expiring",
                        description=f"{self._object_name(link.object_key)} expires soon.",
                        severity_label="Warning",
                        storage_space_id=storage_space.id,
                        created_at=link.created_at,
                    )
                )
                break

        failed_transfer = next(
            (
                transfer
                for transfer in self.list_portal_transfers(user, access, limit=10)
                if transfer.status == "Failed"
            ),
            None,
        )
        if failed_transfer:
            alerts.append(
                PortalAlert(
                    id=f"transfer-failed-{failed_transfer.id}",
                    tone="warning",
                    title="Transfer retry needed",
                    description=f"{failed_transfer.name} failed recently.",
                    severity_label="Warning",
                    storage_space_id=failed_transfer.storage_space_id,
                    created_at=failed_transfer.started_at,
                )
            )
        return self.dedupe_portal_alerts(alerts)[: min(max(limit, 1), 100)]

    @staticmethod
    def dedupe_portal_alerts(alerts: list[PortalAlert]) -> list[PortalAlert]:
        severity_rank = {"danger": 0, "warning": 1, "info": 2}
        label_by_tone = {"danger": "Critical", "warning": "Warning", "info": "Info"}
        deduped: dict[str, PortalAlert] = {}
        order: list[str] = []
        for alert in alerts:
            key = alert.id
            existing = deduped.get(key)
            normalized = alert.model_copy(
                update={
                    "severity_label": alert.severity_label or label_by_tone.get(alert.tone, "Info"),
                }
            )
            if existing is None:
                deduped[key] = normalized
                order.append(key)
                continue
            if severity_rank.get(normalized.tone, 9) < severity_rank.get(existing.tone, 9):
                deduped[key] = normalized

        def sort_key(key: str) -> tuple[int, float, int]:
            alert = deduped[key]
            created_at = alert.created_at
            if created_at is None:
                timestamp = 0.0
            else:
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=timezone.utc)
                timestamp = created_at.timestamp()
            return (severity_rank.get(alert.tone, 9), -timestamp, order.index(key))

        return [deduped[key] for key in sorted(order, key=sort_key)]
