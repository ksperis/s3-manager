# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Optional

from app.db import (
    PortalAccountRole,
    PortalExternalAccessCredential,
    PortalPublicLink as DBPortalPublicLink,
    PortalStorageSpaceGrant,
    PortalStorageSpaceMetadata,
    S3Account,
    User,
)
from app.models.portal_storage_spaces import (
    PortalStorageSpaceInitialShare,
    PortalStorageSpaceNamingMode,
    PortalStorageSpaceRole,
    PortalStorageSpaceShareScope,
    PortalStorageSpaceSummary,
    PortalStorageSpaceVisibility,
)
from app.services import s3_client, s3_deletion
from app.services.portal.exceptions import PortalStorageSpaceNotEmpty
from app.services.rgw_admin import RGWAdminError
from app.utils.time import utcnow
from app.utils.usage_stats import extract_usage_stats

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess


logger = logging.getLogger(__name__)


class PortalStorageSpacesMixin:
    def create_storage_space(
        self,
        user: User,
        access: "AccountAccess",
        *,
        name: str,
        naming_mode: PortalStorageSpaceNamingMode = "generic_uuid",
        description: Optional[str] = None,
        visibility: PortalStorageSpaceVisibility = "private",
        share_scope: PortalStorageSpaceShareScope = "restricted",
        account_member_role: Optional[PortalStorageSpaceRole] = None,
        initial_shares: Optional[list[PortalStorageSpaceInitialShare]] = None,
        project_key: Optional[str] = None,
        dataset_label: Optional[str] = None,
    ) -> PortalStorageSpaceSummary:
        portal_settings = self._effective_portal_settings(access.account)
        allow_private_create = portal_settings.allow_private_storage_space_create
        is_portal_user = access.portal_role == PortalAccountRole.PORTAL_USER.value
        is_portal_manager = access.portal_role == PortalAccountRole.PORTAL_MANAGER.value
        if not (is_portal_manager or (allow_private_create and is_portal_user)):
            raise RuntimeError("Storage Space creation not allowed for this role.")
        if is_portal_user and visibility != "private":
            raise RuntimeError("Portal users can only create private Storage Spaces.")
        if visibility == "private" and not allow_private_create:
            raise RuntimeError("Private Storage Space creation is disabled for this project.")
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
            owner_user_id=user.id if visibility == "private" else None,
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
            self.sync_storage_space_server_access_logging(
                access.account,
                bucket_name,
                portal_settings=portal_settings,
            )
            metadata = PortalStorageSpaceMetadata(
                account_id=access.account.id,
                bucket_name=bucket_name,
                display_name=name,
                description=description,
                owner_user_id=user.id if visibility == "private" else None,
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
            self._sync_storage_space_access_projection(access.account, metadata)
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
        visibility: PortalStorageSpaceVisibility = "private",
        share_scope: PortalStorageSpaceShareScope = "restricted",
        account_member_role: Optional[PortalStorageSpaceRole] = None,
        initial_shares: Optional[list[PortalStorageSpaceInitialShare]] = None,
        project_key: Optional[str] = None,
        dataset_label: Optional[str] = None,
    ) -> PortalStorageSpaceSummary:
        cleaned_bucket_name = (bucket_name or "").strip()
        if not cleaned_bucket_name:
            raise RuntimeError("Bucket name requis.")
        if access.portal_role != PortalAccountRole.PORTAL_MANAGER.value:
            raise RuntimeError("Storage Space import not allowed for this role.")
        portal_settings = self._effective_portal_settings(access.account)
        if visibility == "private" and not portal_settings.allow_private_storage_space_create:
            raise RuntimeError("Private Storage Space creation is disabled for this project.")
        metadata = self._storage_space_metadata(access.account, cleaned_bucket_name)
        if metadata is not None:
            raise RuntimeError("Bucket is already registered as a Storage Space.")
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
            owner_user_id=user.id if visibility == "private" else None,
        )
        access_key, secret_key = self._account_credentials(access.account)
        buckets = s3_client.list_buckets(
            access_key=access_key,
            secret_key=secret_key,
            **self._s3_client_kwargs(access.account),
        )
        if cleaned_bucket_name not in {bucket.get("name") for bucket in buckets}:
            raise RuntimeError("Bucket not found for this account.")
        iam_service = self._get_iam_service(access.account)
        link, _, _ = self._ensure_portal_user(user, access.account, iam_service)
        self._sync_user_group_membership(
            iam_service,
            link.iam_username,
            access.portal_role,
            account=access.account,
        )
        self._ensure_active_key(link, iam_service)
        try:
            metadata = PortalStorageSpaceMetadata(account_id=access.account.id, bucket_name=cleaned_bucket_name)
            self.db.add(metadata)
            metadata.display_name = cleaned_bucket_name
            metadata.owner_user_id = user.id if visibility == "private" else None
            metadata.visibility = visibility
            metadata.share_scope = share_scope
            metadata.account_member_role = account_member_role
            if description is not None:
                metadata.description = description
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
            self._sync_storage_space_access_projection(access.account, metadata)
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
        visibility: Optional[PortalStorageSpaceVisibility] = None,
        share_scope: Optional[PortalStorageSpaceShareScope] = None,
        account_member_role: Optional[PortalStorageSpaceRole] = None,
        project_key: Optional[str] = None,
        dataset_label: Optional[str] = None,
        archived: Optional[bool] = None,
    ) -> PortalStorageSpaceSummary:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id, include_archived=True)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        self._require_storage_space_manager(user, access, bucket_name, include_archived=True)
        metadata = self._storage_space_metadata(access.account, bucket_name)
        if metadata is None:
            raise RuntimeError("Storage space metadata is missing.")
        previous_participant_user_ids: set[int] = set()
        if metadata is not None:
            previous_participant_user_ids = self._storage_space_participant_user_ids(metadata)
        if name is not None:
            current_name = self._display_storage_space_name(bucket_name, metadata)
            if not metadata.name_editable and name != current_name:
                raise RuntimeError("Storage Space name cannot be changed for this bucket.")
            if metadata.name_editable:
                metadata.display_name = name
        if description is not None:
            metadata.description = description
        next_visibility = visibility if visibility is not None else self._metadata_visibility(metadata)
        if next_visibility != self._metadata_visibility(metadata):
            raise RuntimeError("Storage Space visibility cannot be changed after creation.")
        next_share_scope = share_scope if share_scope is not None else self._metadata_share_scope(metadata)
        next_account_member_role = account_member_role
        if account_member_role is None and share_scope is None:
            next_account_member_role = self._metadata_account_member_role(metadata)
        normalized_share_scope, normalized_account_member_role = self._normalize_storage_space_sharing(
            next_visibility,
            next_share_scope,
            next_account_member_role,
        )
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
        self._sync_storage_space_access_projection(
            access.account,
            metadata,
            extra_user_ids=previous_participant_user_ids,
        )
        self.db.commit()
        storage_space = self.get_storage_space(user, access, bucket_name)
        if storage_space is None:
            raise RuntimeError("Storage space not found after update.")
        return storage_space

    def take_private_storage_space_ownership(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
    ) -> PortalStorageSpaceSummary:
        if access.portal_role != PortalAccountRole.PORTAL_MANAGER.value:
            raise RuntimeError("Only project managers can take ownership of a private Storage Space.")
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id, include_archived=True)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        metadata = self._storage_space_metadata(access.account, bucket_name)
        if metadata is None or self._metadata_visibility(metadata) != "private":
            raise RuntimeError("Ownership applies only to private Storage Spaces.")
        previous_owner_id = metadata.owner_user_id
        if previous_owner_id == user.id:
            raise RuntimeError("You already own this private Storage Space.")
        metadata.owner_user_id = user.id
        metadata.updated_at = utcnow()
        self.db.add(metadata)
        try:
            self.db.flush()
            affected_user_ids = {user.id}
            if previous_owner_id is not None:
                affected_user_ids.add(previous_owner_id)
            self._sync_storage_space_user_projections(access.account, affected_user_ids)
            self._sync_storage_space_bucket_policy(access.account, bucket_name, metadata)
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        storage_space = self.get_storage_space(user, access, bucket_name)
        if storage_space is None:
            raise RuntimeError("Storage space not found after ownership transfer.")
        return storage_space

    def _storage_space_deletion_usage(
        self,
        account: S3Account,
        bucket_name: str,
    ) -> tuple[bool, Optional[int], Optional[int]]:
        try:
            stats = self._admin_bucket_info(account, bucket_name)
        except RGWAdminError as exc:
            raise RuntimeError(f"Unable to fetch Storage Space deletion stats: {exc}") from exc
        if stats is None:
            return False, None, None
        usage = stats.get("usage") if isinstance(stats, dict) else None
        used_bytes, object_count = extract_usage_stats(usage)
        return True, used_bytes, object_count

    def delete_storage_space(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
    ) -> dict[str, Any]:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id, include_archived=True)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        metadata = self._storage_space_metadata(access.account, bucket_name)
        if metadata is None:
            raise RuntimeError("Storage space not found or not allowed.")
        roles_by_bucket = self._storage_space_roles_by_bucket(
            user,
            access.account,
            access.portal_role,
            include_archived=True,
        )
        if roles_by_bucket.get(bucket_name) not in {"Owner", "Manager"}:
            raise RuntimeError("Full content access required for this storage space.")

        bucket_exists, used_bytes, object_count = self._storage_space_deletion_usage(
            access.account,
            bucket_name,
        )
        if bucket_exists and (used_bytes is None or object_count is None):
            raise RuntimeError("Storage Space usage statistics are unavailable. Retry before deleting the space.")
        if bucket_exists and (used_bytes != 0 or object_count != 0):
            raise PortalStorageSpaceNotEmpty(
                "Storage Space is not empty. Delete all current files and clean up its history before deleting it."
            )

        participant_user_ids = self._storage_space_participant_user_ids(metadata)
        external_access_count = (
            self.db.query(PortalExternalAccessCredential)
            .filter(
                PortalExternalAccessCredential.account_id == access.account.id,
                PortalExternalAccessCredential.storage_space_metadata_id == metadata.id,
            )
            .count()
        )
        public_links = (
            self.db.query(DBPortalPublicLink)
            .filter(
                DBPortalPublicLink.account_id == access.account.id,
                DBPortalPublicLink.bucket_name == bucket_name,
                DBPortalPublicLink.revoked_at.is_(None),
            )
            .all()
        )
        storage_space_name = self._display_storage_space_name(bucket_name, metadata)
        origin = self._storage_space_origin(metadata)

        try:
            if bucket_exists:
                try:
                    self.delete_bucket(user, access, bucket_name, force=False, use_root=True)
                except s3_deletion.BucketNotEmptyError as exc:
                    raise PortalStorageSpaceNotEmpty(
                        "Storage Space is not empty. Delete all current files and clean up its history before deleting it."
                    ) from exc

            self._delete_storage_space_external_iam_credentials(access.account, metadata)
            now = utcnow()
            for link in public_links:
                link.revoked_at = now
                self.db.add(link)
            self.db.query(PortalExternalAccessCredential).filter(
                PortalExternalAccessCredential.storage_space_metadata_id == metadata.id,
            ).delete(synchronize_session=False)
            self.db.query(PortalStorageSpaceGrant).filter(
                PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id,
            ).delete(synchronize_session=False)
            self.db.delete(metadata)
            self.db.flush()
            self._sync_storage_space_user_projections(access.account, participant_user_ids)
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

        return {
            "storage_space_id": bucket_name,
            "storage_space_name": storage_space_name,
            "origin": origin,
            "used_bytes": used_bytes or 0,
            "object_count": object_count or 0,
            "participant_count": len(participant_user_ids),
            "external_access_count": external_access_count,
            "public_link_count": len(public_links),
            "bucket_already_absent": not bucket_exists,
        }

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
