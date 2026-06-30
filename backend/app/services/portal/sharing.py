# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


class PortalSharingMixin:
    def _portal_access_source(self, sources: set[str]) -> str:
        if sources == {"direct"}:
            return "direct"
        if sources == {"group"}:
            return "group"
        return "direct_and_group"

    def _storage_space_share_card(
        self,
        actor: User,
        target: User,
        storage_space: PortalStorageSpaceSummary,
        role: PortalStorageSpaceRole,
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
        member_map = self._portal_account_member_map(access.account)
        seen_user_ids: set[int] = set()
        owner_user_ids = {user.id}
        if owner_user_id is not None:
            owner_user_ids.add(owner_user_id)
        validated: list[PortalStorageSpaceInitialShare] = []
        for share in shares:
            if share.user_id in owner_user_ids:
                raise RuntimeError("Storage Space owner already has Owner access.")
            if share.user_id in seen_user_ids:
                raise RuntimeError("Duplicate initial share user.")
            member = member_map.get(share.user_id)
            if member is None or member[1] not in {AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value}:
                raise RuntimeError("User is not allowed for this Portal account.")
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
        fallback_user: User,
        account: S3Account,
    ) -> PortalStorageSpaceAccessPerson:
        owner: User | None = None
        if metadata and metadata.owner_user_id is not None:
            owner = self.db.query(User).filter(User.id == metadata.owner_user_id).first()
        owner = owner or fallback_user
        member = self._portal_account_member_map(account).get(owner.id)
        return PortalStorageSpaceAccessPerson(
            user_id=owner.id,
            email=owner.email,
            display_name=owner.display_name or owner.full_name,
            role="Owner",
            account_role=member[1] if member else None,
            access_source="owner",
        )

    def _storage_space_effective_access_user_ids(self, metadata: PortalStorageSpaceMetadata) -> set[int]:
        if metadata.archived_at:
            return set()
        user_ids: set[int] = set()
        if metadata.owner_user_id is not None:
            user_ids.add(metadata.owner_user_id)
        if self._metadata_visibility(metadata) != "shared":
            return user_ids
        if self._metadata_share_scope(metadata) == "account":
            account = self.db.query(S3Account).filter(S3Account.id == metadata.account_id).first()
            if account is not None:
                user_ids.update(self._portal_account_member_map(account))
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
        can_manage_access = actor_role == "Owner" and metadata.archived_at is None
        content_role = self._user_storage_space_content_role(user, access, bucket_name)
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
            if grant.role in {"Viewer", "Editor", "Owner"}
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
            owner=self._storage_space_owner_person(metadata, user, access.account),
            effective_member_count=len(self._storage_space_effective_access_user_ids(metadata)),
            explicit_shares=sorted(explicit_shares, key=lambda item: item.email.lower()),
            public_link_count=public_link_count,
            can_manage_access=can_manage_access,
            can_create_public_links=bool(
                can_manage_access
                and content_role == "Owner"
                and metadata.archived_at is None
                and self._metadata_visibility(metadata) == "shared"
            ),
        )

    def _require_storage_space_owner(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
        *,
        include_archived: bool = False,
    ) -> None:
        if self._user_storage_space_role(user, access, bucket_name, include_archived=include_archived) != "Owner":
            raise RuntimeError("Owner role required for this storage space.")

    def _require_storage_space_content_owner(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
    ) -> None:
        if self._user_storage_space_content_role(user, access, bucket_name) != "Owner":
            raise RuntimeError("Owner content role required for this storage space.")

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
        can_see_all = actor_role == "Owner"
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
            if grant.role not in {"Viewer", "Editor", "Owner"}:
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
            self._require_storage_space_owner(user, access, bucket_name)
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
            if user_id in excluded_user_ids:
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
        role: PortalStorageSpaceRole,
    ) -> PortalStorageSpaceShare:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        self._require_storage_space_owner(user, access, bucket_name)
        metadata = self._require_storage_space_shared(access.account, bucket_name)
        if metadata is None:
            raise RuntimeError("Storage space metadata is missing.")
        if metadata.owner_user_id == target.id:
            raise RuntimeError("Storage Space owner already has Owner access.")
        account_role = self._user_s3_account_role(target.id, access.account.id)
        if account_role not in {AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value}:
            raise RuntimeError("User is not allowed for this Portal account.")
        iam_link = (
            self.db.query(AccountIAMUser)
            .filter(AccountIAMUser.user_id == target.id, AccountIAMUser.account_id == access.account.id)
            .first()
        )
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
            if iam_link and iam_link.iam_username:
                iam_service = self._get_iam_service(access.account)
                self._sync_user_group_membership(
                    iam_service,
                    iam_link.iam_username,
                    account_role,
                    portal_settings=self._effective_portal_settings(access.account),
                )
                self._sync_user_storage_space_projection(
                    target,
                    access.account,
                    account_role,
                    iam_service,
                    iam_link.iam_username,
                )
            self._sync_storage_space_bucket_policy(access.account, bucket_name, metadata)
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
        self._require_storage_space_owner(user, access, bucket_name)
        metadata = self._require_storage_space_active(access.account, bucket_name)
        if metadata is None:
            raise RuntimeError("Storage space metadata is missing.")
        link = (
            self.db.query(AccountIAMUser)
            .filter(AccountIAMUser.user_id == target.id, AccountIAMUser.account_id == access.account.id)
            .first()
        )
        grant = (
            self.db.query(PortalStorageSpaceGrant)
            .filter(
                PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id,
                PortalStorageSpaceGrant.user_id == target.id,
            )
            .first()
        )
        account_role = self._user_s3_account_role(target.id, access.account.id)
        try:
            if grant is not None:
                self.db.delete(grant)
                self.db.flush()
            if link and link.iam_username:
                iam_service = self._get_iam_service(access.account)
                self._sync_user_storage_space_projection(
                    target,
                    access.account,
                    account_role,
                    iam_service,
                    link.iam_username,
                )
            if grant is not None:
                self._sync_storage_space_bucket_policy(access.account, bucket_name, metadata)
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
        self._require_storage_space_owner(user, access, bucket_name)
        self._require_storage_space_content_owner(user, access, bucket_name)
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
        self._require_storage_space_owner(user, access, bucket_name)
        self._require_storage_space_content_owner(user, access, bucket_name)
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
        self._require_storage_space_owner(user, access, bucket_name)
        self._require_storage_space_content_owner(user, access, bucket_name)
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
