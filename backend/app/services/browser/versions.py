# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.models.browser import CleanupObjectVersionsPayload, CleanupObjectVersionsResponse
from app.services.object_listing_temp_store import TemporarySqliteStore
from app.services.object_version_cleanup_store import ObjectVersionCleanupStore
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

        try:
            with TemporarySqliteStore(prefix="bucketreef-browser-version-cleanup-") as store:
                cleanup_store = ObjectVersionCleanupStore(store.connection)
                scan_counts = cleanup_store.scan(client, bucket_name, prefix=prefix)
                scanned_versions = scan_counts.versions
                scanned_delete_markers = scan_counts.delete_markers
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
                versions_batch: list[tuple[str, str]] = []

                def flush_versions_batch() -> None:
                    nonlocal deleted_versions
                    if not versions_batch:
                        return
                    batch = list(versions_batch)
                    delete_objects(
                        client,
                        bucket_name,
                        [{"Key": key, "VersionId": version_id} for key, version_id in batch],
                    )
                    cleanup_store.remove_versions(batch)
                    deleted_versions += len(batch)
                    versions_batch.clear()

                if payload.keep_last_n is not None or cutoff:
                    cutoff_ts = cutoff.timestamp() if cutoff else None
                    current_key = None
                    key_index = 0
                    for row in cleanup_store.iter_retention_versions():
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
                            versions_batch.append((key, str(row["version_id"])))
                            if len(versions_batch) >= 1000:
                                flush_versions_batch()
                        key_index += 1
                    flush_versions_batch()

                deleted_delete_markers = 0
                markers_batch: list[tuple[str, str]] = []

                def flush_markers_batch() -> None:
                    nonlocal deleted_delete_markers
                    if not markers_batch:
                        return
                    batch = list(markers_batch)
                    delete_objects(
                        client,
                        bucket_name,
                        [{"Key": key, "VersionId": version_id} for key, version_id in batch],
                    )
                    deleted_delete_markers += len(batch)
                    markers_batch.clear()

                if payload.delete_orphan_markers:
                    for row in cleanup_store.iter_orphan_markers():
                        markers_batch.append((str(row["key"]), str(row["version_id"])))
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
