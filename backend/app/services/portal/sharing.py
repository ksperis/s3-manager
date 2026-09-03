# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from app.db import (
    PortalAccountRole,
    PortalPublicLink as DBPortalPublicLink,
    PortalStorageSpaceGrant,
    PortalStorageSpaceMetadata,
    S3Account,
    User,
)
from app.models.portal_storage_spaces import (
    PortalStorageSpaceGrantRole,
    PortalStorageSpaceInitialShare,
    PortalStorageSpaceShareScope,
    PortalStorageSpaceSummary,
    PortalStorageSpaceVisibility,
)
from app.models.portal_sharing import (
    PortalStorageSpaceAccessPerson,
    PortalStorageSpaceAccessSummary,
    PortalStorageSpaceShare,
    PortalStorageSpaceShareCandidate,
)
from app.services.user_avatar_service import UserAvatarService
from app.utils.time import utcnow

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess


class PortalSharingMixin:
    def _storage_space_share_card(
        self,
        actor: User,
        target: User,
        storage_space: PortalStorageSpaceSummary,
        role: PortalStorageSpaceGrantRole,
    ) -> PortalStorageSpaceShare:
        return PortalStorageSpaceShare(
            id=f"{storage_space.id}:{target.id}",
            storage_space_id=storage_space.id,
            storage_space_name=storage_space.name,
            user_id=target.id,
            email=target.email,
            role=role,
            direction="with_me" if actor.id == target.id else "by_me",
            activity_label="Active",
        )

    def _validate_initial_storage_space_shares(
        self,
        user: User,
        access: "AccountAccess",
        *,
        visibility: PortalStorageSpaceVisibility,
        share_scope: PortalStorageSpaceShareScope,
        initial_shares: Optional[list[PortalStorageSpaceInitialShare]],
        owner_user_id: Optional[int] = None,
    ) -> list[PortalStorageSpaceInitialShare]:
        shares = initial_shares or []
        if not shares:
            return []
        if visibility != "shared" or share_scope != "restricted":
            raise RuntimeError("Initial shares are allowed only for restricted shared Storage Spaces.")
        if access.portal_role != PortalAccountRole.PORTAL_MANAGER.value:
            raise RuntimeError("Only project managers can configure team Storage Space access.")
        member_map = self._portal_account_member_map(access.account)
        seen_user_ids: set[int] = set()
        validated: list[PortalStorageSpaceInitialShare] = []
        for share in shares:
            if share.user_id in seen_user_ids:
                raise RuntimeError("Duplicate initial share user.")
            member = member_map.get(share.user_id)
            if member is None or member[1] != PortalAccountRole.PORTAL_USER.value:
                raise RuntimeError("Only Portal users can receive an explicit team Storage Space role.")
            seen_user_ids.add(share.user_id)
            validated.append(share)
        return validated

    def _add_storage_space_initial_grants(
        self,
        metadata: PortalStorageSpaceMetadata,
        user: User,
        initial_shares: list[PortalStorageSpaceInitialShare],
    ) -> None:
        for share in initial_shares:
            grant = (
                self.db.query(PortalStorageSpaceGrant)
                .filter(
                    PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id,
                    PortalStorageSpaceGrant.user_id == share.user_id,
                )
                .first()
            )
            if grant is None:
                grant = PortalStorageSpaceGrant(
                    storage_space_metadata_id=metadata.id,
                    user_id=share.user_id,
                    role=share.role,
                    created_by_user_id=user.id,
                )
            else:
                grant.role = share.role
                grant.updated_at = utcnow()
            self.db.add(grant)

    def _storage_space_owner_person(
        self,
        metadata: PortalStorageSpaceMetadata | None,
        account: S3Account,
    ) -> PortalStorageSpaceAccessPerson | None:
        if metadata is None or self._metadata_visibility(metadata) != "private":
            return None
        owner: User | None = None
        if metadata and metadata.owner_user_id is not None:
            owner = self.db.query(User).filter(User.id == metadata.owner_user_id).first()
        if owner is None:
            raise RuntimeError("Private Storage Space owner is missing.")
        member = self._portal_account_member_map(account).get(owner.id)
        return PortalStorageSpaceAccessPerson(
            user_id=owner.id,
            email=owner.email,
            display_name=owner.full_name,
            role="Owner",
            portal_role=member[1] if member else None,
            access_source="owner",
            avatar=UserAvatarService(self.db).descriptor(owner),
        )

    def _storage_space_effective_access_user_ids(self, metadata: PortalStorageSpaceMetadata) -> set[int]:
        if metadata.archived_at:
            return set()
        user_ids: set[int] = set()
        if metadata.owner_user_id is not None:
            user_ids.add(metadata.owner_user_id)
        account = self.db.query(S3Account).filter(S3Account.id == metadata.account_id).first()
        if account is not None:
            user_ids.update(
                user_id
                for user_id, (_target, role, _sources) in self._portal_account_member_map(account).items()
                if role == PortalAccountRole.PORTAL_MANAGER.value
            )
        if self._metadata_visibility(metadata) != "shared":
            return user_ids
        if self._metadata_share_scope(metadata) == "account":
            if account is not None:
                user_ids.update(
                    user_id
                    for user_id, (_target, role, _sources) in self._portal_account_member_map(account).items()
                    if role == PortalAccountRole.PORTAL_USER.value
                )
            return user_ids
        grant_rows = (
            self.db.query(PortalStorageSpaceGrant.user_id)
            .filter(PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id)
            .all()
        )
        user_ids.update(user_id for (user_id,) in grant_rows if user_id is not None)
        return user_ids

    def get_storage_space_access_summary(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
    ) -> PortalStorageSpaceAccessSummary:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id, include_archived=True)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        metadata = self._storage_space_metadata(access.account, bucket_name)
        if metadata is None:
            raise RuntimeError("Storage space metadata is missing.")
        storage_space = next(
            (
                item
                for item in self.list_storage_spaces(user, access, include_archived=True)
                if item.id == space_id or item.internal_bucket_name == bucket_name
            ),
            None,
        )
        if storage_space is None:
            raise RuntimeError("Storage space not found or not allowed.")
        actor_role = self._user_storage_space_role(user, access, bucket_name, include_archived=True)
        can_manage_access = (
            actor_role == "Manager"
            and metadata.archived_at is None
            and self._metadata_visibility(metadata) == "shared"
        )
        mode = "private"
        if self._metadata_visibility(metadata) == "shared":
            mode = "all" if self._metadata_share_scope(metadata) == "account" else "restricted"
        query = (
            self.db.query(PortalStorageSpaceGrant, User)
            .join(User, User.id == PortalStorageSpaceGrant.user_id)
            .filter(PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id)
        )
        explicit_shares = [
            self._storage_space_share_card(user, target, storage_space, grant.role)
            for grant, target in query.all()
            if grant.role in {"Viewer", "Editor"}
        ]
        public_link_count = (
            self.db.query(DBPortalPublicLink)
            .filter(
                DBPortalPublicLink.account_id == access.account.id,
                DBPortalPublicLink.bucket_name == bucket_name,
                DBPortalPublicLink.revoked_at.is_(None),
            )
            .count()
        )
        return PortalStorageSpaceAccessSummary(
            mode=mode,
            default_account_member_role=self._metadata_account_member_role(metadata),
            owner=self._storage_space_owner_person(metadata, access.account),
            effective_member_count=len(self._storage_space_effective_access_user_ids(metadata)),
            explicit_shares=sorted(explicit_shares, key=lambda item: item.email.lower()),
            public_link_count=public_link_count,
            can_manage_access=can_manage_access,
            can_create_public_links=bool(
                can_manage_access
                and metadata.archived_at is None
                and self._metadata_visibility(metadata) == "shared"
            ),
        )

    def _require_storage_space_manager(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
        *,
        include_archived: bool = False,
    ) -> None:
        role = self._user_storage_space_role(user, access, bucket_name, include_archived=include_archived)
        if role not in {"Owner", "Manager"}:
            raise RuntimeError("Full management access required for this storage space.")

    def _require_storage_space_full_content_access(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
    ) -> None:
        if self._user_storage_space_role(user, access, bucket_name) not in {"Owner", "Manager"}:
            raise RuntimeError("Full content access required for this storage space.")

    def _require_storage_space_active(self, account: S3Account, bucket_name: str) -> PortalStorageSpaceMetadata | None:
        metadata = self._storage_space_metadata(account, bucket_name)
        if metadata and metadata.archived_at:
            raise RuntimeError("Storage space is archived.")
        return metadata

    def _require_storage_space_shared(self, account: S3Account, bucket_name: str) -> PortalStorageSpaceMetadata | None:
        metadata = self._require_storage_space_active(account, bucket_name)
        if self._metadata_visibility(metadata) == "private":
            raise RuntimeError("Private storage spaces cannot be shared.")
        return metadata

    def list_storage_space_shares(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
    ) -> list[PortalStorageSpaceShare]:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        metadata = self._require_storage_space_active(access.account, bucket_name)
        if self._metadata_visibility(metadata) != "shared":
            return []
        storage_space = next(
            (
                item
                for item in self.list_storage_spaces(user, access)
                if item.id == space_id or item.internal_bucket_name == bucket_name
            ),
            None,
        )
        if storage_space is None:
            raise RuntimeError("Storage space not found or not allowed.")
        actor_role = self._user_storage_space_role(user, access, bucket_name)
        can_see_all = actor_role == "Manager"
        shares: list[PortalStorageSpaceShare] = []
        if metadata is None:
            return shares
        query = (
            self.db.query(PortalStorageSpaceGrant, User)
            .join(User, User.id == PortalStorageSpaceGrant.user_id)
            .filter(PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id)
        )
        if not can_see_all:
            query = query.filter(PortalStorageSpaceGrant.user_id == user.id)
        for grant, target in query.all():
            if grant.role not in {"Viewer", "Editor"}:
                continue
            shares.append(self._storage_space_share_card(user, target, storage_space, grant.role))
        return sorted(shares, key=lambda item: (item.direction, item.email.lower()))

    def list_storage_space_share_candidates(
        self,
        user: User,
        access: "AccountAccess",
        space_id: Optional[str] = None,
    ) -> list[PortalStorageSpaceShareCandidate]:
        metadata: PortalStorageSpaceMetadata | None = None
        excluded_user_ids = {user.id}
        shared_user_ids: set[int] = set()
        if space_id:
            bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
            if not bucket_name:
                raise RuntimeError("Storage space not found or not allowed.")
            self._require_storage_space_manager(user, access, bucket_name)
            metadata = self._require_storage_space_active(access.account, bucket_name)
            if metadata is None:
                raise RuntimeError("Storage space metadata is missing.")
            if metadata.owner_user_id is not None:
                excluded_user_ids.add(metadata.owner_user_id)
            shared_user_ids = {
                user_id
                for (user_id,) in (
                    self.db.query(PortalStorageSpaceGrant.user_id)
                    .filter(PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id)
                    .all()
                )
            }
        rows = []
        for user_id, (target, portal_role, sources) in self._portal_account_member_map(access.account).items():
            if user_id in excluded_user_ids or portal_role != PortalAccountRole.PORTAL_USER.value:
                continue
            rows.append(
                PortalStorageSpaceShareCandidate(
                    user_id=user_id,
                    email=target.email,
                    display_name=target.full_name,
                    portal_role=portal_role,
                    access_source=self._portal_access_source(sources),
                    already_shared=user_id in shared_user_ids,
                )
            )
        return sorted(rows, key=lambda item: item.email.lower())

    def set_storage_space_share(
        self,
        user: User,
        access: "AccountAccess",
        target: User,
        space_id: str,
        role: PortalStorageSpaceGrantRole,
    ) -> PortalStorageSpaceShare:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        self._require_storage_space_manager(user, access, bucket_name)
        metadata = self._require_storage_space_shared(access.account, bucket_name)
        if metadata is None:
            raise RuntimeError("Storage space metadata is missing.")
        portal_role = self._user_s3_account_portal_role(
            target.id,
            access.account.id,
        )
        if portal_role != PortalAccountRole.PORTAL_USER.value:
            raise RuntimeError("Only Portal users can receive an explicit team Storage Space role.")
        grant = (
            self.db.query(PortalStorageSpaceGrant)
            .filter(
                PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id,
                PortalStorageSpaceGrant.user_id == target.id,
            )
            .first()
        )
        if grant is None:
            grant = PortalStorageSpaceGrant(
                storage_space_metadata_id=metadata.id,
                user_id=target.id,
                role=role,
                created_by_user_id=user.id,
            )
        else:
            grant.role = role
            grant.updated_at = utcnow()
        self.db.add(grant)
        try:
            self.db.flush()
            self._sync_storage_space_access_projection(access.account, metadata, extra_user_ids={target.id})
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        shares = self.list_storage_space_shares(user, access, space_id)
        return next(
            (share for share in shares if share.user_id == target.id),
            self._storage_space_share_card(
                user,
                target,
                PortalStorageSpaceSummary(
                    id=space_id,
                    name=self._storage_space_label(bucket_name),
                    role=role,
                    internal_bucket_name=bucket_name,
                ),
                role,
            ),
        )

    def revoke_storage_space_share(
        self,
        user: User,
        access: "AccountAccess",
        target: User,
        space_id: str,
    ) -> list[PortalStorageSpaceShare]:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        self._require_storage_space_manager(user, access, bucket_name)
        metadata = self._require_storage_space_active(access.account, bucket_name)
        if metadata is None:
            raise RuntimeError("Storage space metadata is missing.")
        grant = (
            self.db.query(PortalStorageSpaceGrant)
            .filter(
                PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id,
                PortalStorageSpaceGrant.user_id == target.id,
            )
            .first()
        )
        try:
            if grant is not None:
                self.db.delete(grant)
                self.db.flush()
            if grant is not None:
                self._sync_storage_space_access_projection(access.account, metadata, extra_user_ids={target.id})
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        return self.list_storage_space_shares(user, access, space_id)
