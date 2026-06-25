# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


class PortalBucketsUsersMixin:
    def list_buckets(self, account: S3Account) -> list[Bucket]:
        raise RuntimeError("Listing buckets requires user context")

    def create_bucket(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
        versioning: Optional[bool] = None,
        portal_settings: Optional[PortalSettings] = None,
    ) -> Bucket:
        account = access.account
        portal_defaults = portal_settings or self._effective_portal_settings(account)
        versioning_flag = portal_defaults.bucket_defaults.versioning if versioning is None else versioning
        iam_service = self._get_iam_service(account)
        link, _, _ = self._ensure_portal_user(user, account, iam_service)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_defaults)
        active_key_id, active_secret = self._active_credentials(link, iam_service)
        s3_client.create_bucket(
            bucket_name, access_key=active_key_id, secret_key=active_secret, **self._s3_client_kwargs(account)
        )
        is_portal_user_creation = bool(
            access.role == AccountRole.PORTAL_USER.value and portal_defaults.allow_portal_user_bucket_create
        )
        apply_bucket_defaults = bool(access.capabilities.can_manage_buckets or is_portal_user_creation)
        defaults_access_key = active_key_id
        defaults_secret = active_secret
        if apply_bucket_defaults:
            defaults_access_key, defaults_secret = self._account_credentials(account)
        if versioning_flag and apply_bucket_defaults:
            s3_client.set_bucket_versioning(
                bucket_name,
                enabled=True,
                access_key=defaults_access_key,
                secret_key=defaults_secret,
                **self._s3_client_kwargs(account),
            )
        if portal_defaults.bucket_defaults.enable_lifecycle and apply_bucket_defaults:
            s3_client.put_bucket_lifecycle(
                bucket_name,
                rules=self._portal_bucket_lifecycle_rules(),
                access_key=defaults_access_key,
                secret_key=defaults_secret,
                **self._s3_client_kwargs(account),
            )
        if portal_defaults.bucket_defaults.enable_cors and apply_bucket_defaults:
            origins = self._normalize_origins(portal_defaults.bucket_defaults.cors_allowed_origins)
            if origins:
                s3_client.put_bucket_cors(
                    bucket_name,
                    rules=self._portal_bucket_cors_rules(origins),
                    access_key=defaults_access_key,
                    secret_key=defaults_secret,
                    **self._s3_client_kwargs(account),
                )
        self._ensure_user_bucket_policy(iam_service, link.iam_username, bucket_name, portal_settings=portal_defaults)
        return Bucket(
            name=bucket_name,
            creation_date=None,
            used_bytes=None,
            object_count=None,
            quota_max_size_bytes=None,
            quota_max_objects=None,
        )

    def delete_bucket(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
        force: bool = False,
        use_root: bool = False,
    ) -> None:
        account = access.account
        portal_settings = self._effective_portal_settings(account)
        iam_service = self._get_iam_service(account)
        link, _, _ = self._ensure_portal_user(user, account, iam_service)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        if use_root:
            access_key, secret_key = self._account_credentials(account)
        else:
            access_key, secret_key = self._active_credentials(link, iam_service)
        s3_client.delete_bucket(
            bucket_name,
            force=force,
            access_key=access_key,
            secret_key=secret_key,
            **self._s3_client_kwargs(account),
        )

    def provision_portal_user(self, target: User, account: S3Account, account_role: str) -> None:
        """Create/sync IAM user and group membership immediately when roles change."""
        if account_role in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            iam_service = self._get_iam_service(account)
            link, _, _ = self._ensure_portal_user(target, account, iam_service)
            portal_settings = self._effective_portal_settings(account)
            self._sync_user_group_membership(iam_service, link.iam_username, account_role, portal_settings=portal_settings)
            self._ensure_active_key(link, iam_service)
            return
        link = (
            self.db.query(AccountIAMUser)
            .filter(
                AccountIAMUser.user_id == target.id,
                AccountIAMUser.account_id == account.id,
            )
            .first()
        )
        if not link:
            return
        iam_service = self._get_iam_service(account)
        if link.iam_username:
            self._delete_portal_iam_user(iam_service, link.iam_username)
        self.db.delete(link)
        self.db.commit()

    def _delete_portal_iam_user(self, iam_service: RGWIAMService, iam_username: str) -> None:
        iam_user = iam_service.get_user(iam_username)
        if iam_user is None:
            iam_service.delete_user(iam_username)
            return
        for key in iam_service.list_access_keys(iam_username):
            iam_service.delete_access_key(iam_username, key.access_key_id)
        for policy in iam_service.list_user_policies(iam_username):
            if policy.arn:
                iam_service.detach_user_policy(iam_username, policy.arn)
        for policy_name in iam_service.list_user_inline_policies(iam_username):
            iam_service.delete_user_inline_policy(iam_username, policy_name)
        for group in iam_service.list_groups_for_user(iam_username):
            iam_service.remove_user_from_group(group.name, iam_username)
        iam_service.delete_user(iam_username)

    def remove_portal_user(self, target: User, account: S3Account) -> None:
        link = (
            self.db.query(AccountIAMUser)
            .filter(
                AccountIAMUser.user_id == target.id,
                AccountIAMUser.account_id == account.id,
            )
            .first()
        )
        if not link:
            return
        iam_service = self._get_iam_service(account)
        if link.iam_username:
            self._delete_portal_iam_user(iam_service, link.iam_username)
        self.db.delete(link)
        self.db.commit()
