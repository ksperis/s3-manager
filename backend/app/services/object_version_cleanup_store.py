# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Iterator


@dataclass(frozen=True)
class ObjectVersionScanCounts:
    versions: int
    delete_markers: int


ObjectVersionScanCallback = Callable[[ObjectVersionScanCounts], None]


class ObjectVersionCleanupStore:
    """Disk-backed index shared by destructive object-version cleanup flows."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        self.connection = connection
        self.connection.executescript(
            """
            CREATE TABLE cleanup_versions (
                key TEXT NOT NULL,
                version_id TEXT NOT NULL,
                last_modified_ts REAL,
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

    @staticmethod
    def _timestamp(value: Any) -> float | None:
        if not isinstance(value, datetime):
            return None
        normalized = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
        return normalized.timestamp()

    @staticmethod
    def _size_bytes(value: Any) -> int:
        try:
            return max(0, int(value or 0))
        except (TypeError, ValueError):
            return 0

    def _insert_page(
        self,
        page: dict[str, Any],
        *,
        version_scan_order: int,
        marker_scan_order: int,
    ) -> tuple[int, int, int, int]:
        version_rows: list[tuple[str, str, float | None, int, int, int]] = []
        marker_rows: list[tuple[str, str, int]] = []
        for version in page.get("Versions", []) or []:
            key = version.get("Key")
            version_id = version.get("VersionId")
            if not key or not version_id:
                continue
            version_rows.append(
                (
                    str(key),
                    str(version_id),
                    self._timestamp(version.get("LastModified")),
                    self._size_bytes(version.get("Size")),
                    1 if version.get("IsLatest") else 0,
                    version_scan_order,
                )
            )
            version_scan_order += 1
        for marker in page.get("DeleteMarkers", []) or []:
            key = marker.get("Key")
            version_id = marker.get("VersionId")
            if not key or not version_id:
                continue
            marker_rows.append((str(key), str(version_id), marker_scan_order))
            marker_scan_order += 1
        if version_rows:
            self.connection.executemany(
                """
                INSERT OR REPLACE INTO cleanup_versions (
                    key,
                    version_id,
                    last_modified_ts,
                    size_bytes,
                    is_latest,
                    scan_order
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                version_rows,
            )
        if marker_rows:
            self.connection.executemany(
                """
                INSERT OR REPLACE INTO cleanup_delete_markers (key, version_id, scan_order)
                VALUES (?, ?, ?)
                """,
                marker_rows,
            )
        self.connection.commit()
        return len(version_rows), len(marker_rows), version_scan_order, marker_scan_order

    def scan(
        self,
        client: Any,
        bucket_name: str,
        *,
        prefix: str | None = None,
        before_page: Callable[[], None] | None = None,
        after_page: ObjectVersionScanCallback | None = None,
    ) -> ObjectVersionScanCounts:
        scanned_versions = 0
        scanned_delete_markers = 0
        version_scan_order = 0
        marker_scan_order = 0
        key_marker = None
        version_marker = None
        while True:
            if before_page:
                before_page()
            list_kwargs = {"Bucket": bucket_name}
            if prefix is not None:
                list_kwargs["Prefix"] = prefix
            if key_marker:
                list_kwargs["KeyMarker"] = key_marker
            if version_marker:
                list_kwargs["VersionIdMarker"] = version_marker
            page = client.list_object_versions(**list_kwargs)
            page_versions, page_markers, version_scan_order, marker_scan_order = self._insert_page(
                page,
                version_scan_order=version_scan_order,
                marker_scan_order=marker_scan_order,
            )
            scanned_versions += page_versions
            scanned_delete_markers += page_markers
            counts = ObjectVersionScanCounts(scanned_versions, scanned_delete_markers)
            if after_page:
                after_page(counts)
            key_marker = page.get("NextKeyMarker")
            version_marker = page.get("NextVersionIdMarker")
            if not key_marker and not version_marker:
                break
        self.connection.executescript(
            """
            CREATE INDEX cleanup_versions_key_order_idx
                ON cleanup_versions (key, is_latest DESC, last_modified_ts DESC, scan_order);
            CREATE INDEX cleanup_versions_cleanup_idx
                ON cleanup_versions (is_latest, key, scan_order);
            CREATE INDEX cleanup_delete_markers_key_idx
                ON cleanup_delete_markers (key, scan_order);
            """
        )
        return ObjectVersionScanCounts(scanned_versions, scanned_delete_markers)

    def iter_retention_versions(self) -> Iterator[sqlite3.Row]:
        yield from self.connection.execute(
            """
            SELECT key, version_id, last_modified_ts, is_latest
            FROM cleanup_versions
            ORDER BY key ASC, is_latest DESC, last_modified_ts DESC, scan_order ASC
            """
        )

    def iter_noncurrent_versions(self) -> Iterator[sqlite3.Row]:
        yield from self.connection.execute(
            """
            SELECT key, version_id, size_bytes
            FROM cleanup_versions
            WHERE is_latest = 0
            ORDER BY key ASC, scan_order ASC
            """
        )

    def iter_orphan_markers(self) -> Iterator[sqlite3.Row]:
        yield from self.connection.execute(
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

    def count_noncurrent_versions(self) -> int:
        return self._count("SELECT COUNT(*) FROM cleanup_versions WHERE is_latest = 0")

    def count_orphan_markers(self) -> int:
        return self._count(
            """
            SELECT COUNT(*)
            FROM cleanup_delete_markers AS marker
            WHERE NOT EXISTS (
                SELECT 1
                FROM cleanup_versions AS version
                WHERE version.key = marker.key
            )
            """
        )

    def remove_versions(self, versions: list[tuple[str, str]]) -> None:
        self.connection.executemany(
            "DELETE FROM cleanup_versions WHERE key = ? AND version_id = ?",
            versions,
        )
        self.connection.commit()

    def _count(self, query: str) -> int:
        row = self.connection.execute(query).fetchone()
        return int(row[0] or 0) if row else 0
