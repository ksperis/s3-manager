# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


class PortalBucketsUsersMixin:
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
        is_portal_user_creation = bool(
            access.role == AccountRole.PORTAL_USER.value and portal_defaults.allow_private_storage_space_create
        )
        can_create_bucket = bool(access.capabilities.can_manage_buckets or is_portal_user_creation)
        if not can_create_bucket:
            raise RuntimeError("Bucket creation not allowed for this role.")
        iam_service = self._get_iam_service(account)
        link, _, _ = self._ensure_portal_user(user, account, iam_service)
        self._sync_user_group_membership(
            iam_service,
            link.iam_username,
            access.role,
            portal_settings=portal_defaults,
            account=account,
        )
        # Keep the Portal identity ready for subsequent object access; bucket
        # creation itself is a controlled backend workflow.
        self._active_credentials(link, iam_service)
        bucket_access_key, bucket_secret = self._account_credentials(account)
        s3_client.create_bucket(
            bucket_name,
            access_key=bucket_access_key,
            secret_key=bucket_secret,
            **self._s3_client_kwargs(account),
        )
        if versioning_flag:
            s3_client.set_bucket_versioning(
                bucket_name,
                enabled=True,
                access_key=bucket_access_key,
                secret_key=bucket_secret,
                **self._s3_client_kwargs(account),
            )
        if portal_defaults.bucket_defaults.enable_lifecycle:
            s3_client.put_bucket_lifecycle(
                bucket_name,
                rules=self._portal_bucket_lifecycle_rules(
                    portal_defaults.bucket_defaults.noncurrent_version_expiration_days
                ),
                access_key=bucket_access_key,
                secret_key=bucket_secret,
                **self._s3_client_kwargs(account),
            )
        if portal_defaults.bucket_defaults.enable_cors:
            origins = self._normalize_origins(portal_defaults.bucket_defaults.cors_allowed_origins)
            if origins:
                s3_client.put_bucket_cors(
                    bucket_name,
                    rules=self._portal_bucket_cors_rules(origins),
                    access_key=bucket_access_key,
                    secret_key=bucket_secret,
                    **self._s3_client_kwargs(account),
                )
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
        if use_root:
            access_key, secret_key = self._account_credentials(account)
        else:
            portal_settings = self._effective_portal_settings(account)
            iam_service = self._get_iam_service(account)
            link, _, _ = self._ensure_portal_user(user, account, iam_service)
            self._sync_user_group_membership(
                iam_service,
                link.iam_username,
                access.role,
                portal_settings=portal_settings,
                account=account,
            )
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
            self._sync_user_group_membership(
                iam_service,
                link.iam_username,
                account_role,
                portal_settings=portal_settings,
                account=account,
            )
            self._sync_user_storage_space_projection(target, account, account_role, iam_service, link.iam_username)
            self._ensure_active_key(link, iam_service)
            self._sync_account_storage_space_bucket_policies(account)
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
        self.db.flush()
        self._sync_account_storage_space_bucket_policies(account)
        self._sync_portal_server_access_log_bucket_policy_if_present(account)
        self.db.commit()

    def sync_existing_portal_user_access(
        self,
        target: User,
        account: S3Account,
        account_role: Optional[str],
    ) -> None:
        """Synchronize an existing IAM identity without creating credentials.

        Administrative role changes use this path so revocations happen before
        their database transaction is committed, while first-time identities
        remain a lazy Portal bootstrap concern.
        """
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
        if account_role in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            portal_settings = self._effective_portal_settings(account)
            self._sync_user_group_membership(
                iam_service,
                link.iam_username,
                account_role,
                portal_settings=portal_settings,
                account=account,
            )
            self._sync_user_storage_space_projection(
                target,
                account,
                account_role,
                iam_service,
                link.iam_username,
            )
            self._sync_account_storage_space_bucket_policies(account)
            return

        if link.iam_username:
            self._delete_portal_iam_user(iam_service, link.iam_username)
        self.db.delete(link)
        self.db.flush()
        self._sync_account_storage_space_bucket_policies(account)
        self._sync_portal_server_access_log_bucket_policy_if_present(account)

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
        from app.services.portal_ownership import require_no_private_storage_space_ownership

        require_no_private_storage_space_ownership(
            self.db,
            user_id=target.id,
            account_id=account.id,
        )
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
        self.db.flush()
        self._sync_account_storage_space_bucket_policies(account)
        self._sync_portal_server_access_log_bucket_policy_if_present(account)
        self.db.commit()
