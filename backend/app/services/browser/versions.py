# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.models.browser import CleanupObjectVersionsPayload, CleanupObjectVersionsResponse
from app.services.object_listing_temp_store import TemporarySqliteStore
from app.services.s3_deletion import delete_objects
from app.services.s3_execution_context import S3ExecutionTarget

logger = logging.getLogger(__name__)


class BrowserVersionsMixin:
    def get_bucket_versioning(self, bucket_name: str, account: S3ExecutionTarget) -> Optional[str]:
        client = self._client(account)
        try:
            resp = client.get_bucket_versioning(Bucket=bucket_name)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to fetch versioning for bucket '{bucket_name}': {exc}") from exc
        return resp.get("Status")

    def cleanup_object_versions(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        payload: CleanupObjectVersionsPayload,
    ) -> CleanupObjectVersionsResponse:
        if not (payload.keep_last_n or payload.older_than_days or payload.delete_orphan_markers):
            raise ValueError("No cleanup criteria provided.")
        client = self._client(account, request_profile="long_running")
        prefix = payload.prefix or ""
        cutoff = None
        if payload.older_than_days:
            cutoff = datetime.now(timezone.utc) - timedelta(days=payload.older_than_days)

        def normalize(value: Optional[datetime]) -> Optional[datetime]:
            if not value:
                return None
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc)

        try:
            with TemporarySqliteStore(prefix="bucketreef-browser-version-cleanup-") as store:
                conn = store.connection
                conn.executescript(
                    """
                    CREATE TABLE cleanup_versions (
                        key TEXT NOT NULL,
                        version_id TEXT NOT NULL,
                        last_modified_ts REAL,
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
                scanned_versions = 0
                scanned_delete_markers = 0
                version_scan_order = 0
                marker_scan_order = 0
                key_marker = None
                version_marker = None
                while True:
                    list_kwargs = {"Bucket": bucket_name, "Prefix": prefix}
                    if key_marker:
                        list_kwargs["KeyMarker"] = key_marker
                    if version_marker:
                        list_kwargs["VersionIdMarker"] = version_marker
                    resp = client.list_object_versions(**list_kwargs)
                    version_rows = []
                    marker_rows = []
                    for version in resp.get("Versions", []) or []:
                        key = version.get("Key")
                        version_id = version.get("VersionId")
                        if not key or not version_id:
                            continue
                        last_modified = normalize(version.get("LastModified"))
                        version_rows.append(
                            (
                                key,
                                version_id,
                                last_modified.timestamp() if last_modified else None,
                                1 if version.get("IsLatest") else 0,
                                version_scan_order,
                            )
                        )
                        version_scan_order += 1
                        scanned_versions += 1
                    for marker in resp.get("DeleteMarkers", []) or []:
                        key = marker.get("Key")
                        version_id = marker.get("VersionId")
                        if not key or not version_id:
                            continue
                        marker_rows.append((key, version_id, marker_scan_order))
                        marker_scan_order += 1
                        scanned_delete_markers += 1
                    if version_rows:
                        conn.executemany(
                            """
                            INSERT OR REPLACE INTO cleanup_versions (
                                key,
                                version_id,
                                last_modified_ts,
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
                            INSERT OR REPLACE INTO cleanup_delete_markers (
                                key,
                                version_id,
                                scan_order
                            )
                            VALUES (?, ?, ?)
                            """,
                            marker_rows,
                        )
                    conn.commit()
                    key_marker = resp.get("NextKeyMarker")
                    version_marker = resp.get("NextVersionIdMarker")
                    if not key_marker and not version_marker:
                        break

                conn.executescript(
                    """
                    CREATE INDEX cleanup_versions_key_order_idx
                        ON cleanup_versions (key, is_latest DESC, last_modified_ts DESC, scan_order);
                    CREATE INDEX cleanup_markers_key_idx
                        ON cleanup_delete_markers (key, scan_order);
                    """
                )
                logger.info(
                    "Indexed object versions for cleanup",
                    extra={
                        "bucket": bucket_name,
                        "prefix": prefix or None,
                        "versions": scanned_versions,
                        "delete_markers": scanned_delete_markers,
                    },
                )

                deleted_versions = 0
                versions_batch: list[dict[str, str]] = []

                def flush_versions_batch() -> None:
                    nonlocal deleted_versions
                    if not versions_batch:
                        return
                    batch = list(versions_batch)
                    delete_objects(client, bucket_name, batch)
                    conn.executemany(
                        "DELETE FROM cleanup_versions WHERE key = ? AND version_id = ?",
                        [(item["Key"], item["VersionId"]) for item in batch],
                    )
                    conn.commit()
                    deleted_versions += len(batch)
                    versions_batch.clear()

                if payload.keep_last_n is not None or cutoff:
                    cutoff_ts = cutoff.timestamp() if cutoff else None
                    current_key = None
                    key_index = 0
                    cursor = conn.execute(
                        """
                        SELECT key, version_id, last_modified_ts, is_latest
                        FROM cleanup_versions
                        ORDER BY key ASC, is_latest DESC, last_modified_ts DESC, scan_order ASC
                        """
                    )
                    for row in cursor:
                        key = str(row["key"])
                        if key != current_key:
                            current_key = key
                            key_index = 0
                        is_latest = bool(row["is_latest"])
                        delete_for_count = payload.keep_last_n is not None and key_index >= payload.keep_last_n
                        last_modified_ts = row["last_modified_ts"]
                        delete_for_age = bool(
                            cutoff_ts is not None
                            and last_modified_ts is not None
                            and float(last_modified_ts) < cutoff_ts
                        )
                        if not is_latest and (delete_for_count or delete_for_age):
                            versions_batch.append({"Key": key, "VersionId": str(row["version_id"])})
                            if len(versions_batch) >= 1000:
                                flush_versions_batch()
                        key_index += 1
                    flush_versions_batch()

                deleted_delete_markers = 0
                markers_batch: list[dict[str, str]] = []

                def flush_markers_batch() -> None:
                    nonlocal deleted_delete_markers
                    if not markers_batch:
                        return
                    batch = list(markers_batch)
                    delete_objects(client, bucket_name, batch)
                    deleted_delete_markers += len(batch)
                    markers_batch.clear()

                if payload.delete_orphan_markers:
                    cursor = conn.execute(
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
                    )
                    for row in cursor:
                        markers_batch.append({"Key": str(row["key"]), "VersionId": str(row["version_id"])})
                        if len(markers_batch) >= 1000:
                            flush_markers_batch()
                    flush_markers_batch()

            self.invalidate_object_list_cache_for_account(account, bucket_name)
            return CleanupObjectVersionsResponse(
                prefix=prefix or None,
                deleted_versions=deleted_versions,
                deleted_delete_markers=deleted_delete_markers,
                scanned_versions=scanned_versions,
                scanned_delete_markers=scanned_delete_markers,
            )
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to clean old versions for '{bucket_name}': {exc}") from exc
