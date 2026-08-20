# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Optional, Tuple

from sqlalchemy.exc import IntegrityError

from app.db import (
    AccountIAMUser,
    AccountRole,
    S3Account,
    User,
)
from app.models.iam import AccessKey as ModelAccessKey, IAMUser
from app.models.portal import PortalAccessKey
from app.services import s3_client
from app.services.mappers.portal import portal_access_key_from_active_link, portal_access_key_from_iam_metadata
from app.services.rgw_admin import RGWAdminError
from app.services.rgw_iam import RGWIAMService, get_iam_service
from app.utils.s3_endpoint import resolve_s3_client_options
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.usage_stats import extract_usage_stats

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess


logger = logging.getLogger(__name__)


class PortalIamMixin:
    def _get_iam_service(self, account: S3Account) -> RGWIAMService:
        access_key, secret_key = self._account_credentials(account)
        endpoint, region, _, verify_tls = resolve_s3_client_options(account)
        return get_iam_service(
            access_key,
            secret_key,
            endpoint=endpoint,
            region=region,
            verify_tls=verify_tls,
        )

    def check_eligibility(self, user: User, access: "AccountAccess") -> tuple[bool, list[str]]:
        """Return whether the portal can be used for this account context.

        Portal is intended for RGW accounts configured with IAM semantics. This
        shell-level check is strictly local; remote IAM availability is checked
        only by the pages and actions that need it.
        """
        reasons: list[str] = []
        account = access.account
        endpoint = getattr(account, "storage_endpoint", None)
        if endpoint is None:
            reasons.append("Storage endpoint missing")
            return False, reasons

        flags = resolve_feature_flags(endpoint)
        if not flags.iam_enabled:
            reasons.append("IAM is not enabled for this endpoint")

        return (len(reasons) == 0), reasons

    def _persist_portal_key(self, link: AccountIAMUser, key: ModelAccessKey) -> PortalAccessKey:
        link.active_access_key = key.access_key_id
        link.active_secret_key = key.secret_access_key
        self.db.add(link)
        self.db.commit()
        self.db.refresh(link)
        return portal_access_key_from_iam_metadata(
            key,
            is_portal=True,
            deletable=False,
            secret_access_key=key.secret_access_key,
            is_active=True,
        )

    def _ensure_portal_user(
        self,
        user: User,
        account: S3Account,
        iam_service: RGWIAMService,
    ) -> Tuple[AccountIAMUser, Optional[IAMUser], bool]:
        link = (
            self.db.query(AccountIAMUser)
            .filter(
                AccountIAMUser.user_id == user.id,
                AccountIAMUser.account_id == account.id,
            )
            .first()
        )
        created = False
        iam_user: Optional[IAMUser] = None
        created_key: Optional[ModelAccessKey] = None

        if link and link.iam_username:
            iam_user = iam_service.get_user(link.iam_username)

        if link is None or iam_user is None:
            username = link.iam_username if link and link.iam_username else f"portal-{account.id}-{user.id}"[:63]
            iam_user, created_key = iam_service.create_user(
                username,
                create_key=True,
                allow_existing=True,
            )
            if link is None:
                link = AccountIAMUser(
                    user_id=user.id,
                    account_id=account.id,
                    iam_user_id=iam_user.user_id or iam_user.arn or username,
                    iam_username=iam_user.name,
                )
            else:
                link.iam_user_id = iam_user.user_id or iam_user.arn or username
                link.iam_username = iam_user.name
                link.active_access_key = None
                link.active_secret_key = None
            try:
                self.db.add(link)
                self.db.commit()
            except IntegrityError:
                self.db.rollback()
                link = (
                    self.db.query(AccountIAMUser)
                    .filter(
                        AccountIAMUser.user_id == user.id,
                        AccountIAMUser.account_id == account.id,
                    )
                    .first()
                )
                if not link:
                    raise
                if created_key and not link.active_access_key:
                    self._persist_portal_key(link, created_key)
            else:
                self.db.refresh(link)
                if created_key:
                    self._persist_portal_key(link, created_key)
            created = created_key is not None

        if not link.iam_user_id and iam_user:
            link.iam_user_id = iam_user.user_id or iam_user.arn or link.iam_username
            self.db.add(link)
            self.db.commit()
            self.db.refresh(link)

        if iam_user is None and link.iam_username:
            iam_user = iam_service.get_user(link.iam_username)

        return link, iam_user, created

    def _ensure_portal_groups(
        self,
        iam_service: RGWIAMService,
    ) -> None:
        """Ensure portal groups exist and carry the expected policies."""
        groups = {g.name for g in iam_service.list_groups()}
        if self._manager_group_name not in groups:
            iam_service.create_group(self._manager_group_name)
        if self._user_group_name not in groups:
            iam_service.create_group(self._user_group_name)

        for group_name in (self._manager_group_name, self._user_group_name):
            attached = iam_service.list_group_policies(group_name)
            for policy in attached:
                if policy.arn:
                    iam_service.detach_group_policy(group_name, policy.arn)

        manager_policy = self._resolve_group_policy("manager")
        if manager_policy:
            iam_service.put_group_inline_policy(self._manager_group_name, self._manager_group_policy_name, manager_policy)
        else:
            iam_service.delete_group_inline_policy(self._manager_group_name, self._manager_group_policy_name)

        user_policy = self._resolve_group_policy("user")
        if user_policy:
            iam_service.put_group_inline_policy(self._user_group_name, self._inline_policy_name, user_policy)
        else:
            iam_service.delete_group_inline_policy(self._user_group_name, self._inline_policy_name)

    def _sync_user_group_membership(
        self,
        iam_service: RGWIAMService,
        iam_username: Optional[str],
        account_role: Optional[str],
        *,
        account: Optional[S3Account] = None,
    ) -> None:
        if not iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        if account_role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            for group in (self._manager_group_name, self._user_group_name):
                try:
                    iam_service.remove_user_from_group(group, iam_username)
                except Exception as exc:  # pragma: no cover - defensive
                    logger.warning("Unable to remove %s from %s: %s", iam_username, group, exc)
            return

        # The manager group grants account-wide S3 data access. Protect the
        # technical bucket before its policy is created or updated, then remove
        # a stale deny only after a manager has left the group.
        if account is not None and account_role == AccountRole.PORTAL_MANAGER.value:
            self._sync_portal_server_access_log_bucket_policy_if_present(account)

        self._ensure_portal_groups(iam_service)
        target_group = self._manager_group_name if account_role == AccountRole.PORTAL_MANAGER.value else self._user_group_name
        other_group = self._user_group_name if target_group == self._manager_group_name else self._manager_group_name

        other_members = iam_service.list_group_users(other_group)
        remove_other_first = target_group == self._user_group_name
        if remove_other_first and any(m.name == iam_username for m in other_members):
            iam_service.remove_user_from_group(other_group, iam_username)

        members = iam_service.list_group_users(target_group)
        if not any(m.name == iam_username for m in members):
            iam_service.add_user_to_group(target_group, iam_username)

        if not remove_other_first and any(m.name == iam_username for m in other_members):
            iam_service.remove_user_from_group(other_group, iam_username)
        if account is not None and account_role == AccountRole.PORTAL_USER.value:
            self._sync_portal_server_access_log_bucket_policy_if_present(account)

    def _existing_portal_link(self, user: User, account: S3Account) -> Optional[AccountIAMUser]:
        return (
            self.db.query(AccountIAMUser)
            .filter(
                AccountIAMUser.user_id == user.id,
                AccountIAMUser.account_id == account.id,
            )
            .first()
        )

    def _active_credentials(self, link: AccountIAMUser, iam_service: RGWIAMService) -> tuple[str, str]:
        active = self._ensure_active_key(link, iam_service)
        if not active.access_key_id or not active.secret_access_key:
            raise RuntimeError("Active access key is missing for this portal user")
        return active.access_key_id, active.secret_access_key

    def get_portal_credentials(self, user: User, account: S3Account, account_role: str) -> tuple[str, str]:
        """Expose portal IAM credentials for manager access."""
        iam_service = self._get_iam_service(account)
        link, _, _ = self._ensure_portal_user(user, account, iam_service)
        self._sync_user_group_membership(
            iam_service,
            link.iam_username,
            account_role,
            account=account,
        )
        self._sync_user_storage_space_projection(user, account, account_role, iam_service, link.iam_username)
        return self._active_credentials(link, iam_service)

    def _account_usage(
        self,
        account: S3Account,
        usage_map: Optional[dict[str, tuple[Optional[int], Optional[int]]]] = None,
    ) -> tuple[Optional[int], Optional[int], Optional[int]]:
        try:
            rgw_admin = self._supervision_admin_for_account(account)
            buckets = self._admin_bucket_list(account, admin=rgw_admin)
        except (RGWAdminError, RuntimeError) as exc:  # pragma: no cover - defensive path
            logger.warning("Unable to list buckets for portal usage %s: %s", account.rgw_account_id, exc)
            return None, None, None
        used_bytes, used_objects, bucket_count = self._bucket_usage_from_list(buckets)
        if usage_map is not None:
            for bucket in buckets:
                if not isinstance(bucket, dict):
                    continue
                name = bucket.get("bucket") or bucket.get("name")
                if not name:
                    continue
                usage = bucket.get("usage")
                usage_bytes, usage_objects = extract_usage_stats(usage)
                usage_map[name] = (usage_bytes, usage_objects)
        return used_bytes, used_objects, bucket_count

    def _ensure_active_key(self, link: AccountIAMUser, iam_service: RGWIAMService) -> PortalAccessKey:
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        key_list = iam_service.list_access_keys(link.iam_username)
        active = next((k for k in key_list if k.access_key_id == link.active_access_key), None)
        if active:
            if not link.active_secret_key:
                new_key = iam_service.create_access_key(link.iam_username)
                try:
                    iam_service.delete_access_key(link.iam_username, active.access_key_id)
                except Exception as exc:  # pragma: no cover - defensive
                    logger.warning("Unable to delete incomplete access key %s: %s", active.access_key_id, exc)
                return self._persist_portal_key(link, new_key)
            return portal_access_key_from_iam_metadata(
                active,
                is_portal=True,
                deletable=False,
                secret_access_key=link.active_secret_key,
                is_active=True,
            )
        new_key = iam_service.create_access_key(link.iam_username)
        # Clean up any stale keys; we only persist the active one.
        for k in key_list:
            try:
                iam_service.delete_access_key(link.iam_username, k.access_key_id)
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Unable to delete stale access key %s: %s", k.access_key_id, exc)
        return self._persist_portal_key(link, new_key)

    def _list_access_keys(
        self,
        link: AccountIAMUser,
        iam_service: RGWIAMService,
        include_portal: bool = False,
    ) -> list[PortalAccessKey]:
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        metas = iam_service.list_access_keys(link.iam_username)
        keys: list[PortalAccessKey] = []
        for meta in metas:
            is_portal = meta.access_key_id == link.active_access_key
            if is_portal and not include_portal:
                continue
            is_active = is_portal or self._is_active_status(meta.status, default=True)
            keys.append(
                portal_access_key_from_iam_metadata(
                    meta,
                    is_portal=is_portal,
                    deletable=not is_portal,
                    is_active=is_active,
                )
            )
        # Ensure the active key is reflected even if IAM did not return metadata
        if include_portal and link.active_access_key and not any(k.access_key_id == link.active_access_key for k in keys):
            keys.insert(
                0,
                portal_access_key_from_active_link(link, include_secret=True),
            )
        return keys
