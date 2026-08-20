# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import copy
from typing import Optional

from app.db import (
    AccountIAMUser,
    AccountRole,
    PortalStorageSpaceGrant,
    PortalStorageSpaceMetadata,
    S3Account,
    User,
)
from app.models.portal import PortalStorageSpaceRole
from app.services.rgw_iam import RGWIAMService


class PortalStorageSpaceAccessMixin:
    def _db_storage_space_access(
        self,
        target: User,
        account: S3Account,
        account_role: str,
        *,
        include_archived: bool = False,
    ) -> dict[str, PortalStorageSpaceRole]:
        if account_role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            return {}
        rows = (
            self.db.query(PortalStorageSpaceMetadata, PortalStorageSpaceGrant.role)
            .outerjoin(
                PortalStorageSpaceGrant,
                (PortalStorageSpaceGrant.storage_space_metadata_id == PortalStorageSpaceMetadata.id)
                & (PortalStorageSpaceGrant.user_id == target.id),
            )
            .filter(PortalStorageSpaceMetadata.account_id == account.id)
            .all()
        )
        access_by_bucket: dict[str, PortalStorageSpaceRole] = {}
        for metadata, grant_role in rows:
            if metadata.archived_at and not include_archived:
                continue
            if account_role == AccountRole.PORTAL_MANAGER.value:
                access_by_bucket[metadata.bucket_name] = "Manager"
                continue
            if metadata.owner_user_id == target.id:
                access_by_bucket[metadata.bucket_name] = "Owner"
                continue
            if (metadata.archived_at and not include_archived) or self._metadata_visibility(metadata) != "shared":
                continue
            role = self._best_storage_space_role(
                self._metadata_account_member_role(metadata),
                grant_role,
            )
            if role:
                access_by_bucket[metadata.bucket_name] = role
        return access_by_bucket

    def _db_storage_space_content_access(
        self,
        target: User,
        account: S3Account,
        account_role: str,
        *,
        include_archived: bool = False,
    ) -> dict[str, PortalStorageSpaceRole]:
        if account_role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            return {}
        rows = (
            self.db.query(PortalStorageSpaceMetadata, PortalStorageSpaceGrant.role)
            .outerjoin(
                PortalStorageSpaceGrant,
                (PortalStorageSpaceGrant.storage_space_metadata_id == PortalStorageSpaceMetadata.id)
                & (PortalStorageSpaceGrant.user_id == target.id),
            )
            .filter(PortalStorageSpaceMetadata.account_id == account.id)
            .all()
        )
        access_by_bucket: dict[str, PortalStorageSpaceRole] = {}
        for metadata, grant_role in rows:
            if metadata.archived_at and not include_archived:
                continue
            if account_role == AccountRole.PORTAL_MANAGER.value:
                access_by_bucket[metadata.bucket_name] = "Manager"
                continue
            if metadata.owner_user_id == target.id:
                access_by_bucket[metadata.bucket_name] = "Owner"
                continue
            if self._metadata_visibility(metadata) != "shared":
                continue
            role = self._best_storage_space_role(
                self._metadata_account_member_role(metadata),
                grant_role,
            )
            if role:
                access_by_bucket[metadata.bucket_name] = role
        return access_by_bucket

    def _user_s3_account_role(self, user_id: int, account_id: int) -> Optional[str]:
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if account is None:
            return None
        row = self._portal_account_member_map(account).get(user_id)
        return row[1] if row else None

    def _sync_user_storage_space_policy_projection(
        self,
        iam_service: RGWIAMService,
        iam_username: Optional[str],
        access_by_bucket: dict[str, PortalStorageSpaceRole],
    ) -> None:
        if not iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        policy = iam_service.get_user_inline_policy(iam_username, self._bucket_access_policy_name) or {}
        statements = policy.get("Statement") or []
        if not isinstance(statements, list):
            statements = [statements]
        managed_sids = {self._bucket_access_sid, *self._storage_space_share_sids()}
        next_statements = [
            copy.deepcopy(stmt)
            for stmt in statements
            if isinstance(stmt, dict) and stmt.get("Sid") not in managed_sids
        ]
        for role in ("Viewer", "Editor", "Owner"):
            resources: list[str] = []
            for bucket_name, bucket_role in sorted(access_by_bucket.items()):
                if bucket_role != role:
                    continue
                resources.extend(self._bucket_arns(bucket_name))
            if resources:
                next_statements.append(
                    {
                        "Sid": self._storage_space_share_sid(role),
                        "Effect": "Allow",
                        "Action": self._storage_space_role_actions(role),
                        "Resource": resources,
                    }
                )
        if next_statements:
            iam_service.put_user_inline_policy(
                iam_username,
                self._bucket_access_policy_name,
                {
                    "Version": policy.get("Version") or "2012-10-17",
                    "Statement": next_statements,
                },
            )
            return
        iam_service.delete_user_inline_policy(iam_username, self._bucket_access_policy_name)

    def _sync_user_storage_space_projection(
        self,
        user: User,
        account: S3Account,
        account_role: str,
        iam_service: RGWIAMService,
        iam_username: Optional[str],
    ) -> None:
        access_by_bucket = (
            {}
            if account_role == AccountRole.PORTAL_MANAGER.value
            else self._db_storage_space_content_access(user, account, account_role)
        )
        self._sync_user_storage_space_policy_projection(iam_service, iam_username, access_by_bucket)

    def _storage_space_participant_user_ids(self, metadata: PortalStorageSpaceMetadata) -> set[int]:
        user_ids: set[int] = set()
        if metadata.owner_user_id is not None:
            user_ids.add(metadata.owner_user_id)
        grant_rows = (
            self.db.query(PortalStorageSpaceGrant.user_id)
            .filter(PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id)
            .all()
        )
        user_ids.update(user_id for (user_id,) in grant_rows if user_id is not None)
        account = self.db.query(S3Account).filter(S3Account.id == metadata.account_id).first()
        if account is not None:
            user_ids.update(
                user_id
                for user_id, (_target, role, _sources) in self._portal_account_member_map(account).items()
                if role == AccountRole.PORTAL_MANAGER.value
            )
        if self._metadata_account_member_role(metadata) and account is not None:
            user_ids.update(self._portal_account_member_map(account))
        return user_ids

    def _sync_storage_space_participant_projections(
        self,
        account: S3Account,
        metadata: PortalStorageSpaceMetadata,
        *,
        extra_user_ids: Optional[set[int]] = None,
    ) -> None:
        participant_user_ids = self._storage_space_participant_user_ids(metadata)
        if extra_user_ids:
            participant_user_ids.update(extra_user_ids)
        self._sync_storage_space_user_projections(account, participant_user_ids)

    def _sync_storage_space_user_projections(
        self,
        account: S3Account,
        user_ids: set[int],
    ) -> None:
        if not user_ids:
            return
        rows = (
            self.db.query(User, AccountIAMUser.iam_username)
            .outerjoin(
                AccountIAMUser,
                (AccountIAMUser.user_id == User.id) & (AccountIAMUser.account_id == account.id),
            )
            .filter(User.id.in_(user_ids))
            .all()
        )
        member_roles = {user_id: row[1] for user_id, row in self._portal_account_member_map(account).items()}
        rows = [(target, member_roles.get(target.id), iam_username) for target, iam_username in rows if iam_username]
        if not rows:
            return
        iam_service = self._get_iam_service(account)
        for target, account_role, iam_username in rows:
            if account_role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
                continue
            self._sync_user_group_membership(
                iam_service,
                iam_username,
                account_role,
                account=account,
            )
            self._sync_user_storage_space_projection(target, account, account_role, iam_service, iam_username)

    def _sync_storage_space_access_projection(
        self,
        account: S3Account,
        metadata: PortalStorageSpaceMetadata,
        *,
        extra_user_ids: Optional[set[int]] = None,
        sync_participants: bool = True,
        sync_bucket_policy: bool = True,
    ) -> None:
        if sync_participants:
            self._sync_storage_space_participant_projections(
                account,
                metadata,
                extra_user_ids=extra_user_ids,
            )
        if sync_bucket_policy:
            self._sync_storage_space_bucket_policy(account, metadata.bucket_name, metadata)
