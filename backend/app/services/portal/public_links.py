# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import secrets
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import get_settings
from app.db import PortalPublicLink as DBPortalPublicLink, S3Account, User
from app.models.portal import PortalPublicLink, PortalStorageSpaceSummary
from app.services.s3_client import get_s3_client
from app.utils.s3_endpoint import resolve_s3_client_options
from app.utils.time import utcnow

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess


settings = get_settings()


class PortalPublicLinksMixin:
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
