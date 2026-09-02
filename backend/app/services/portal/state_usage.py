# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Optional, TYPE_CHECKING

from app.db import PortalAccountRole, User
from app.models.bucket import Bucket
from app.models.portal import PortalState
from app.models.portal_usage import (
    PortalUsage,
    PortalUsageStorageSpace,
)
from app.services.rgw_admin import RGWAdminError
from app.utils.usage_stats import extract_usage_stats

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess

logger = logging.getLogger(__name__)


class PortalStateUsageMixin:
    _portal_other_storage_space_id = "__other__"

    def _usage_storage_space_breakdown(
        self,
        user: User,
        access: "AccountAccess",
        usage_by_bucket: dict[str, tuple[Optional[int], Optional[int]]],
    ) -> list[PortalUsageStorageSpace]:
        try:
            spaces = self.list_storage_spaces(user, access)
        except RuntimeError:
            return []
        breakdown: list[PortalUsageStorageSpace] = []
        for space in spaces:
            bucket_name = space.internal_bucket_name or space.id
            usage_bytes, usage_objects = usage_by_bucket.get(bucket_name, (space.used_bytes, space.object_count))
            breakdown.append(
                PortalUsageStorageSpace(
                    id=space.id,
                    name=space.name,
                    used_bytes=usage_bytes,
                    object_count=usage_objects,
                    quota_max_size_bytes=space.quota_max_size_bytes,
                    quota_max_objects=space.quota_max_objects,
                )
            )
        return breakdown

    def _portal_other_usage(
        self,
        *,
        total_bytes: int,
        total_objects: int,
        has_total_bytes: bool,
        has_total_objects: bool,
        detailed_bytes: int,
        detailed_objects: int,
    ) -> PortalUsageStorageSpace | None:
        other_bytes = max(0, total_bytes - detailed_bytes) if has_total_bytes else None
        other_objects = max(0, total_objects - detailed_objects) if has_total_objects else None
        if (other_bytes is None or other_bytes == 0) and (other_objects is None or other_objects == 0):
            return None
        return PortalUsageStorageSpace(
            id=self._portal_other_storage_space_id,
            name="Other",
            used_bytes=other_bytes,
            object_count=other_objects,
        )

    def get_state(self, access: "AccountAccess") -> PortalState:
        account = access.account
        portal_settings = self._effective_portal_settings(account)
        can_create_private_storage_spaces = bool(
            portal_settings.allow_private_storage_space_create
            and access.portal_role in {PortalAccountRole.PORTAL_MANAGER.value, PortalAccountRole.PORTAL_USER.value}
        )
        can_create_team_storage_spaces = access.portal_role == PortalAccountRole.PORTAL_MANAGER.value
        return PortalState(
            portal_role=access.portal_role,
            can_manage_buckets=access.capabilities.can_manage_buckets,
            can_create_private_storage_spaces=can_create_private_storage_spaces,
            can_create_team_storage_spaces=can_create_team_storage_spaces,
            can_manage_portal_users=access.capabilities.can_manage_portal_users,
            allow_named_bucket_create=portal_settings.allow_portal_named_bucket_create,
            server_access_logging_enabled=portal_settings.server_access_logging_enabled,
            storage_space_version_cleanup_enabled=portal_settings.storage_space_version_cleanup_enabled,
        )

    def get_usage(self, user: User, access: "AccountAccess") -> PortalUsage:
        account = access.account
        quota_max_size_bytes, quota_max_objects, max_buckets = self._account_limits(account)
        is_portal_user = access.portal_role == PortalAccountRole.PORTAL_USER.value
        allowed = set(self.list_existing_user_bucket_access(user, account, access.portal_role))
        if not allowed and not is_portal_user:
            return PortalUsage(
                used_bytes=None,
                used_objects=None,
                quota_max_size_bytes=quota_max_size_bytes,
                quota_max_objects=quota_max_objects,
                max_buckets=max_buckets,
                storage_spaces=[],
            )
        try:
            rgw_admin = self._supervision_admin_for_account(account)
            bucket_payloads = self._admin_bucket_list(account, admin=rgw_admin)
        except (RGWAdminError, RuntimeError) as exc:  # pragma: no cover - defensive path
            logger.warning("Unable to list scoped bucket usage for portal user %s: %s", user.email, exc)
            return PortalUsage(
                used_bytes=None,
                used_objects=None,
                quota_max_size_bytes=quota_max_size_bytes,
                quota_max_objects=quota_max_objects,
                max_buckets=max_buckets,
                storage_spaces=self._usage_storage_space_breakdown(user, access, {}),
            )

        total_bytes = 0
        total_objects = 0
        has_bytes = False
        has_objects = False
        detailed_bytes = 0
        detailed_objects = 0
        usage_by_bucket: dict[str, tuple[Optional[int], Optional[int]]] = {}
        for item in bucket_payloads:
            if not isinstance(item, dict):
                continue
            bucket_name = item.get("bucket") or item.get("name")
            usage = item.get("usage")
            usage_bytes, usage_objects = extract_usage_stats(usage)
            if is_portal_user or bucket_name in allowed:
                if usage_bytes is not None:
                    total_bytes += usage_bytes
                    has_bytes = True
                if usage_objects is not None:
                    total_objects += usage_objects
                    has_objects = True
            if bucket_name in allowed:
                usage_by_bucket[bucket_name] = (usage_bytes, usage_objects)
                if usage_bytes is not None:
                    detailed_bytes += usage_bytes
                if usage_objects is not None:
                    detailed_objects += usage_objects
        other_storage_space = (
            self._portal_other_usage(
                total_bytes=total_bytes,
                total_objects=total_objects,
                has_total_bytes=has_bytes,
                has_total_objects=has_objects,
                detailed_bytes=detailed_bytes,
                detailed_objects=detailed_objects,
            )
            if is_portal_user
            else None
        )
        return PortalUsage(
            used_bytes=total_bytes if has_bytes else None,
            used_objects=total_objects if has_objects else None,
            quota_max_size_bytes=quota_max_size_bytes,
            quota_max_objects=quota_max_objects,
            max_buckets=max_buckets,
            storage_spaces=self._usage_storage_space_breakdown(user, access, usage_by_bucket),
            other_storage_space=other_storage_space,
        )

    def get_bucket_stats(self, user: User, access: "AccountAccess", bucket_name: str) -> Bucket:
        if not bucket_name:
            raise RuntimeError("Bucket name requis.")
        account = access.account
        if not access.capabilities.can_manage_buckets:
            allowed = self.list_existing_user_bucket_access(user, access.account, access.portal_role)
            if bucket_name not in allowed:
                raise RuntimeError("Accès bucket non autorisé.")
        try:
            rgw_admin = self._supervision_admin_for_account(account)
        except RGWAdminError as exc:  # pragma: no cover - defensive path
            logger.warning("Unable to initialize RGW admin client for bucket stats: %s", exc)
            raise RuntimeError("Impossible d'initialiser le client RGW.") from exc
        try:
            stats = self._admin_bucket_info(account, bucket_name, admin=rgw_admin)
        except RGWAdminError as exc:
            raise RuntimeError(f"Unable to fetch bucket stats: {exc}") from exc
        usage = stats.get("usage") if isinstance(stats, dict) else None
        usage_bytes, usage_objects = extract_usage_stats(usage)
        return Bucket(
            name=bucket_name,
            creation_date=None,
            used_bytes=usage_bytes,
            object_count=usage_objects,
            quota_max_size_bytes=None,
            quota_max_objects=None,
        )
