# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Any, Callable, Iterator


@dataclass(frozen=True)
class ObjectRestoreScanCounts:
    versions: int
    delete_markers: int


ObjectRestoreScanCallback = Callable[[ObjectRestoreScanCounts], None]


class ObjectRestoreStore:
    """Disk-backed index of deleted keys and their latest restorable version."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        self.connection = connection
        self.connection.executescript(
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

    def scan(
        self,
        client: Any,
        bucket_name: str,
        prefix: str,
        *,
        before_page: Callable[[], None] | None = None,
        after_page: ObjectRestoreScanCallback | None = None,
    ) -> ObjectRestoreScanCounts:
        scanned_versions = 0
        scanned_delete_markers = 0
        key_marker = None
        version_id_marker = None
        while True:
            if before_page:
                before_page()
            kwargs: dict[str, object] = {
                "Bucket": bucket_name,
                "Prefix": prefix,
                "MaxKeys": 1000,
            }
            if key_marker:
                kwargs["KeyMarker"] = key_marker
            if version_id_marker:
                kwargs["VersionIdMarker"] = version_id_marker
            page = client.list_object_versions(**kwargs)
            page_counts = self._insert_page(page)
            scanned_versions += page_counts.versions
            scanned_delete_markers += page_counts.delete_markers
            counts = ObjectRestoreScanCounts(
                versions=scanned_versions,
                delete_markers=scanned_delete_markers,
            )
            if after_page:
                after_page(counts)
            key_marker = page.get("NextKeyMarker")
            version_id_marker = page.get("NextVersionIdMarker")
            if not page.get("IsTruncated") or (
                not key_marker and not version_id_marker
            ):
                return counts

    def _insert_page(self, page: dict[str, Any]) -> ObjectRestoreScanCounts:
        version_rows: list[tuple[str, str]] = []
        deleted_rows: list[tuple[str]] = []
        delete_marker_count = 0
        for entry in page.get("Versions", []) or []:
            key = entry.get("Key")
            version_id = entry.get("VersionId")
            if not key or not version_id:
                continue
            version_rows.append((str(key), str(version_id)))
        for marker in page.get("DeleteMarkers", []) or []:
            key = marker.get("Key")
            if not key:
                continue
            delete_marker_count += 1
            if marker.get("IsLatest"):
                deleted_rows.append((str(key),))
        if version_rows:
            self.connection.executemany(
                """
                INSERT OR IGNORE INTO latest_versions (key, version_id)
                VALUES (?, ?)
                """,
                version_rows,
            )
        if deleted_rows:
            self.connection.executemany(
                "INSERT OR IGNORE INTO deleted_keys (key) VALUES (?)",
                deleted_rows,
            )
        self.connection.commit()
        return ObjectRestoreScanCounts(
            versions=len(version_rows),
            delete_markers=delete_marker_count,
        )

    def count_candidates(self) -> int:
        row = self.connection.execute(
            """
            SELECT COUNT(*)
            FROM deleted_keys AS deleted
            JOIN latest_versions AS version ON version.key = deleted.key
            """
        ).fetchone()
        return int(row[0] or 0) if row else 0

    def iter_candidate_batches(
        self,
        batch_size: int,
    ) -> Iterator[list[sqlite3.Row]]:
        cursor = self.connection.execute(
            """
            SELECT deleted.key, version.version_id
            FROM deleted_keys AS deleted
            JOIN latest_versions AS version ON version.key = deleted.key
            ORDER BY deleted.key ASC
            """
        )
        safe_batch_size = max(1, int(batch_size))
        while batch := cursor.fetchmany(safe_batch_size):
            yield batch
