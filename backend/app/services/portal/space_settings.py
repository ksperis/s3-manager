# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Optional, TYPE_CHECKING

from app.db import AccountRole, S3Account, User
from app.models.portal import PortalStorageSpaceSettings, PortalStorageSpaceSettingsUpdate
from app.services import s3_client

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess

logger = logging.getLogger(__name__)


_PORTAL_LIFECYCLE_RULE_IDS = {"ExpireDeleteMarkers", "ExpireOldVersions"}


class PortalStorageSpaceSettingsMixin:
    def _portal_storage_space_settings_from_rules(
        self,
        *,
        account: S3Account,
        versioning_status: Optional[str],
        rules: list[dict],
        can_update: bool,
    ) -> PortalStorageSpaceSettings:
        normalized_status = versioning_status if versioning_status in {"Enabled", "Suspended"} else "Disabled"
        managed_rules = {
            str(rule.get("ID")): rule
            for rule in rules
            if isinstance(rule, dict) and str(rule.get("ID") or "") in _PORTAL_LIFECYCLE_RULE_IDS
        }
        lifecycle_enabled = all(
            rule_id in managed_rules
            and str(managed_rules[rule_id].get("Status") or "Enabled").lower() == "enabled"
            for rule_id in _PORTAL_LIFECYCLE_RULE_IDS
        )
        expiration_rule = managed_rules.get("ExpireOldVersions") or {}
        expiration = expiration_rule.get("NoncurrentVersionExpiration")
        retention_days = expiration.get("NoncurrentDays") if isinstance(expiration, dict) else None
        if not isinstance(retention_days, int) or isinstance(retention_days, bool) or retention_days < 1:
            retention_days = self._effective_portal_settings(
                account
            ).bucket_defaults.noncurrent_version_expiration_days
        return PortalStorageSpaceSettings(
            versioning_enabled=normalized_status == "Enabled",
            versioning_status=normalized_status,
            lifecycle_enabled=lifecycle_enabled,
            version_history_retention_days=retention_days,
            can_update=can_update,
        )

    def _portal_storage_space_runtime_settings(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
        *,
        can_update: bool,
    ) -> PortalStorageSpaceSettings:
        access_key, secret_key = self.get_portal_credentials(user, access.account, access.role)
        kwargs = self._s3_client_kwargs(access.account)
        versioning_status = s3_client.get_bucket_versioning(
            bucket_name,
            access_key=access_key,
            secret_key=secret_key,
            **kwargs,
        )
        rules = s3_client.get_bucket_lifecycle(
            bucket_name,
            access_key=access_key,
            secret_key=secret_key,
            **kwargs,
        )
        return self._portal_storage_space_settings_from_rules(
            account=access.account,
            versioning_status=versioning_status,
            rules=rules,
            can_update=can_update,
        )

    def get_storage_space_settings(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
    ) -> PortalStorageSpaceSettings:
        bucket_name = self._resolve_storage_space_bucket_name(
            user,
            access,
            space_id,
            include_archived=True,
        )
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        self._require_storage_space_manager(user, access, bucket_name, include_archived=True)
        metadata = self._storage_space_metadata(access.account, bucket_name)
        can_update = bool(
            access.role == AccountRole.PORTAL_MANAGER.value
            and metadata is not None
            and metadata.archived_at is None
        )
        return self._portal_storage_space_runtime_settings(
            user,
            access,
            bucket_name,
            can_update=can_update,
        )

    def update_storage_space_settings(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        payload: PortalStorageSpaceSettingsUpdate,
    ) -> PortalStorageSpaceSettings:
        if access.role != AccountRole.PORTAL_MANAGER.value:
            raise RuntimeError("Portal manager rights required for Storage Space settings.")
        bucket_name = self._resolve_storage_space_bucket_name(
            user,
            access,
            space_id,
            include_archived=True,
        )
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        self._require_storage_space_manager(user, access, bucket_name, include_archived=True)
        self._require_storage_space_active(access.account, bucket_name)

        access_key, secret_key = self.get_portal_credentials(user, access.account, access.role)
        kwargs = self._s3_client_kwargs(access.account)
        previous_versioning = s3_client.get_bucket_versioning(
            bucket_name,
            access_key=access_key,
            secret_key=secret_key,
            **kwargs,
        )
        previous_rules = s3_client.get_bucket_lifecycle(
            bucket_name,
            access_key=access_key,
            secret_key=secret_key,
            **kwargs,
        )
        retained_rules = [
            rule
            for rule in previous_rules
            if not (isinstance(rule, dict) and str(rule.get("ID") or "") in _PORTAL_LIFECYCLE_RULE_IDS)
        ]
        target_rules = list(retained_rules)
        if payload.lifecycle_enabled:
            target_rules.extend(
                self._portal_bucket_lifecycle_rules(payload.version_history_retention_days)
            )

        lifecycle_changed = target_rules != previous_rules
        try:
            if lifecycle_changed:
                if target_rules:
                    s3_client.put_bucket_lifecycle(
                        bucket_name,
                        rules=target_rules,
                        access_key=access_key,
                        secret_key=secret_key,
                        **kwargs,
                    )
                else:
                    s3_client.delete_bucket_lifecycle(
                        bucket_name,
                        access_key=access_key,
                        secret_key=secret_key,
                        **kwargs,
                    )

            versioning_enabled = previous_versioning == "Enabled"
            if versioning_enabled != payload.versioning_enabled:
                s3_client.set_bucket_versioning(
                    bucket_name,
                    enabled=payload.versioning_enabled,
                    access_key=access_key,
                    secret_key=secret_key,
                    **kwargs,
                )
        except Exception as exc:
            rollback_error: Optional[Exception] = None
            if lifecycle_changed:
                try:
                    if previous_rules:
                        s3_client.put_bucket_lifecycle(
                            bucket_name,
                            rules=previous_rules,
                            access_key=access_key,
                            secret_key=secret_key,
                            **kwargs,
                        )
                    else:
                        s3_client.delete_bucket_lifecycle(
                            bucket_name,
                            access_key=access_key,
                            secret_key=secret_key,
                            **kwargs,
                        )
                except Exception as rollback_exc:  # pragma: no cover - defensive remote failure
                    rollback_error = rollback_exc
                    logger.error(
                        "Unable to restore lifecycle settings for Portal Storage Space %s: %s",
                        bucket_name,
                        rollback_exc,
                    )
            suffix = " Lifecycle rollback also failed." if rollback_error else " Previous lifecycle settings were restored."
            raise RuntimeError(f"Unable to update Storage Space settings: {exc}.{suffix}") from exc

        return self._portal_storage_space_runtime_settings(
            user,
            access,
            bucket_name,
            can_update=True,
        )
