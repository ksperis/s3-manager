# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


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

    def get_state(self, user: User, access: "AccountAccess") -> PortalState:
        account = access.account
        used_bytes = None
        used_objects = None
        access_keys: list[PortalAccessKey] = []
        link = self._existing_portal_link(user, account)
        iam_user = None
        iam_provisioned = False
        if link and link.iam_username:
            iam_service = self._get_iam_service(account)
            iam_user = iam_service.get_user(link.iam_username)
            if iam_user:
                keys_with_portal = self._list_access_keys(link, iam_service, include_portal=True)
                access_keys = [key for key in keys_with_portal if not key.is_portal]

                portal_meta = next(
                    (key for key in keys_with_portal if key.is_portal and key.access_key_id == link.active_access_key),
                    None,
                )
                has_active_portal_credentials = bool(
                    link.active_access_key
                    and link.active_secret_key
                    and portal_meta
                    and self._is_active_status(portal_meta.status, default=True)
                )
                iam_provisioned = has_active_portal_credentials
        quota_max_size_bytes, quota_max_objects, max_buckets = self._account_limits(account)
        portal_settings = self._effective_portal_settings(account)
        can_create_storage_spaces = bool(
            access.capabilities.can_manage_buckets
            or (
                access.role == AccountRole.PORTAL_USER.value
                and portal_settings.allow_portal_user_bucket_create
            )
        )
        return PortalState(
            account_id=account.id,
            iam_user=PortalIAMUser(
                iam_user_id=link.iam_user_id if link else None,
                iam_username=link.iam_username if link else None,
                arn=iam_user.arn if iam_user else None,
                created_at=link.created_at if link else None,
            ),
            access_keys=access_keys,
            iam_provisioned=iam_provisioned,
            max_buckets=max_buckets,
            s3_endpoint=resolve_s3_endpoint(account),
            used_bytes=used_bytes,
            used_objects=used_objects,
            quota_max_size_bytes=quota_max_size_bytes,
            quota_max_objects=quota_max_objects,
            just_created=False,
            account_role=access.role,
            can_manage_buckets=access.capabilities.can_manage_buckets,
            can_create_storage_spaces=can_create_storage_spaces,
            can_manage_portal_users=access.capabilities.can_manage_portal_users,
            allow_named_bucket_create=portal_settings.allow_portal_named_bucket_create,
        )

    def get_usage(self, user: User, access: "AccountAccess") -> PortalUsage:
        account = access.account
        quota_max_size_bytes, quota_max_objects = self._account_quota(account)
        is_portal_user = access.role == AccountRole.PORTAL_USER.value
        if is_portal_user:
            allowed = set(self.list_existing_user_content_bucket_access(user, account, access.role))
        else:
            allowed = set(self.list_existing_user_bucket_access(user, account, access.role))
        if not allowed and not is_portal_user:
            return PortalUsage(
                used_bytes=None,
                used_objects=None,
                quota_max_size_bytes=quota_max_size_bytes,
                quota_max_objects=quota_max_objects,
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
            storage_spaces=self._usage_storage_space_breakdown(user, access, usage_by_bucket),
            other_storage_space=other_storage_space,
        )

    def get_bucket_stats(self, user: User, access: "AccountAccess", bucket_name: str) -> Bucket:
        if not bucket_name:
            raise RuntimeError("Bucket name requis.")
        account = access.account
        if not access.capabilities.can_manage_buckets:
            allowed = self.list_existing_user_bucket_access(user, access.account, access.role)
            if bucket_name not in allowed:
                raise RuntimeError("Accès bucket non autorisé.")
        try:
            rgw_admin = self._supervision_admin_for_account(account)
        except RGWAdminError as exc:  # pragma: no cover - defensive path
            logger.warning("Unable to initialize RGW admin client for bucket stats: %s", exc)
            raise RuntimeError("Impossible d'initialiser le client RGW.") from exc
        try:
            scope_kwargs: dict = {}
            account_uid = resolve_admin_uid(account.rgw_account_id, account.rgw_user_uid)
            if account_uid:
                scope_kwargs["uid"] = account_uid
            stats = rgw_admin.get_bucket_info(bucket_name, allow_not_found=True, **scope_kwargs)
            if stats is None and scope_kwargs:
                stats = rgw_admin.get_bucket_info(bucket_name, allow_not_found=True)
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
