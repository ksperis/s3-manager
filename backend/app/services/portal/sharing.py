# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


class PortalSharingMixin:
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
        if is_admin_ui_role(target.role):
            raise RuntimeError("Cannot share a storage space with this user.")
        link = (
            self.db.query(UserS3Account)
            .filter(UserS3Account.user_id == target.id, UserS3Account.account_id == access.account.id)
            .first()
        )
        account_role = (
            AccountRole.PORTAL_USER.value
            if link is None or link.account_role == AccountRole.PORTAL_NONE.value
            else link.account_role
        )
        iam_service = self._get_iam_service(access.account)
        portal_settings = self._effective_portal_settings(access.account)
        iam_link, _, _ = self._ensure_portal_user(target, access.account, iam_service)
        self._sync_user_group_membership(
            iam_service,
            iam_link.iam_username,
            account_role,
            portal_settings=portal_settings,
        )
        if not link:
            link = UserS3Account(
                user_id=target.id,
                account_id=access.account.id,
                is_root=False,
                account_role=account_role,
            )
            self.db.add(link)
        elif link.account_role == AccountRole.PORTAL_NONE.value:
            link.account_role = account_role
            self.db.add(link)
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
            self._sync_user_storage_space_projection(
                target,
                access.account,
                account_role,
                iam_service,
                iam_link.iam_username,
            )
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
        if grant is not None:
            self.db.delete(grant)
        account_role = self._user_s3_account_role(target.id, access.account.id)
        if link and link.iam_username:
            iam_service = self._get_iam_service(access.account)
            try:
                self.db.flush()
                self._sync_user_storage_space_projection(
                    target,
                    access.account,
                    account_role,
                    iam_service,
                    link.iam_username,
                )
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise
        elif grant is not None:
            self.db.commit()
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
