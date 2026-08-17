# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, TYPE_CHECKING

from botocore.exceptions import BotoCoreError, ClientError

from app.core.sensitive_data import sanitize_error_detail
from app.db import User
from app.models.portal import (
    PortalDeletedPrefixRestoreFailure,
    PortalDeletedPrefixRestoreProgress,
    PortalDeletedPrefixRestoreResult,
    PortalDeletedPrefixRestoreStage,
)
from app.services.bucket_purge_service import BucketPurgeCancelled
from app.services.object_listing_temp_store import TemporarySqliteStore

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess


PortalDeletedPrefixRestoreProgressCallback = Callable[
    [PortalDeletedPrefixRestoreProgress], None
]
PortalDeletedPrefixRestoreCancelCheck = Callable[[], None]
_FAILURE_DETAIL_LIMIT = 20
_RESTORE_CONCURRENCY = 4


@dataclass(frozen=True)
class PortalDeletedPrefixRestoreTarget:
    client: Any
    bucket_name: str
    storage_space_id: str
    storage_space_name: str
    prefix: str


class PortalDeletedPrefixRestoreMixin:
    def prepare_deleted_prefix_restore(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        *,
        prefix: str,
    ) -> PortalDeletedPrefixRestoreTarget:
        target_prefix = (prefix or "").lstrip("/")
        if not target_prefix:
            raise ValueError("A folder prefix is required.")
        if not target_prefix.endswith("/"):
            target_prefix = f"{target_prefix}/"
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        if self._require_storage_space_content_role(user, access, bucket_name) == "Viewer":
            raise RuntimeError("Restore not allowed for this storage space role.")
        self._require_storage_space_active(access.account, bucket_name)
        client = self._portal_object_client(
            user,
            access.account,
            request_profile="long_running",
        )
        if self._storage_space_versioning_status(client, bucket_name, space_id) == "Disabled":
            raise RuntimeError("File history is not enabled for this storage space.")
        metadata = self._storage_space_metadata(access.account, bucket_name)
        return PortalDeletedPrefixRestoreTarget(
            client=client,
            bucket_name=bucket_name,
            storage_space_id=space_id,
            storage_space_name=self._display_storage_space_name(bucket_name, metadata),
            prefix=target_prefix,
        )

    def run_deleted_prefix_restore(
        self,
        target: PortalDeletedPrefixRestoreTarget,
        *,
        progress_callback: PortalDeletedPrefixRestoreProgressCallback | None = None,
        cancel_check: PortalDeletedPrefixRestoreCancelCheck | None = None,
    ) -> PortalDeletedPrefixRestoreResult:
        started_at = datetime.now(timezone.utc)
        scanned_versions = 0
        scanned_delete_markers = 0
        restore_candidates = 0
        restored_objects = 0
        failed_objects = 0
        failures: list[PortalDeletedPrefixRestoreFailure] = []

        def check_cancel() -> None:
            if cancel_check:
                cancel_check()

        def emit(
            stage: PortalDeletedPrefixRestoreStage,
            message: str,
            *,
            total_candidates_final: bool = False,
            current_key: str | None = None,
        ) -> None:
            if progress_callback:
                progress_callback(
                    PortalDeletedPrefixRestoreProgress(
                        stage=stage,
                        storage_space_id=target.storage_space_id,
                        storage_space_name=target.storage_space_name,
                        prefix=target.prefix,
                        scanned_versions=scanned_versions,
                        scanned_delete_markers=scanned_delete_markers,
                        restore_candidates=restore_candidates,
                        restored_objects=restored_objects,
                        failed_objects=failed_objects,
                        total_candidates_final=total_candidates_final,
                        current_key=current_key,
                        message=message,
                    )
                )

        emit("prepare", "Preparing deleted file restoration...")
        try:
            with TemporarySqliteStore(
                prefix="kaelo-portal-deleted-prefix-restore-"
            ) as store:
                conn = store.connection
                conn.executescript(
                    """
                    CREATE TABLE deleted_keys (
                        key TEXT PRIMARY KEY
                    );
                    CREATE TABLE latest_versions (
                        key TEXT PRIMARY KEY,
                        version_id TEXT NOT NULL
                    );
                    """
                )
                key_marker = None
                version_id_marker = None
                emit("list", "Scanning deleted files in this folder...")
                while True:
                    check_cancel()
                    kwargs: dict[str, object] = {
                        "Bucket": target.bucket_name,
                        "Prefix": target.prefix,
                        "MaxKeys": 1000,
                    }
                    if key_marker:
                        kwargs["KeyMarker"] = key_marker
                    if version_id_marker:
                        kwargs["VersionIdMarker"] = version_id_marker
                    page = target.client.list_object_versions(**kwargs)
                    version_rows: list[tuple[str, str]] = []
                    deleted_rows: list[tuple[str]] = []
                    for entry in page.get("Versions", []) or []:
                        key = entry.get("Key")
                        version_id = entry.get("VersionId")
                        if not key or not version_id:
                            continue
                        version_rows.append((str(key), str(version_id)))
                        scanned_versions += 1
                    for marker in page.get("DeleteMarkers", []) or []:
                        key = marker.get("Key")
                        if not key:
                            continue
                        scanned_delete_markers += 1
                        if marker.get("IsLatest"):
                            deleted_rows.append((str(key),))
                    if version_rows:
                        conn.executemany(
                            """
                            INSERT OR IGNORE INTO latest_versions (key, version_id)
                            VALUES (?, ?)
                            """,
                            version_rows,
                        )
                    if deleted_rows:
                        conn.executemany(
                            "INSERT OR IGNORE INTO deleted_keys (key) VALUES (?)",
                            deleted_rows,
                        )
                    conn.commit()
                    emit("list", "Scanning deleted files in this folder...")
                    key_marker = page.get("NextKeyMarker")
                    version_id_marker = page.get("NextVersionIdMarker")
                    if not page.get("IsTruncated") or (
                        not key_marker and not version_id_marker
                    ):
                        break

                count_row = conn.execute(
                    """
                    SELECT COUNT(*)
                    FROM deleted_keys AS deleted
                    JOIN latest_versions AS version ON version.key = deleted.key
                    """
                ).fetchone()
                restore_candidates = int(count_row[0] or 0) if count_row else 0
                candidate_cursor = conn.execute(
                    """
                    SELECT deleted.key, version.version_id
                    FROM deleted_keys AS deleted
                    JOIN latest_versions AS version ON version.key = deleted.key
                    ORDER BY deleted.key ASC
                    """
                )
                emit(
                    "restore",
                    "Restoring deleted files...",
                    total_candidates_final=True,
                )

                with ThreadPoolExecutor(
                    max_workers=_RESTORE_CONCURRENCY
                ) as executor:
                    while True:
                        check_cancel()
                        batch = candidate_cursor.fetchmany(_RESTORE_CONCURRENCY)
                        if not batch:
                            break
                        futures = {
                            executor.submit(
                                self._restore_storage_space_object_version_with_client,
                                target.client,
                                target.bucket_name,
                                str(row["key"]),
                                str(row["version_id"]),
                                space_id=target.storage_space_id,
                            ): str(row["key"])
                            for row in batch
                        }
                        for future in as_completed(futures):
                            key = futures[future]
                            try:
                                future.result()
                                restored_objects += 1
                            except Exception as exc:  # Per-object failures are reported and do not stop the batch.
                                failed_objects += 1
                                if len(failures) < _FAILURE_DETAIL_LIMIT:
                                    failures.append(
                                        PortalDeletedPrefixRestoreFailure(
                                            key=key,
                                            detail=str(
                                                sanitize_error_detail(str(exc))
                                            ),
                                        )
                                    )
                            emit(
                                "restore",
                                "Restoring deleted files...",
                                total_candidates_final=True,
                                current_key=key,
                            )

            status = "partial" if failed_objects else "completed"
            emit(
                "completed",
                "Deleted file restoration completed.",
                total_candidates_final=True,
            )
            return PortalDeletedPrefixRestoreResult(
                status=status,
                storage_space_id=target.storage_space_id,
                storage_space_name=target.storage_space_name,
                prefix=target.prefix,
                scanned_versions=scanned_versions,
                scanned_delete_markers=scanned_delete_markers,
                restore_candidates=restore_candidates,
                restored_objects=restored_objects,
                failed_objects=failed_objects,
                failures=failures,
                failures_truncated=failed_objects > len(failures),
                started_at=started_at,
                finished_at=datetime.now(timezone.utc),
            )
        except BucketPurgeCancelled:
            raise
        except (ClientError, BotoCoreError, RuntimeError) as exc:
            raise RuntimeError(
                f"Unable to restore deleted files from '{target.prefix}' "
                f"in Storage Space '{target.storage_space_name}': {exc}"
            ) from exc
