# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


class PortalStorageSpacesMixin:
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
        if value.tzinfo is None:
            return value
        return value.astimezone(timezone.utc).replace(tzinfo=None)

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
        value = metadata.origin if metadata and metadata.origin else "legacy"
        if value in {"legacy", "portal_generic", "portal_named", "imported"}:
            return value
        return "legacy"

    def _storage_space_role(self, access: "AccountAccess") -> PortalStorageSpaceRole:
        if access.capabilities.can_manage_buckets or access.role == AccountRole.PORTAL_MANAGER.value:
            return "Owner"
        if access.role == AccountRole.PORTAL_USER.value:
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
        if metadata and self._metadata_visibility(metadata) == "private":
            return "Private"
        if metadata and self._metadata_visibility(metadata) == "shared":
            return "Shared"
        if role != "Owner":
            return "Shared"
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
        content_role: Optional[PortalStorageSpaceRole] = None,
        metadata: PortalStorageSpaceMetadata | None = None,
    ) -> PortalStorageSpaceSummary:
        role = role or self._storage_space_role(access)
        endpoint = getattr(access.account, "storage_endpoint", None)
        region = getattr(endpoint, "region", None)
        name = self._display_storage_space_name(bucket.name, metadata)
        return PortalStorageSpaceSummary(
            id=bucket.name,
            name=name,
            role=role,
            content_role=content_role,
            can_browse=content_role is not None,
            status=self._storage_space_status(bucket, role, metadata),
            description=self._default_storage_space_description(name, metadata),
            owner_label=self._storage_space_owner_label(access.account, metadata),
            owner_user_id=metadata.owner_user_id if metadata else None,
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
        role_by_bucket = self.list_existing_user_storage_space_access(user, access.account, access.role)
        content_role_by_bucket = self.list_existing_user_storage_space_content_access(user, access.account, access.role)
        metadata_by_bucket = self._storage_space_metadata_map(access.account)
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
                    content_role=content_role_by_bucket.get(metadata.bucket_name),
                    metadata=metadata,
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
    ) -> Optional[PortalStorageSpace]:
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
            content_role=summary.content_role,
            metadata=metadata,
        )
        return PortalStorageSpace(**merged.model_dump())

    def create_storage_space(
        self,
        user: User,
        access: "AccountAccess",
        *,
        name: str,
        naming_mode: PortalStorageSpaceNamingMode = "generic_uuid",
        description: Optional[str] = None,
        owner_label: Optional[str] = None,
        visibility: PortalStorageSpaceVisibility = "private",
        share_scope: PortalStorageSpaceShareScope = "restricted",
        account_member_role: Optional[PortalStorageSpaceRole] = None,
        initial_shares: Optional[list[PortalStorageSpaceInitialShare]] = None,
        project_key: Optional[str] = None,
        dataset_label: Optional[str] = None,
    ) -> PortalStorageSpace:
        portal_settings = self._effective_portal_settings(access.account)
        allow_portal_user_create = portal_settings.allow_portal_user_bucket_create
        is_portal_user = access.role == AccountRole.PORTAL_USER.value
        if not (access.capabilities.can_manage_buckets or (allow_portal_user_create and is_portal_user)):
            raise RuntimeError("Storage Space creation not allowed for this role.")
        if is_portal_user and visibility != "private":
            raise RuntimeError("Portal users can only create private Storage Spaces.")
        share_scope, account_member_role = self._normalize_storage_space_sharing(
            visibility,
            share_scope,
            account_member_role,
        )
        validated_initial_shares = self._validate_initial_storage_space_shares(
            user,
            access,
            visibility=visibility,
            share_scope=share_scope,
            initial_shares=initial_shares,
            owner_user_id=user.id,
        )
        existing = {space.internal_bucket_name or space.id for space in self.list_storage_spaces(user, access, include_archived=True)}
        if naming_mode == "named_bucket":
            if not portal_settings.allow_portal_named_bucket_create:
                raise RuntimeError("Named bucket Storage Space creation is not allowed for this account.")
            bucket_name = self._unique_storage_space_bucket_name(name, existing)
            origin = "portal_named"
            name_editable = False
        else:
            bucket_name = self._unique_uuid_storage_space_bucket_name(existing)
            origin = "portal_generic"
            name_editable = True
        bucket_created = False
        try:
            self.create_bucket(user, access, bucket_name, portal_settings=portal_settings)
            bucket_created = True
            metadata = PortalStorageSpaceMetadata(
                account_id=access.account.id,
                bucket_name=bucket_name,
                display_name=name,
                description=description,
                owner_label=owner_label or user.email,
                owner_user_id=user.id,
                visibility=visibility,
                share_scope=share_scope,
                account_member_role=account_member_role,
                project_key=project_key,
                dataset_label=dataset_label,
                origin=origin,
                name_editable=name_editable,
            )
            self.db.add(metadata)
            self.db.flush()
            self._add_storage_space_initial_grants(metadata, user, validated_initial_shares)
            self.db.flush()
            self._sync_storage_space_participant_projections(access.account, metadata)
            self._sync_storage_space_bucket_policy(access.account, bucket_name, metadata)
            self.db.commit()
        except Exception:
            self.db.rollback()
            if bucket_created:
                try:
                    self.delete_bucket(user, access, bucket_name, use_root=True)
                except Exception as cleanup_exc:
                    logger.warning("Unable to delete failed Portal Storage Space bucket %s: %s", bucket_name, cleanup_exc)
            raise
        storage_space = self.get_storage_space(user, access, bucket_name)
        if storage_space is None:
            raise RuntimeError("Created Storage Space is not visible.")
        return storage_space

    def import_storage_space(
        self,
        user: User,
        access: "AccountAccess",
        *,
        bucket_name: str,
        description: Optional[str] = None,
        owner_label: Optional[str] = None,
        visibility: PortalStorageSpaceVisibility = "private",
        share_scope: PortalStorageSpaceShareScope = "restricted",
        account_member_role: Optional[PortalStorageSpaceRole] = None,
        initial_shares: Optional[list[PortalStorageSpaceInitialShare]] = None,
        project_key: Optional[str] = None,
        dataset_label: Optional[str] = None,
    ) -> PortalStorageSpace:
        cleaned_bucket_name = (bucket_name or "").strip()
        if not cleaned_bucket_name:
            raise RuntimeError("Bucket name requis.")
        if not access.capabilities.can_manage_buckets:
            raise RuntimeError("Storage Space import not allowed for this role.")
        metadata = self._storage_space_metadata(access.account, cleaned_bucket_name)
        share_scope, account_member_role = self._normalize_storage_space_sharing(
            visibility,
            share_scope,
            account_member_role,
        )
        validated_initial_shares = self._validate_initial_storage_space_shares(
            user,
            access,
            visibility=visibility,
            share_scope=share_scope,
            initial_shares=initial_shares,
            owner_user_id=(metadata.owner_user_id if metadata is not None else user.id),
        )
        access_key, secret_key = self._account_credentials(access.account)
        buckets = s3_client.list_buckets(
            access_key=access_key,
            secret_key=secret_key,
            **self._s3_client_kwargs(access.account),
        )
        if cleaned_bucket_name not in {bucket.get("name") for bucket in buckets}:
            raise RuntimeError("Bucket not found for this account.")
        portal_settings = self._effective_portal_settings(access.account)
        iam_service = self._get_iam_service(access.account)
        link, _, _ = self._ensure_portal_user(user, access.account, iam_service)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        self._ensure_policy_and_key(link, iam_service)
        try:
            if metadata is None:
                metadata = PortalStorageSpaceMetadata(account_id=access.account.id, bucket_name=cleaned_bucket_name)
                self.db.add(metadata)
            metadata.display_name = cleaned_bucket_name
            metadata.owner_user_id = metadata.owner_user_id or user.id
            metadata.visibility = visibility
            metadata.share_scope = share_scope
            metadata.account_member_role = account_member_role
            if description is not None:
                metadata.description = description
            if owner_label is not None:
                metadata.owner_label = owner_label
            elif not metadata.owner_label:
                metadata.owner_label = user.email
            if project_key is not None:
                metadata.project_key = project_key
            if dataset_label is not None:
                metadata.dataset_label = dataset_label
            metadata.origin = "imported"
            metadata.name_editable = False
            metadata.updated_at = utcnow()
            self.db.add(metadata)
            self.db.flush()
            self._add_storage_space_initial_grants(metadata, user, validated_initial_shares)
            self.db.flush()
            self._sync_storage_space_participant_projections(access.account, metadata)
            self._sync_storage_space_bucket_policy(access.account, cleaned_bucket_name, metadata)
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        storage_space = self.get_storage_space(user, access, cleaned_bucket_name)
        if storage_space is None:
            raise RuntimeError("Imported Storage Space is not visible.")
        return storage_space

    def update_storage_space(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        *,
        name: Optional[str] = None,
        description: Optional[str] = None,
        owner_label: Optional[str] = None,
        visibility: Optional[PortalStorageSpaceVisibility] = None,
        share_scope: Optional[PortalStorageSpaceShareScope] = None,
        account_member_role: Optional[PortalStorageSpaceRole] = None,
        project_key: Optional[str] = None,
        dataset_label: Optional[str] = None,
        archived: Optional[bool] = None,
    ) -> PortalStorageSpace:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id, include_archived=True)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        self._require_storage_space_owner(user, access, bucket_name, include_archived=True)
        metadata = self._storage_space_metadata(access.account, bucket_name)
        previous_participant_user_ids: set[int] = set()
        if metadata is not None:
            previous_participant_user_ids = self._storage_space_participant_user_ids(metadata)
        if metadata is None:
            metadata = PortalStorageSpaceMetadata(
                account_id=access.account.id,
                bucket_name=bucket_name,
                owner_user_id=user.id,
                owner_label=user.email,
            )
            self.db.add(metadata)
        elif metadata.owner_user_id is None:
            metadata.owner_user_id = user.id
        if name is not None:
            current_name = self._display_storage_space_name(bucket_name, metadata)
            if not metadata.name_editable and name != current_name:
                raise RuntimeError("Storage Space name cannot be changed for this bucket.")
            if metadata.name_editable:
                metadata.display_name = name
        if description is not None:
            metadata.description = description
        if owner_label is not None:
            metadata.owner_label = owner_label
        next_visibility = visibility if visibility is not None else self._metadata_visibility(metadata)
        next_share_scope = share_scope if share_scope is not None else self._metadata_share_scope(metadata)
        next_account_member_role = account_member_role
        if account_member_role is None and share_scope is None:
            next_account_member_role = self._metadata_account_member_role(metadata)
        normalized_share_scope, normalized_account_member_role = self._normalize_storage_space_sharing(
            next_visibility,
            next_share_scope,
            next_account_member_role,
        )
        if visibility is not None:
            metadata.visibility = visibility
        if visibility is not None or share_scope is not None or account_member_role is not None:
            metadata.share_scope = normalized_share_scope
            metadata.account_member_role = normalized_account_member_role
        if project_key is not None:
            metadata.project_key = project_key
        if dataset_label is not None:
            metadata.dataset_label = dataset_label
        if archived is not None:
            metadata.archived_at = utcnow() if archived else None
        metadata.updated_at = utcnow()
        self.db.add(metadata)
        self.db.flush()
        self._sync_storage_space_participant_projections(
            access.account,
            metadata,
            extra_user_ids=previous_participant_user_ids,
        )
        self._sync_storage_space_bucket_policy(access.account, bucket_name, metadata)
        self.db.commit()
        storage_space = self.get_storage_space(user, access, bucket_name)
        if storage_space is None:
            raise RuntimeError("Storage space not found after update.")
        return storage_space

    def _resolve_storage_space_bucket_name(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        include_archived: bool = False,
    ) -> Optional[str]:
        if not space_id:
            return None
        visible_spaces = self.list_storage_spaces(user, access, include_archived=include_archived)
        summary = next(
            (
                space
                for space in visible_spaces
                if space.id == space_id or space.internal_bucket_name == space_id
            ),
            None,
        )
        return summary.internal_bucket_name if summary and summary.internal_bucket_name else None
