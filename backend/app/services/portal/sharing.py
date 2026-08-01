# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


COLLABORATOR_TREND_WINDOWS: tuple[tuple[str, str, int], ...] = (
    ("month", "last 30 days", 28),
    ("week", "last week", 6),
    ("day", "yesterday", 1),
)
STORAGE_SPACE_COLLABORATOR_PREVIEW_LIMIT = 5


class PortalSharingMixin:
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
                    for user_id, (_target, account_role, _sources) in member_map.items():
                        if account_role != AccountRole.PORTAL_USER.value:
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
                    display_name=target.display_name or target.full_name,
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
                display_name=target.display_name or target.full_name,
                account_role=account_role,
                access_source=self._portal_access_source(sources),
                member_since=self._portal_collaborator_member_since(target, sources, source_dates.get(user_id)),
                avatar=UserAvatarService(self.db).descriptor(target),
            )
            for user_id, (target, account_role, sources) in member_map.items()
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
        if access.role != AccountRole.PORTAL_MANAGER.value:
            raise RuntimeError("Only project managers can configure team Storage Space access.")
        member_map = self._portal_account_member_map(access.account)
        seen_user_ids: set[int] = set()
        validated: list[PortalStorageSpaceInitialShare] = []
        for share in shares:
            if share.user_id in seen_user_ids:
                raise RuntimeError("Duplicate initial share user.")
            member = member_map.get(share.user_id)
            if member is None or member[1] != AccountRole.PORTAL_USER.value:
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
            display_name=owner.display_name or owner.full_name,
            role="Owner",
            account_role=member[1] if member else None,
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
                if role == AccountRole.PORTAL_MANAGER.value
            )
        if self._metadata_visibility(metadata) != "shared":
            return user_ids
        if self._metadata_share_scope(metadata) == "account":
            if account is not None:
                user_ids.update(
                    user_id
                    for user_id, (_target, role, _sources) in self._portal_account_member_map(account).items()
                    if role == AccountRole.PORTAL_USER.value
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
        if self._user_storage_space_content_role(user, access, bucket_name) not in {"Owner", "Manager"}:
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
        for user_id, (target, account_role, sources) in self._portal_account_member_map(access.account).items():
            if user_id in excluded_user_ids or account_role != AccountRole.PORTAL_USER.value:
                continue
            rows.append(
                PortalStorageSpaceShareCandidate(
                    user_id=user_id,
                    email=target.email,
                    display_name=target.display_name or target.full_name,
                    account_role=account_role,
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
        account_role = self._user_s3_account_role(target.id, access.account.id)
        if account_role != AccountRole.PORTAL_USER.value:
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

    def _public_link_status(self, link: DBPortalPublicLink, now: datetime | None = None) -> str:
        now = now or utcnow()
        expires_at = self._normalize_storage_space_datetime(link.expires_at)
        if link.revoked_at is not None:
            return "Revoked"
        if expires_at is not None and expires_at <= now:
            return "Expired"
        account = self.db.query(S3Account).filter(S3Account.id == link.account_id).first()
        metadata = self._storage_space_metadata(account, link.bucket_name) if account is not None else None
        if metadata and metadata.archived_at:
            return "Archived"
        if self._metadata_visibility(metadata) == "private":
            return "Suspended"
        return "Active"

    def _public_link_url(self, token: str) -> str:
        return f"{settings.api_v1_prefix}/portal/public-links/{token}/download"

    def _public_link_card(
        self,
        link: DBPortalPublicLink,
        storage_space: PortalStorageSpaceSummary,
    ) -> PortalPublicLink:
        return PortalPublicLink(
            id=link.id,
            storage_space_id=storage_space.id,
            storage_space_name=storage_space.name,
            object_key=link.object_key,
            object_name=self._object_name(link.object_key),
            url=self._public_link_url(link.token),
            label=link.label,
            created_by_email=link.created_by_email,
            created_at=link.created_at,
            expires_at=link.expires_at,
            revoked_at=link.revoked_at,
            status=self._public_link_status(link),
        )

    def list_storage_space_public_links(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        object_key: Optional[str] = None,
        include_revoked: bool = False,
    ) -> list[PortalPublicLink]:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        self._require_storage_space_manager(user, access, bucket_name)
        self._require_storage_space_full_content_access(user, access, bucket_name)
        self._require_storage_space_active(access.account, bucket_name)
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
        query = self.db.query(DBPortalPublicLink).filter(
            DBPortalPublicLink.account_id == access.account.id,
            DBPortalPublicLink.bucket_name == bucket_name,
        )
        if object_key:
            query = query.filter(DBPortalPublicLink.object_key == object_key.lstrip("/"))
        if not include_revoked:
            query = query.filter(DBPortalPublicLink.revoked_at.is_(None))
        links = query.order_by(DBPortalPublicLink.created_at.desc(), DBPortalPublicLink.id.desc()).all()
        return [self._public_link_card(link, storage_space) for link in links]

    def create_storage_space_public_link(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        *,
        object_key: str,
        label: Optional[str] = None,
        expires_at: Optional[datetime] = None,
    ) -> PortalPublicLink:
        target_key = (object_key or "").lstrip("/")
        if not target_key:
            raise RuntimeError("Object key is required.")
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        self._require_storage_space_manager(user, access, bucket_name)
        self._require_storage_space_full_content_access(user, access, bucket_name)
        self._require_storage_space_shared(access.account, bucket_name)
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
        expires_at = self._normalize_storage_space_datetime(expires_at)
        if expires_at is not None and expires_at <= utcnow():
            raise RuntimeError("Public link expiration must be in the future.")
        client = self._portal_object_client(user, access.account)
        self._head_storage_space_object(client, bucket_name, space_id, target_key)
        token = secrets.token_urlsafe(32)
        link = DBPortalPublicLink(
            token=token,
            account_id=access.account.id,
            bucket_name=bucket_name,
            object_key=target_key,
            label=label,
            created_by_user_id=user.id,
            created_by_email=user.email,
            expires_at=expires_at,
        )
        self.db.add(link)
        self.db.commit()
        self.db.refresh(link)
        return self._public_link_card(link, storage_space)

    def revoke_storage_space_public_link(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        link_id: int,
    ) -> list[PortalPublicLink]:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        self._require_storage_space_manager(user, access, bucket_name)
        self._require_storage_space_full_content_access(user, access, bucket_name)
        self._require_storage_space_active(access.account, bucket_name)
        link = (
            self.db.query(DBPortalPublicLink)
            .filter(
                DBPortalPublicLink.id == link_id,
                DBPortalPublicLink.account_id == access.account.id,
                DBPortalPublicLink.bucket_name == bucket_name,
            )
            .first()
        )
        if link is None:
            raise RuntimeError("Public link not found.")
        link.revoked_at = utcnow()
        self.db.add(link)
        self.db.commit()
        return self.list_storage_space_public_links(user, access, space_id, include_revoked=True)

    def download_public_link(self, token: str):
        link = self.db.query(DBPortalPublicLink).filter(DBPortalPublicLink.token == token).first()
        if link is None:
            raise RuntimeError("Public link not found.")
        link_status = self._public_link_status(link)
        if link_status != "Active":
            raise RuntimeError(f"Public link is {link_status.lower()}.")
        account = self.db.query(S3Account).filter(S3Account.id == link.account_id).first()
        if account is None:
            raise RuntimeError("Public link account not found.")
        metadata = self._storage_space_metadata(account, link.bucket_name)
        if metadata and metadata.archived_at:
            raise RuntimeError("Public link is archived.")
        if self._metadata_visibility(metadata) == "private":
            raise RuntimeError("Public link is suspended for this private storage space.")
        access_key, secret_key = self._account_credentials(account)
        endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(account)
        client = get_s3_client(
            access_key,
            secret_key,
            endpoint=endpoint,
            region=region,
            force_path_style=force_path_style,
            verify_tls=verify_tls,
            request_profile="long_running",
        )
        try:
            resp = client.get_object(Bucket=link.bucket_name, Key=link.object_key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError("Unable to download this public link.") from exc
        body = resp.get("Body")
        if not body:
            raise RuntimeError("Unable to download this public link.")
        stream = body.iter_chunks(chunk_size=1024 * 1024) if hasattr(body, "iter_chunks") else body
        filename = self._object_name(link.object_key) or "download"
        return stream, resp.get("ContentType"), filename
