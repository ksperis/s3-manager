# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from botocore.exceptions import BotoCoreError, ClientError

from app.models.portal import (
    PortalStorageSpaceVersionCleanupProgress,
    PortalStorageSpaceVersionCleanupResult,
    portal_storage_space_version_cleanup_confirmation_phrase,
)
from app.services.bucket_purge_service import BucketPurgeCancelled
from app.services.object_listing_temp_store import TemporarySqliteStore
from app.services import s3_client

from ._shared import *


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
        self._require_storage_space_content_owner(user, access, bucket_name)
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
            stage: str,
            message: str | None = None,
            *,
            total_candidates_final: bool = False,
        ) -> None:
            if progress_callback:
                progress_callback(
                    PortalStorageSpaceVersionCleanupProgress(
                        stage=stage,  # type: ignore[arg-type]
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

        def sqlite_count(conn, query: str) -> int:
            row = conn.execute(query).fetchone()
            return int(row[0] or 0) if row else 0

        def delete_versions_batch(conn, batch: list[tuple[str, str, int]]) -> None:
            nonlocal deleted_versions, bytes_freed
            if not batch:
                return
            check_cancel()
            items = [{"Key": key, "VersionId": version_id} for key, version_id, _size in batch]
            s3_client._delete_objects_count(target.client, target.bucket_name, items)
            conn.executemany(
                "DELETE FROM cleanup_versions WHERE key = ? AND version_id = ?",
                [(key, version_id) for key, version_id, _size in batch],
            )
            conn.commit()
            deleted_versions += len(batch)
            bytes_freed += sum(size for _key, _version_id, size in batch)
            emit("delete", "Deleting historical versions...")

        def delete_markers_batch(batch: list[tuple[str, str]]) -> None:
            nonlocal deleted_delete_markers
            if not batch:
                return
            check_cancel()
            items = [{"Key": key, "VersionId": version_id} for key, version_id in batch]
            s3_client._delete_objects_count(target.client, target.bucket_name, items)
            deleted_delete_markers += len(batch)
            emit("delete", "Deleting orphan delete markers...", total_candidates_final=True)

        emit("prepare", "Preparing Storage Space history cleanup...")
        try:
            with TemporarySqliteStore(prefix="s3-manager-portal-version-cleanup-") as store:
                conn = store.connection
                conn.executescript(
                    """
                    CREATE TABLE cleanup_versions (
                        key TEXT NOT NULL,
                        version_id TEXT NOT NULL,
                        size_bytes INTEGER NOT NULL DEFAULT 0,
                        is_latest INTEGER NOT NULL,
                        scan_order INTEGER NOT NULL,
                        PRIMARY KEY (key, version_id)
                    );
                    CREATE TABLE cleanup_delete_markers (
                        key TEXT NOT NULL,
                        version_id TEXT NOT NULL,
                        scan_order INTEGER NOT NULL,
                        PRIMARY KEY (key, version_id)
                    );
                    """
                )

                emit("list", "Scanning historical versions and delete markers...")
                key_marker = None
                version_marker = None
                scan_order = 0
                marker_scan_order = 0
                while True:
                    check_cancel()
                    list_kwargs = {"Bucket": target.bucket_name}
                    if key_marker:
                        list_kwargs["KeyMarker"] = key_marker
                    if version_marker:
                        list_kwargs["VersionIdMarker"] = version_marker
                    page = target.client.list_object_versions(**list_kwargs)
                    version_rows: list[tuple[str, str, int, int, int]] = []
                    marker_rows: list[tuple[str, str, int]] = []
                    for entry in page.get("Versions", []) or []:
                        key = entry.get("Key")
                        version_id = entry.get("VersionId")
                        if not key or not version_id:
                            continue
                        try:
                            size_bytes = max(0, int(entry.get("Size") or 0))
                        except (TypeError, ValueError):
                            size_bytes = 0
                        version_rows.append(
                            (str(key), str(version_id), size_bytes, 1 if entry.get("IsLatest") else 0, scan_order)
                        )
                        scan_order += 1
                        scanned_versions += 1
                    for marker in page.get("DeleteMarkers", []) or []:
                        key = marker.get("Key")
                        version_id = marker.get("VersionId")
                        if not key or not version_id:
                            continue
                        marker_rows.append((str(key), str(version_id), marker_scan_order))
                        marker_scan_order += 1
                        scanned_delete_markers += 1
                    if version_rows:
                        conn.executemany(
                            """
                            INSERT OR REPLACE INTO cleanup_versions (
                                key,
                                version_id,
                                size_bytes,
                                is_latest,
                                scan_order
                            )
                            VALUES (?, ?, ?, ?, ?)
                            """,
                            version_rows,
                        )
                    if marker_rows:
                        conn.executemany(
                            """
                            INSERT OR REPLACE INTO cleanup_delete_markers (key, version_id, scan_order)
                            VALUES (?, ?, ?)
                            """,
                            marker_rows,
                        )
                    conn.commit()
                    emit("list", "Scanning historical versions and delete markers...")
                    key_marker = page.get("NextKeyMarker")
                    version_marker = page.get("NextVersionIdMarker")
                    if not key_marker and not version_marker:
                        break

                conn.executescript(
                    """
                    CREATE INDEX cleanup_versions_cleanup_idx
                        ON cleanup_versions (is_latest, key, scan_order);
                    CREATE INDEX cleanup_delete_markers_key_idx
                        ON cleanup_delete_markers (key, scan_order);
                    """
                )
                delete_candidates = sqlite_count(conn, "SELECT COUNT(*) FROM cleanup_versions WHERE is_latest = 0")
                emit("delete", "Deleting historical versions...")

                versions_batch: list[tuple[str, str, int]] = []
                for row in conn.execute(
                    """
                    SELECT key, version_id, size_bytes
                    FROM cleanup_versions
                    WHERE is_latest = 0
                    ORDER BY key ASC, scan_order ASC
                    """
                ):
                    versions_batch.append((str(row["key"]), str(row["version_id"]), int(row["size_bytes"] or 0)))
                    if len(versions_batch) >= 1000:
                        delete_versions_batch(conn, versions_batch)
                        versions_batch.clear()
                delete_versions_batch(conn, versions_batch)

                marker_candidates = sqlite_count(
                    conn,
                    """
                    SELECT COUNT(*)
                    FROM cleanup_delete_markers AS marker
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM cleanup_versions AS version
                        WHERE version.key = marker.key
                    )
                    """,
                )
                delete_candidates += marker_candidates
                emit("delete", "Deleting orphan delete markers...", total_candidates_final=True)

                markers_batch: list[tuple[str, str]] = []
                for row in conn.execute(
                    """
                    SELECT marker.key, marker.version_id
                    FROM cleanup_delete_markers AS marker
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM cleanup_versions AS version
                        WHERE version.key = marker.key
                    )
                    ORDER BY marker.key ASC, marker.scan_order ASC
                    """
                ):
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
