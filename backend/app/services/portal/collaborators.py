# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from app.db import (
    PortalAccountRole,
    PortalExternalAccessCredential,
    PortalStorageSpaceGrant,
    PortalStorageSpaceMetadata,
    S3Account,
    UiGroupS3Account,
    User,
    UserS3Account,
    UserUiGroup,
)
from app.models.portal_storage_spaces import (
    PortalStorageSpaceCollaboratorPreview,
    PortalStorageSpaceGrantRole,
    PortalStorageSpaceRole,
)
from app.models.portal_sharing import (
    PortalCollaborator,
    PortalCollaboratorAccessReview,
    PortalCollaboratorStorageSpaceAccess,
    PortalCollaboratorSummary,
    PortalCollaboratorTrend,
    PortalCollaboratorsResponse,
)
from app.services.user_avatar_service import UserAvatarService
from app.utils.time import utcnow

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess


COLLABORATOR_TREND_WINDOWS: tuple[tuple[str, str, int], ...] = (
    ("month", "last 30 days", 28),
    ("week", "last week", 6),
    ("day", "yesterday", 1),
)
STORAGE_SPACE_COLLABORATOR_PREVIEW_LIMIT = 5


class PortalCollaboratorsMixin:
    def _storage_space_collaborator_previews(
        self,
        account: S3Account,
        metadata_rows: list[PortalStorageSpaceMetadata],
    ) -> dict[str, tuple[list[PortalStorageSpaceCollaboratorPreview], int]]:
        if not metadata_rows:
            return {}
        member_map = self._portal_account_member_map(account)
        users_by_id = {user_id: member[0] for user_id, member in member_map.items()}
        owner_user_ids = {metadata.owner_user_id for metadata in metadata_rows if metadata.owner_user_id is not None}
        missing_owner_ids = owner_user_ids - set(users_by_id)
        if missing_owner_ids:
            users_by_id.update(
                {
                    target.id: target
                    for target in self.db.query(User).filter(User.id.in_(missing_owner_ids)).all()
                }
            )

        metadata_ids = [metadata.id for metadata in metadata_rows if metadata.id is not None]
        grants_by_metadata_id: dict[int, list[tuple[User, PortalStorageSpaceGrantRole]]] = {}
        if metadata_ids:
            grant_rows = (
                self.db.query(PortalStorageSpaceGrant.storage_space_metadata_id, PortalStorageSpaceGrant.role, User)
                .join(User, User.id == PortalStorageSpaceGrant.user_id)
                .filter(PortalStorageSpaceGrant.storage_space_metadata_id.in_(metadata_ids))
                .all()
            )
            for metadata_id, role, target in grant_rows:
                if role not in {"Viewer", "Editor"}:
                    continue
                users_by_id[target.id] = target
                grants_by_metadata_id.setdefault(metadata_id, []).append((target, role))

        avatar_service = UserAvatarService(self.db)
        result: dict[str, tuple[list[PortalStorageSpaceCollaboratorPreview], int]] = {}
        for metadata in metadata_rows:
            roles_by_user_id: dict[int, PortalStorageSpaceRole] = {}
            if self._metadata_visibility(metadata) == "private" and metadata.owner_user_id in users_by_id:
                roles_by_user_id[metadata.owner_user_id] = "Owner"
            if self._metadata_visibility(metadata) == "shared":
                if self._metadata_share_scope(metadata) == "account":
                    default_role = self._metadata_account_member_role(metadata) or "Editor"
                    for user_id, (_target, portal_role, _sources) in member_map.items():
                        if portal_role != PortalAccountRole.PORTAL_USER.value:
                            continue
                        roles_by_user_id[user_id] = self._best_storage_space_role(
                            roles_by_user_id.get(user_id),
                            default_role,
                        ) or default_role
                elif metadata.id is not None:
                    for target, grant_role in grants_by_metadata_id.get(metadata.id, []):
                        roles_by_user_id[target.id] = self._best_storage_space_role(
                            roles_by_user_id.get(target.id),
                            grant_role,
                        ) or grant_role

            previews = [
                PortalStorageSpaceCollaboratorPreview(
                    user_id=user_id,
                    email=target.email,
                    display_name=target.full_name,
                    role=role,
                    avatar=avatar_service.descriptor(target),
                )
                for user_id, role in roles_by_user_id.items()
                if (target := users_by_id.get(user_id)) is not None
            ]
            previews.sort(key=lambda item: ((item.display_name or item.email).lower(), item.email.lower()))
            result[metadata.bucket_name] = (
                previews[:STORAGE_SPACE_COLLABORATOR_PREVIEW_LIMIT],
                len(previews),
            )
        return result

    def _portal_access_source(self, sources: set[str]) -> str:
        if sources == {"direct"}:
            return "direct"
        if sources == {"group"}:
            return "group"
        return "direct_and_group"

    def _portal_collaborator_source_dates(
        self,
        account: S3Account,
        user_ids: set[int],
    ) -> dict[int, dict[str, datetime]]:
        dates_by_user: dict[int, dict[str, datetime]] = {user_id: {} for user_id in user_ids}
        if not user_ids:
            return dates_by_user

        direct_rows = (
            self.db.query(UserS3Account.user_id, UserS3Account.created_at)
            .filter(
                UserS3Account.account_id == account.id,
                UserS3Account.user_id.in_(user_ids),
            )
            .all()
        )
        for user_id, created_at in direct_rows:
            if created_at is not None:
                dates_by_user.setdefault(user_id, {})["direct"] = created_at

        group_rows = (
            self.db.query(User.id, UserUiGroup.created_at, UiGroupS3Account.created_at)
            .join(UserUiGroup, UserUiGroup.user_id == User.id)
            .join(UiGroupS3Account, UiGroupS3Account.group_id == UserUiGroup.group_id)
            .filter(
                User.id.in_(user_ids),
                UiGroupS3Account.account_id == account.id,
            )
            .all()
        )
        for user_id, group_member_at, group_account_at in group_rows:
            source_dates = [value for value in (group_member_at, group_account_at) if value is not None]
            if not source_dates:
                continue
            effective_at = max(source_dates)
            current = dates_by_user.setdefault(user_id, {}).get("group")
            if current is None or effective_at < current:
                dates_by_user[user_id]["group"] = effective_at

        return dates_by_user

    def _portal_collaborator_member_since(
        self,
        target: User,
        sources: set[str],
        source_dates: dict[str, datetime] | None,
    ) -> datetime | None:
        dated_sources = [source_dates[source] for source in sources if source_dates and source in source_dates]
        if dated_sources:
            return min(dated_sources)
        return target.created_at

    def _portal_collaborator_trend(self, collaborators: list[PortalCollaborator]) -> PortalCollaboratorTrend | None:
        if not collaborators:
            return None
        today = utcnow().date()
        for window, label, min_age_days in COLLABORATOR_TREND_WINDOWS:
            cutoff = today - timedelta(days=min_age_days)
            baseline_count = sum(
                1
                for collaborator in collaborators
                if collaborator.member_since is not None and collaborator.member_since.date() <= cutoff
            )
            if baseline_count > 0 or window == "day":
                return PortalCollaboratorTrend(
                    window=window,
                    label=label,
                    period_start=cutoff.isoformat(),
                    collaborator_count=baseline_count,
                )
        return None

    def _portal_external_access_key_count(self, user: User, access: "AccountAccess") -> int:
        visible_bucket_names = {
            space.internal_bucket_name or space.id
            for space in self.list_storage_spaces(user, access)
            if space.internal_bucket_name or space.id
        }
        if not visible_bucket_names:
            return 0
        return (
            self.db.query(PortalExternalAccessCredential)
            .filter(
                PortalExternalAccessCredential.account_id == access.account.id,
                PortalExternalAccessCredential.bucket_name.in_(visible_bucket_names),
                PortalExternalAccessCredential.status == "Active",
                PortalExternalAccessCredential.revoked_at.is_(None),
            )
            .count()
        )

    def list_portal_collaborators(
        self,
        user: User,
        access: "AccountAccess",
    ) -> PortalCollaboratorsResponse:
        member_map = self._portal_account_member_map(access.account)
        source_dates = self._portal_collaborator_source_dates(access.account, set(member_map))
        collaborators = [
            PortalCollaborator(
                user_id=user_id,
                email=target.email,
                display_name=target.full_name,
                portal_role=portal_role,
                access_source=self._portal_access_source(sources),
                member_since=self._portal_collaborator_member_since(target, sources, source_dates.get(user_id)),
                avatar=UserAvatarService(self.db).descriptor(target),
                can_review_access=access.capabilities.can_manage_portal_users or user.id == user_id,
            )
            for user_id, (target, portal_role, sources) in member_map.items()
        ]
        collaborators = sorted(collaborators, key=lambda item: item.email.lower())
        return PortalCollaboratorsResponse(
            summary=PortalCollaboratorSummary(
                collaborator_count=len(collaborators),
                external_access_key_count=self._portal_external_access_key_count(user, access),
                trend=self._portal_collaborator_trend(collaborators),
            ),
            collaborators=collaborators,
        )

    def get_portal_collaborator_access_review(
        self,
        user: User,
        access: "AccountAccess",
        target_user_id: int,
    ) -> PortalCollaboratorAccessReview:
        member_map = self._portal_account_member_map(access.account)
        member = member_map.get(target_user_id)
        if member is None:
            raise RuntimeError("Portal collaborator not found.")
        if user.id != target_user_id and not access.capabilities.can_manage_portal_users:
            raise RuntimeError("Reviewing this collaborator is not allowed.")

        target, portal_role, sources = member
        source_dates = self._portal_collaborator_source_dates(access.account, {target_user_id})
        collaborator = PortalCollaborator(
            user_id=target.id,
            email=target.email,
            display_name=target.full_name,
            portal_role=portal_role,
            access_source=self._portal_access_source(sources),
            member_since=self._portal_collaborator_member_since(
                target,
                sources,
                source_dates.get(target_user_id),
            ),
            avatar=UserAvatarService(self.db).descriptor(target),
            can_review_access=True,
        )

        rows = (
            self.db.query(PortalStorageSpaceMetadata, PortalStorageSpaceGrant.role)
            .outerjoin(
                PortalStorageSpaceGrant,
                (PortalStorageSpaceGrant.storage_space_metadata_id == PortalStorageSpaceMetadata.id)
                & (PortalStorageSpaceGrant.user_id == target_user_id),
            )
            .filter(
                PortalStorageSpaceMetadata.account_id == access.account.id,
                PortalStorageSpaceMetadata.archived_at.is_(None),
            )
            .all()
        )
        space_accesses: list[PortalCollaboratorStorageSpaceAccess] = []
        for metadata, grant_role in rows:
            role: PortalStorageSpaceRole | None = None
            source = None
            if metadata.owner_user_id == target_user_id:
                role = "Owner"
                source = "owner"
            elif portal_role == PortalAccountRole.PORTAL_MANAGER.value:
                role = "Manager"
                source = "project_manager"
            elif (
                self._metadata_visibility(metadata) == "shared"
                and self._metadata_share_scope(metadata) == "account"
            ):
                role = self._metadata_account_member_role(metadata) or "Editor"
                source = "team"
            elif (
                self._metadata_visibility(metadata) == "shared"
                and self._metadata_share_scope(metadata) == "restricted"
                and grant_role in {"Viewer", "Editor"}
            ):
                role = grant_role
                source = "direct"
            if role is None or source is None:
                continue
            space_accesses.append(
                PortalCollaboratorStorageSpaceAccess(
                    storage_space_id=metadata.bucket_name,
                    storage_space_name=self._display_storage_space_name(metadata.bucket_name, metadata),
                    role=role,
                    source=source,
                    can_revoke=(
                        source == "direct"
                        and access.capabilities.can_manage_portal_users
                    ),
                )
            )

        space_accesses.sort(key=lambda item: (item.storage_space_name.lower(), item.storage_space_id.lower()))
        return PortalCollaboratorAccessReview(
            collaborator=collaborator,
            can_request_project_removal=(
                access.capabilities.can_manage_portal_users
                and portal_role == PortalAccountRole.PORTAL_USER.value
                and self._portal_access_source(sources) == "direct"
            ),
            space_accesses=space_accesses,
        )
