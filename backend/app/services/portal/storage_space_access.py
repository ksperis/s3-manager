# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import copy
from typing import TYPE_CHECKING, cast, Optional, TypeGuard

from app.db import (
    AccountIAMUser,
    PortalAccountRole,
    PortalStorageSpaceGrant,
    PortalStorageSpaceMetadata,
    S3Account,
    UiGroupS3Account,
    User,
    UserS3Account,
    UserUiGroup,
)
from app.models.portal import (
    PortalStorageSpaceRole,
    PortalStorageSpaceShareScope,
    PortalStorageSpaceVisibility,
)
from app.services.rgw_iam import RGWIAMService
from app.utils.account_roles import PortalAccountRoleValue, max_portal_account_role

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess


class PortalStorageSpaceAccessMixin:
    def _metadata_visibility(
        self,
        metadata: PortalStorageSpaceMetadata | None,
    ) -> PortalStorageSpaceVisibility:
        if metadata is None:
            return "private"
        return cast(PortalStorageSpaceVisibility, metadata.visibility)

    def _metadata_share_scope(
        self,
        metadata: PortalStorageSpaceMetadata | None,
    ) -> PortalStorageSpaceShareScope:
        if metadata is None:
            return "restricted"
        return cast(PortalStorageSpaceShareScope, metadata.share_scope)

    def _metadata_account_member_role(
        self,
        metadata: PortalStorageSpaceMetadata | None,
    ) -> Optional[PortalStorageSpaceRole]:
        if metadata is None:
            return None
        return cast(Optional[PortalStorageSpaceRole], metadata.account_member_role)

    def _storage_space_role_is_valid(
        self,
        role: Optional[str],
    ) -> TypeGuard[PortalStorageSpaceRole]:
        return role in {"Viewer", "Editor", "Owner", "Manager"}

    def _best_storage_space_role(self, *roles: Optional[str]) -> Optional[PortalStorageSpaceRole]:
        best: Optional[PortalStorageSpaceRole] = None
        for role in roles:
            if not self._storage_space_role_is_valid(role):
                continue
            if best is None or self._role_precedence(role) > self._role_precedence(best):
                best = role
        return best

    def _portal_account_member_map(
        self,
        account: S3Account,
    ) -> dict[int, tuple[User, PortalAccountRoleValue, set[str]]]:
        rows_by_user: dict[int, tuple[User, PortalAccountRoleValue, set[str]]] = {}

        def merge(
            user: User,
            portal_role: Optional[PortalAccountRoleValue],
            source: str,
        ) -> None:
            if portal_role not in {
                PortalAccountRole.PORTAL_USER.value,
                PortalAccountRole.PORTAL_MANAGER.value,
            }:
                return
            if not bool(user.is_active):
                return
            current = rows_by_user.get(user.id)
            effective_portal_role = max_portal_account_role(
                current[1] if current else None,
                portal_role,
            )
            if effective_portal_role is None:
                return
            sources = set(current[2]) if current else set()
            sources.add(source)
            rows_by_user[user.id] = (user, effective_portal_role, sources)

        direct_rows = (
            self.db.query(User, UserS3Account.portal_role)
            .join(UserS3Account, UserS3Account.user_id == User.id)
            .filter(UserS3Account.account_id == account.id)
            .all()
        )
        for user, portal_role in direct_rows:
            merge(user, portal_role, "direct")

        group_rows = (
            self.db.query(User, UiGroupS3Account.portal_role)
            .join(UserUiGroup, UserUiGroup.user_id == User.id)
            .join(UiGroupS3Account, UiGroupS3Account.group_id == UserUiGroup.group_id)
            .filter(UiGroupS3Account.account_id == account.id)
            .all()
        )
        for user, portal_role in group_rows:
            merge(user, portal_role, "group")

        return rows_by_user

    def _storage_space_effective_role(
        self,
        user: User,
        access: "AccountAccess",
        metadata: PortalStorageSpaceMetadata | None,
        role: Optional[PortalStorageSpaceRole],
        *,
        include_archived: bool = False,
    ) -> Optional[PortalStorageSpaceRole]:
        if metadata is None:
            return None
        if metadata.archived_at and not include_archived:
            return None
        if metadata.owner_user_id == user.id:
            return "Owner"
        if access.portal_role == PortalAccountRole.PORTAL_MANAGER.value:
            return "Manager"
        if metadata.archived_at:
            return role if include_archived and role in {"Owner", "Manager"} else None
        if self._metadata_visibility(metadata) != "shared":
            return None
        return role

    def _storage_space_roles_by_bucket(
        self,
        target: User,
        account: S3Account,
        portal_role: str,
        *,
        include_archived: bool = False,
    ) -> dict[str, PortalStorageSpaceRole]:
        if portal_role not in {PortalAccountRole.PORTAL_MANAGER.value, PortalAccountRole.PORTAL_USER.value}:
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
            if portal_role == PortalAccountRole.PORTAL_MANAGER.value:
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

    def _user_s3_account_portal_role(
        self,
        user_id: int,
        account_id: int,
    ) -> Optional[str]:
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if account is None:
            return None
        row = self._portal_account_member_map(account).get(user_id)
        return row[1] if row else None

    def list_existing_user_bucket_access(self, target: User, account: S3Account, portal_role: str) -> list[str]:
        """Read bucket permissions without provisioning IAM user/key side effects."""
        return sorted(self.list_existing_user_storage_space_access(target, account, portal_role).keys())

    def list_existing_user_storage_space_access(
        self,
        target: User,
        account: S3Account,
        portal_role: str,
    ) -> dict[str, PortalStorageSpaceRole]:
        """Read active Storage Space permissions from DB without IAM side effects."""
        return self._storage_space_roles_by_bucket(target, account, portal_role)

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
        portal_role: str,
        iam_service: RGWIAMService,
        iam_username: Optional[str],
    ) -> None:
        access_by_bucket = (
            {}
            if portal_role == PortalAccountRole.PORTAL_MANAGER.value
            else self._storage_space_roles_by_bucket(user, account, portal_role)
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
                if role == PortalAccountRole.PORTAL_MANAGER.value
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
        for target, portal_role, iam_username in rows:
            if portal_role not in {PortalAccountRole.PORTAL_MANAGER.value, PortalAccountRole.PORTAL_USER.value}:
                continue
            self._sync_user_group_membership(
                iam_service,
                iam_username,
                portal_role,
                account=account,
            )
            self._sync_user_storage_space_projection(target, account, portal_role, iam_service, iam_username)

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
