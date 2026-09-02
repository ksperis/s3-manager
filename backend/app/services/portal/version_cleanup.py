# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, TYPE_CHECKING

from botocore.exceptions import BotoCoreError, ClientError

from app.db import User
from app.models.portal_versions import (
    PortalStorageSpaceVersionCleanupStage,
    PortalStorageSpaceVersionCleanupProgress,
    PortalStorageSpaceVersionCleanupResult,
    portal_storage_space_version_cleanup_confirmation_phrase,
)
from app.services.bucket_purge_service import BucketPurgeCancelled
from app.services.object_listing_temp_store import TemporarySqliteStore
from app.services.object_version_cleanup_store import ObjectVersionCleanupStore, ObjectVersionScanCounts
from app.services import s3_deletion

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess


PortalVersionCleanupProgressCallback = Callable[[PortalStorageSpaceVersionCleanupProgress], None]
PortalVersionCleanupCancelCheck = Callable[[], None]


@dataclass(frozen=True)
class PortalStorageSpaceVersionCleanupTarget:
    client: Any
    bucket_name: str
    storage_space_id: str
    storage_space_name: str


class PortalStorageSpaceVersionCleanupMixin:
    def prepare_storage_space_version_cleanup(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        *,
        confirmation: str,
    ) -> PortalStorageSpaceVersionCleanupTarget:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        portal_settings = self._effective_portal_settings(access.account)
        if not portal_settings.storage_space_version_cleanup_enabled:
            raise RuntimeError("Storage Space history cleanup is not allowed for this account.")
        self._require_storage_space_full_content_access(user, access, bucket_name)
        self._require_storage_space_active(access.account, bucket_name)
        metadata = self._storage_space_metadata(access.account, bucket_name)
        storage_space_name = self._display_storage_space_name(bucket_name, metadata)
        expected_confirmation = portal_storage_space_version_cleanup_confirmation_phrase(storage_space_name)
        if confirmation != expected_confirmation:
            raise ValueError(f"Confirmation must be exactly '{expected_confirmation}'.")
        return PortalStorageSpaceVersionCleanupTarget(
            client=self._portal_object_client(user, access.account, request_profile="long_running"),
            bucket_name=bucket_name,
            storage_space_id=space_id,
            storage_space_name=storage_space_name,
        )

    def run_storage_space_version_cleanup(
        self,
        target: PortalStorageSpaceVersionCleanupTarget,
        *,
        progress_callback: PortalVersionCleanupProgressCallback | None = None,
        cancel_check: PortalVersionCleanupCancelCheck | None = None,
    ) -> PortalStorageSpaceVersionCleanupResult:
        started_at = datetime.now(timezone.utc)
        scanned_versions = 0
        scanned_delete_markers = 0
        delete_candidates = 0
        deleted_versions = 0
        deleted_delete_markers = 0
        bytes_freed = 0

        def check_cancel() -> None:
            if cancel_check:
                cancel_check()

        def emit(
            stage: PortalStorageSpaceVersionCleanupStage,
            message: str | None = None,
            *,
            total_candidates_final: bool = False,
        ) -> None:
            if progress_callback:
                progress_callback(
                    PortalStorageSpaceVersionCleanupProgress(
                        stage=stage,
                        storage_space_id=target.storage_space_id,
                        storage_space_name=target.storage_space_name,
                        scanned_versions=scanned_versions,
                        scanned_delete_markers=scanned_delete_markers,
                        delete_candidates=delete_candidates,
                        deleted_versions=deleted_versions,
                        deleted_delete_markers=deleted_delete_markers,
                        bytes_freed=bytes_freed,
                        total_candidates_final=total_candidates_final,
                        message=message,
                    )
                )

        def delete_versions_batch(cleanup_store: ObjectVersionCleanupStore, batch: list[tuple[str, str, int]]) -> None:
            nonlocal deleted_versions, bytes_freed
            if not batch:
                return
            check_cancel()
            items = [{"Key": key, "VersionId": version_id} for key, version_id, _size in batch]
            s3_deletion.delete_objects_count(target.client, target.bucket_name, items)
            cleanup_store.remove_versions(
                [(key, version_id) for key, version_id, _size in batch]
            )
            deleted_versions += len(batch)
            bytes_freed += sum(size for _key, _version_id, size in batch)
            emit("delete", "Deleting historical versions...")

        def delete_markers_batch(batch: list[tuple[str, str]]) -> None:
            nonlocal deleted_delete_markers
            if not batch:
                return
            check_cancel()
            items = [{"Key": key, "VersionId": version_id} for key, version_id in batch]
            s3_deletion.delete_objects_count(target.client, target.bucket_name, items)
            deleted_delete_markers += len(batch)
            emit("delete", "Deleting orphan delete markers...", total_candidates_final=True)

        emit("prepare", "Preparing Storage Space history cleanup...")
        try:
            with TemporarySqliteStore(prefix="bucketreef-portal-version-cleanup-") as store:
                cleanup_store = ObjectVersionCleanupStore(store.connection)
                emit("list", "Scanning historical versions and delete markers...")

                def update_scan_progress(counts: ObjectVersionScanCounts) -> None:
                    nonlocal scanned_versions, scanned_delete_markers
                    scanned_versions = counts.versions
                    scanned_delete_markers = counts.delete_markers
                    emit("list", "Scanning historical versions and delete markers...")

                scan_counts = cleanup_store.scan(
                    target.client,
                    target.bucket_name,
                    before_page=check_cancel,
                    after_page=update_scan_progress,
                )
                scanned_versions = scan_counts.versions
                scanned_delete_markers = scan_counts.delete_markers
                delete_candidates = cleanup_store.count_noncurrent_versions()
                emit("delete", "Deleting historical versions...")

                versions_batch: list[tuple[str, str, int]] = []
                for row in cleanup_store.iter_noncurrent_versions():
                    versions_batch.append((str(row["key"]), str(row["version_id"]), int(row["size_bytes"] or 0)))
                    if len(versions_batch) >= 1000:
                        delete_versions_batch(cleanup_store, versions_batch)
                        versions_batch.clear()
                delete_versions_batch(cleanup_store, versions_batch)

                marker_candidates = cleanup_store.count_orphan_markers()
                delete_candidates += marker_candidates
                emit("delete", "Deleting orphan delete markers...", total_candidates_final=True)

                markers_batch: list[tuple[str, str]] = []
                for row in cleanup_store.iter_orphan_markers():
                    markers_batch.append((str(row["key"]), str(row["version_id"])))
                    if len(markers_batch) >= 1000:
                        delete_markers_batch(markers_batch)
                        markers_batch.clear()
                delete_markers_batch(markers_batch)

            emit("completed", "Storage Space history cleanup completed.", total_candidates_final=True)
            finished_at = datetime.now(timezone.utc)
            return PortalStorageSpaceVersionCleanupResult(
                status="completed",
                storage_space_id=target.storage_space_id,
                storage_space_name=target.storage_space_name,
                scanned_versions=scanned_versions,
                scanned_delete_markers=scanned_delete_markers,
                deleted_versions=deleted_versions,
                deleted_delete_markers=deleted_delete_markers,
                bytes_freed=bytes_freed,
                started_at=started_at,
                finished_at=finished_at,
            )
        except BucketPurgeCancelled:
            raise
        except (ClientError, BotoCoreError, RuntimeError) as exc:
            raise RuntimeError(
                f"Unable to clean historical versions for Storage Space '{target.storage_space_name}': {exc}"
            ) from exc
