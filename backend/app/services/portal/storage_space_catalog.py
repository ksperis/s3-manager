# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from app.db import PortalAccountRole, PortalStorageSpaceMetadata, S3Account, User
from app.models.bucket import Bucket
from app.models.portal_storage_spaces import (
    PortalStorageSpaceCollaboratorPreview,
    PortalStorageSpaceRole,
    PortalStorageSpaceShareScope,
    PortalStorageSpaceSummary,
    PortalStorageSpaceVisibility,
)
from app.utils.time import normalize_utc

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess


class PortalStorageSpaceCatalogMixin:
    def _normalize_storage_space_sharing(
        self,
        visibility: PortalStorageSpaceVisibility,
        share_scope: Optional[PortalStorageSpaceShareScope],
        account_member_role: Optional[PortalStorageSpaceRole],
    ) -> tuple[PortalStorageSpaceShareScope, Optional[PortalStorageSpaceRole]]:
        if visibility != "shared":
            return "restricted", None
        scope = "account" if share_scope == "account" else "restricted"
        if scope != "account":
            return scope, None
        if account_member_role in {"Viewer", "Editor"}:
            return scope, account_member_role
        return scope, "Editor"

    def _storage_space_owner_label(
        self,
        account: S3Account,
        metadata: PortalStorageSpaceMetadata | None,
    ) -> str:
        if metadata and metadata.owner_user_id:
            owner = self.db.query(User).filter(User.id == metadata.owner_user_id).first()
            if owner and owner.email:
                return owner.email
        return account.name if self._metadata_visibility(metadata) == "private" else ""

    def _storage_space_label(self, bucket_name: str) -> str:
        cleaned = " ".join(bucket_name.replace("_", " ").replace("-", " ").split())
        if not cleaned:
            return bucket_name
        return " ".join(part[:1].upper() + part[1:] for part in cleaned.split())

    def _storage_space_metadata_map(self, account: S3Account) -> dict[str, PortalStorageSpaceMetadata]:
        return {
            item.bucket_name: item
            for item in self.db.query(PortalStorageSpaceMetadata)
            .filter(PortalStorageSpaceMetadata.account_id == account.id)
            .all()
        }

    def _storage_space_metadata(self, account: S3Account, bucket_name: str) -> PortalStorageSpaceMetadata | None:
        return (
            self.db.query(PortalStorageSpaceMetadata)
            .filter(
                PortalStorageSpaceMetadata.account_id == account.id,
                PortalStorageSpaceMetadata.bucket_name == bucket_name,
            )
            .first()
        )

    def _display_storage_space_name(self, bucket_name: str, metadata: PortalStorageSpaceMetadata | None = None) -> str:
        if metadata and metadata.display_name:
            return metadata.display_name
        return self._storage_space_label(bucket_name)

    def _default_storage_space_description(self, name: str, metadata: PortalStorageSpaceMetadata | None = None) -> str:
        if metadata and metadata.description:
            return metadata.description
        return f"{name} storage space"

    def _normalize_storage_space_datetime(self, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        return normalize_utc(value, name="Storage space timestamp")

    def _storage_space_slug(self, value: str) -> str:
        slug = re.sub(r"[^a-z0-9-]+", "-", value.strip().lower())
        slug = re.sub(r"-+", "-", slug).strip("-")
        if not slug:
            slug = "storage-space"
        if len(slug) > 52:
            slug = slug[:52].rstrip("-")
        return slug

    def _unique_storage_space_bucket_name(self, base_name: str, existing: set[str]) -> str:
        base = self._storage_space_slug(base_name)
        candidate = base
        counter = 2
        while candidate in existing:
            suffix = f"-{counter}"
            candidate = f"{base[: 63 - len(suffix)].rstrip('-')}{suffix}"
            counter += 1
        return candidate

    def _unique_uuid_storage_space_bucket_name(self, existing: set[str]) -> str:
        candidate = str(uuid.uuid4())
        while candidate in existing:
            candidate = str(uuid.uuid4())
        return candidate

    def _storage_space_origin(self, metadata: PortalStorageSpaceMetadata | None) -> str:
        value = metadata.origin if metadata and metadata.origin else "imported"
        if value in {"portal_generic", "portal_named", "imported"}:
            return value
        return "imported"

    def _storage_space_role(self, access: "AccountAccess") -> PortalStorageSpaceRole:
        if access.portal_role == PortalAccountRole.PORTAL_MANAGER.value:
            return "Manager"
        if access.portal_role == PortalAccountRole.PORTAL_USER.value:
            return "Editor"
        return "Viewer"

    def _storage_space_status(
        self,
        bucket: Bucket,
        role: PortalStorageSpaceRole,
        metadata: PortalStorageSpaceMetadata | None = None,
    ) -> str:
        if metadata and metadata.archived_at:
            return "Archived"
        used = bucket.used_bytes
        quota = bucket.quota_max_size_bytes
        if used is not None and quota is not None and quota > 0 and used / quota >= 0.85:
            return "Attention"
        return "Active"

    def _bucket_to_storage_space_summary(
        self,
        bucket: Bucket,
        access: "AccountAccess",
        role: Optional[PortalStorageSpaceRole] = None,
        can_delete: bool = False,
        metadata: PortalStorageSpaceMetadata | None = None,
        collaborators: Optional[list[PortalStorageSpaceCollaboratorPreview]] = None,
        collaborator_count: int = 0,
    ) -> PortalStorageSpaceSummary:
        role = role or self._storage_space_role(access)
        endpoint = getattr(access.account, "storage_endpoint", None)
        region = getattr(endpoint, "region", None)
        name = self._display_storage_space_name(bucket.name, metadata)
        return PortalStorageSpaceSummary(
            id=bucket.name,
            name=name,
            role=role,
            can_browse=metadata is None or metadata.archived_at is None,
            can_take_ownership=bool(
                metadata
                and self._metadata_visibility(metadata) == "private"
                and role == "Manager"
                and metadata.owner_user_id != getattr(access.actor, "id", None)
            ),
            can_delete=can_delete,
            status=self._storage_space_status(bucket, role, metadata),
            description=self._default_storage_space_description(name, metadata),
            owner_label=self._storage_space_owner_label(access.account, metadata),
            owner_user_id=metadata.owner_user_id if metadata else None,
            collaborators=collaborators or [],
            collaborator_count=collaborator_count,
            visibility=self._metadata_visibility(metadata),
            share_scope=self._metadata_share_scope(metadata),
            account_member_role=self._metadata_account_member_role(metadata),
            project_key=metadata.project_key if metadata else None,
            dataset_label=metadata.dataset_label if metadata else None,
            region=region,
            created_at=bucket.creation_date,
            used_bytes=bucket.used_bytes,
            object_count=bucket.object_count,
            quota_max_size_bytes=bucket.quota_max_size_bytes,
            quota_max_objects=bucket.quota_max_objects,
            internal_bucket_name=bucket.name,
            archived_at=metadata.archived_at if metadata else None,
            origin=self._storage_space_origin(metadata),
            name_editable=bool(metadata and metadata.name_editable),
            icon=self._storage_space_icon_descriptor(metadata),
        )

    def list_storage_spaces(
        self,
        user: User,
        access: "AccountAccess",
        search: Optional[str] = None,
        role: Optional[str] = None,
        status: Optional[str] = None,
        sort: str = "name",
        include_archived: bool = False,
    ) -> list[PortalStorageSpaceSummary]:
        role_by_bucket = self._storage_space_roles_by_bucket(
            user,
            access.account,
            access.portal_role,
            include_archived=include_archived,
        )
        metadata_by_bucket = self._storage_space_metadata_map(access.account)
        collaborator_previews = self._storage_space_collaborator_previews(
            access.account,
            list(metadata_by_bucket.values()),
        )
        spaces: list[PortalStorageSpaceSummary] = []
        for metadata in metadata_by_bucket.values():
            role_for_bucket = self._storage_space_effective_role(
                user,
                access,
                metadata,
                role_by_bucket.get(metadata.bucket_name),
                include_archived=include_archived,
            )
            if role_for_bucket is None:
                continue
            bucket = Bucket(
                name=metadata.bucket_name,
                creation_date=metadata.created_at,
                used_bytes=None,
                object_count=None,
                quota_max_size_bytes=None,
                quota_max_objects=None,
            )
            spaces.append(
                self._bucket_to_storage_space_summary(
                    bucket,
                    access,
                    role=role_for_bucket,
                    can_delete=role_by_bucket.get(metadata.bucket_name) in {"Owner", "Manager"},
                    metadata=metadata,
                    collaborators=collaborator_previews.get(metadata.bucket_name, ([], 0))[0],
                    collaborator_count=collaborator_previews.get(metadata.bucket_name, ([], 0))[1],
                )
            )
        if search:
            term = search.strip().lower()
            if term:
                spaces = [
                    space
                    for space in spaces
                    if term in space.name.lower()
                    or term in space.id.lower()
                    or term in (space.description or "").lower()
                    or term in (space.owner_label or "").lower()
                    or term in (space.visibility or "").lower()
                    or term in (space.project_key or "").lower()
                    or term in (space.dataset_label or "").lower()
                    or term in (space.internal_bucket_name or "").lower()
                ]
        if role:
            role_term = role.strip().lower()
            spaces = [space for space in spaces if space.role.lower() == role_term]
        if status:
            status_term = status.strip().lower()
            spaces = [space for space in spaces if space.status.lower() == status_term]
        reverse = sort.startswith("-")
        sort_key = sort[1:] if reverse else sort
        sorters = {
            "name": lambda item: (item.name or "").lower(),
            "created_at": lambda item: item.created_at or datetime.min,
            "used_bytes": lambda item: item.used_bytes if item.used_bytes is not None else -1,
            "object_count": lambda item: item.object_count if item.object_count is not None else -1,
            "role": lambda item: item.role,
            "status": lambda item: item.status,
        }
        spaces = sorted(spaces, key=sorters.get(sort_key, sorters["name"]), reverse=reverse)
        return spaces

    def get_storage_space(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
    ) -> Optional[PortalStorageSpaceSummary]:
        if not space_id:
            return None
        visible_spaces = self.list_storage_spaces(user, access, include_archived=True)
        summary = next(
            (
                space
                for space in visible_spaces
                if space.id == space_id or space.internal_bucket_name == space_id
            ),
            None,
        )
        if summary is None or not summary.internal_bucket_name:
            return None
        stats = self.get_bucket_stats(user, access, summary.internal_bucket_name)
        metadata = self._storage_space_metadata(access.account, summary.internal_bucket_name)
        merged = self._bucket_to_storage_space_summary(
            Bucket(
                name=summary.internal_bucket_name,
                creation_date=stats.creation_date or summary.created_at,
                used_bytes=stats.used_bytes if stats.used_bytes is not None else summary.used_bytes,
                object_count=stats.object_count if stats.object_count is not None else summary.object_count,
                quota_max_size_bytes=(
                    stats.quota_max_size_bytes
                    if stats.quota_max_size_bytes is not None
                    else summary.quota_max_size_bytes
                ),
                quota_max_objects=(
                    stats.quota_max_objects
                    if stats.quota_max_objects is not None
                    else summary.quota_max_objects
                ),
            ),
            access,
            role=summary.role,
            can_delete=summary.can_delete,
            metadata=metadata,
        )
        return PortalStorageSpaceSummary(**merged.model_dump())
