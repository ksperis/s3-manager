# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Optional

from app.db import (
    AccountIAMUser,
    PortalAccountRole,
    PortalExternalAccessCredential,
    PortalStorageSpaceGrant,
    PortalStorageSpaceMetadata,
    S3Account,
)
from app.services import s3_bucket_access
from app.utils.s3_endpoint import resolve_s3_endpoint


logger = logging.getLogger(__name__)


class PortalStorageSpaceBucketPoliciesMixin:
    @staticmethod
    def _portal_iam_principal_arns(
        account: S3Account,
        iam_username: str,
        iam_user_id: Optional[str],
    ) -> list[str]:
        username = (iam_username or "").strip()
        if not username:
            return []
        arns: list[str] = []
        if iam_user_id and str(iam_user_id).startswith("arn:"):
            arns.append(str(iam_user_id))
        arns.append(f"arn:aws:iam:::user/{username}")
        rgw_account_id = str(getattr(account, "rgw_account_id", "") or "").strip()
        if rgw_account_id:
            arns.append(f"arn:aws:iam::{rgw_account_id}:user/{username}")
        return sorted(set(arns))

    def _portal_policy_principals_for_user_ids(
        self,
        account: S3Account,
        allowed_user_ids: set[int],
    ) -> list[str]:
        if not allowed_user_ids:
            return []
        rows = (
            self.db.query(AccountIAMUser.iam_username, AccountIAMUser.iam_user_id)
            .filter(
                AccountIAMUser.account_id == account.id,
                AccountIAMUser.user_id.in_(allowed_user_ids),
                AccountIAMUser.iam_username.isnot(None),
            )
            .all()
        )
        principals: set[str] = set()
        for iam_username, iam_user_id in rows:
            principals.update(self._portal_iam_principal_arns(account, iam_username, iam_user_id))
        return sorted(principals)

    def _portal_policy_principals_for_external_credentials(
        self,
        account: S3Account,
        metadata: PortalStorageSpaceMetadata,
    ) -> list[str]:
        if metadata.id is None:
            return []
        rows = (
            self.db.query(
                PortalExternalAccessCredential.iam_username,
                PortalExternalAccessCredential.iam_user_id,
            )
            .filter(
                PortalExternalAccessCredential.account_id == account.id,
                PortalExternalAccessCredential.storage_space_metadata_id == metadata.id,
                PortalExternalAccessCredential.revoked_at.is_(None),
                PortalExternalAccessCredential.status == "Active",
            )
            .all()
        )
        principals: set[str] = set()
        for iam_username, iam_user_id in rows:
            principals.update(self._portal_iam_principal_arns(account, iam_username, iam_user_id))
        return sorted(principals)

    def _portal_manager_principal_arns(self, account: S3Account) -> list[str]:
        manager_user_ids = {
            user_id
            for user_id, (_target, role, _sources) in self._portal_account_member_map(account).items()
            if role == PortalAccountRole.PORTAL_MANAGER.value
        }
        return self._portal_policy_principals_for_user_ids(account, manager_user_ids)

    def _portal_storage_space_allowed_user_ids(
        self,
        account: S3Account,
        metadata: PortalStorageSpaceMetadata,
    ) -> set[int]:
        if metadata.archived_at:
            return set()
        allowed_user_ids: set[int] = {
            user_id
            for user_id, (_target, role, _sources) in self._portal_account_member_map(account).items()
            if role == PortalAccountRole.PORTAL_MANAGER.value
        }
        if metadata.owner_user_id is not None:
            allowed_user_ids.add(metadata.owner_user_id)
        if self._metadata_visibility(metadata) != "shared":
            return allowed_user_ids
        if self._metadata_share_scope(metadata) == "account":
            allowed_user_ids.update(self._portal_account_member_map(account))
            return allowed_user_ids
        if metadata.id is None:
            return allowed_user_ids
        grant_rows = (
            self.db.query(PortalStorageSpaceGrant.user_id)
            .filter(PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id)
            .all()
        )
        allowed_user_ids.update(user_id for (user_id,) in grant_rows if user_id is not None)
        return allowed_user_ids

    def _portal_storage_space_technical_principal_arns(self, account: S3Account) -> list[str]:
        principals: set[str] = set()
        rgw_account_id = str(getattr(account, "rgw_account_id", "") or "").strip()
        if rgw_account_id:
            principals.add(f"arn:aws:iam::{rgw_account_id}:root")
        rgw_user_uid = str(getattr(account, "rgw_user_uid", "") or "").strip()
        if rgw_user_uid:
            principals.update(self._portal_iam_principal_arns(account, rgw_user_uid, None))
        return sorted(principals)

    def _portal_policy_principals_for_space(
        self,
        account: S3Account,
        metadata: PortalStorageSpaceMetadata,
    ) -> list[str]:
        allowed_user_ids = self._portal_storage_space_allowed_user_ids(account, metadata)
        user_principals = self._portal_policy_principals_for_user_ids(account, allowed_user_ids)
        external_principals = self._portal_policy_principals_for_external_credentials(account, metadata)
        if not user_principals and not external_principals:
            return []
        principals = {*user_principals, *external_principals}
        if self._metadata_visibility(metadata) == "shared":
            principals.update(self._portal_storage_space_technical_principal_arns(account))
        return sorted(principals)

    def _sync_storage_space_bucket_policy(
        self,
        account: S3Account,
        bucket_name: str,
        metadata: PortalStorageSpaceMetadata,
    ) -> None:
        if not resolve_s3_endpoint(account):
            logger.debug("Skipping Portal Storage Space bucket policy sync without S3 endpoint: %s", bucket_name)
            return
        access_key, secret_key = self._account_credentials(account)
        kwargs = self._s3_client_kwargs(account)
        existing_policy = s3_bucket_access.get_bucket_policy(
            bucket_name,
            access_key=access_key,
            secret_key=secret_key,
            **kwargs,
        )
        policy = self._storage_space_bucket_policy(account, bucket_name, metadata, existing_policy)
        if policy is not None:
            s3_bucket_access.put_bucket_policy(
                bucket_name,
                policy=policy,
                access_key=access_key,
                secret_key=secret_key,
                **kwargs,
            )
            return
        if self._without_storage_space_policy_statements(existing_policy) is None and isinstance(existing_policy, dict):
            s3_bucket_access.delete_bucket_policy(
                bucket_name,
                access_key=access_key,
                secret_key=secret_key,
                **kwargs,
            )
        elif isinstance(existing_policy, dict):
            cleaned = self._without_storage_space_policy_statements(existing_policy)
            if cleaned is not None:
                s3_bucket_access.put_bucket_policy(
                    bucket_name,
                    policy=cleaned,
                    access_key=access_key,
                    secret_key=secret_key,
                    **kwargs,
                )

    def _sync_account_storage_space_bucket_policies(self, account: S3Account) -> None:
        metadata_rows = (
            self.db.query(PortalStorageSpaceMetadata)
            .filter(PortalStorageSpaceMetadata.account_id == account.id)
            .all()
        )
        for metadata in metadata_rows:
            self._sync_storage_space_access_projection(account, metadata, sync_participants=False)
