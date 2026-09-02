# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from dataclasses import dataclass
from datetime import datetime, timezone
import sqlite3
from typing import Any, Callable, Iterable, Literal, Optional

from app.models.bucket_compare import (
    BucketContentDiff,
    BucketObjectDetail,
    BucketObjectDiffEntry,
)
from app.services.object_diff_common import compare_object_entries


BUCKET_COMPARE_DISPLAY_LIMIT = 200


@dataclass(frozen=True)
class BucketCompareObjectEntry:
    key: str
    size: int
    etag: Optional[str] = None
    last_modified: Optional[datetime] = None
    storage_class: Optional[str] = None


class BucketCompareObjectIndex:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn
        self._conn.execute(
            """
            CREATE TABLE compare_objects (
                side TEXT NOT NULL,
                key TEXT NOT NULL,
                size INTEGER NOT NULL,
                etag TEXT,
                last_modified_ts REAL,
                last_modified_iso TEXT,
                storage_class TEXT,
                PRIMARY KEY (side, key)
            )
            """
        )

    def add_objects(self, side: Literal["source", "target"], entries: Iterable[BucketCompareObjectEntry]) -> int:
        count = 0
        batch: list[tuple[str, str, int, Optional[str], Optional[float], Optional[str], Optional[str]]] = []
        for entry in entries:
            last_modified_ts = self._datetime_timestamp(entry.last_modified) if entry.last_modified else None
            last_modified_iso = entry.last_modified.isoformat() if entry.last_modified else None
            batch.append(
                (
                    side,
                    entry.key,
                    int(entry.size),
                    entry.etag,
                    last_modified_ts,
                    last_modified_iso,
                    entry.storage_class,
                )
            )
            count += 1
            if len(batch) >= 1000:
                self._insert_batch(batch)
                batch = []
        if batch:
            self._insert_batch(batch)
        self._conn.commit()
        return count

    def build_content_diff(
        self,
        *,
        md5_resolver: Callable[[Optional[str]], Optional[str]],
        ignore_modified_after: Optional[datetime],
    ) -> BucketContentDiff:
        ignored_after_cutoff_count = self._exclude_modified_after(ignore_modified_after)
        source_count = self._count_side("source")
        target_count = self._count_side("target")
        only_source_count = self._count_only("source", "target")
        only_target_count = self._count_only("target", "source")

        only_source_rows = list(self._iter_only_rows("source", "target", BUCKET_COMPARE_DISPLAY_LIMIT))
        only_target_rows = list(self._iter_only_rows("target", "source", BUCKET_COMPARE_DISPLAY_LIMIT))
        only_source_sample = [str(row["key"]) for row in only_source_rows]
        only_target_sample = [str(row["key"]) for row in only_target_rows]

        matched_count = 0
        different_count = 0
        different_sample: list[BucketObjectDiffEntry] = []
        for row in self._iter_common_rows():
            source_entry = self._source_entry_from_joined_row(row)
            target_entry = self._target_entry_from_joined_row(row)
            comparison = compare_object_entries(source_entry, target_entry, md5_resolver=md5_resolver)
            if comparison.equal:
                matched_count += 1
                continue

            different_count += 1
            if len(different_sample) < BUCKET_COMPARE_DISPLAY_LIMIT:
                different_sample.append(
                    BucketObjectDiffEntry(
                        key=str(row["key"]),
                        source_size=comparison.source_size,
                        target_size=comparison.target_size,
                        source_etag=comparison.source_etag,
                        target_etag=comparison.target_etag,
                        source_last_modified=source_entry.get("last_modified")
                        if isinstance(source_entry.get("last_modified"), datetime)
                        else None,
                        target_last_modified=target_entry.get("last_modified")
                        if isinstance(target_entry.get("last_modified"), datetime)
                        else None,
                        source_storage_class=source_entry.get("storage_class")
                        if isinstance(source_entry.get("storage_class"), str)
                        else None,
                        target_storage_class=target_entry.get("storage_class")
                        if isinstance(target_entry.get("storage_class"), str)
                        else None,
                        compare_by=comparison.compare_by,
                    )
                )

        return BucketContentDiff(
            source_count=source_count,
            target_count=target_count,
            matched_count=matched_count,
            different_count=different_count,
            only_source_count=only_source_count,
            only_target_count=only_target_count,
            ignored_after_cutoff_count=ignored_after_cutoff_count,
            display_limit=BUCKET_COMPARE_DISPLAY_LIMIT,
            only_source_hidden_count=max(0, only_source_count - len(only_source_sample)),
            only_target_hidden_count=max(0, only_target_count - len(only_target_sample)),
            different_hidden_count=max(0, different_count - len(different_sample)),
            only_source_sample=only_source_sample,
            only_target_sample=only_target_sample,
            only_source_details=[self._object_detail_from_row(row) for row in only_source_rows],
            only_target_details=[self._object_detail_from_row(row) for row in only_target_rows],
            different_sample=different_sample,
        )

    def _insert_batch(
        self,
        batch: list[tuple[str, str, int, Optional[str], Optional[float], Optional[str], Optional[str]]],
    ) -> None:
        self._conn.executemany(
            """
            INSERT OR REPLACE INTO compare_objects (
                side, key, size, etag, last_modified_ts, last_modified_iso, storage_class
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            batch,
        )

    def _exclude_modified_after(self, cutoff: Optional[datetime]) -> int:
        if cutoff is None:
            return 0
        cutoff_ts = self._datetime_timestamp(cutoff)
        self._conn.execute(
            """
            CREATE TEMP TABLE ignored_compare_keys AS
            SELECT DISTINCT key
            FROM compare_objects
            WHERE last_modified_ts IS NOT NULL AND last_modified_ts > ?
            """,
            (cutoff_ts,),
        )
        row = self._conn.execute("SELECT COUNT(*) AS count FROM ignored_compare_keys").fetchone()
        ignored_count = int(row["count"] or 0) if row else 0
        if ignored_count:
            self._conn.execute(
                """
                DELETE FROM compare_objects
                WHERE key IN (SELECT key FROM ignored_compare_keys)
                """
            )
        self._conn.execute("DROP TABLE ignored_compare_keys")
        self._conn.commit()
        return ignored_count

    def _count_side(self, side: Literal["source", "target"]) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) AS count FROM compare_objects WHERE side = ?",
            (side,),
        ).fetchone()
        return int(row["count"] or 0) if row else 0

    def _count_only(self, side: Literal["source", "target"], other_side: Literal["source", "target"]) -> int:
        row = self._conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM compare_objects current
            LEFT JOIN compare_objects other ON other.side = ? AND other.key = current.key
            WHERE current.side = ? AND other.key IS NULL
            """,
            (other_side, side),
        ).fetchone()
        return int(row["count"] or 0) if row else 0

    def _iter_only_rows(
        self,
        side: Literal["source", "target"],
        other_side: Literal["source", "target"],
        limit: int,
    ):
        return self._conn.execute(
            """
            SELECT current.key, current.size, current.etag, current.last_modified_iso, current.storage_class
            FROM compare_objects current
            LEFT JOIN compare_objects other ON other.side = ? AND other.key = current.key
            WHERE current.side = ? AND other.key IS NULL
            ORDER BY current.key
            LIMIT ?
            """,
            (other_side, side, limit),
        )

    def _iter_common_rows(self):
        return self._conn.execute(
            """
            SELECT
                source.key AS key,
                source.size AS source_size,
                source.etag AS source_etag,
                source.last_modified_iso AS source_last_modified_iso,
                source.storage_class AS source_storage_class,
                target.size AS target_size,
                target.etag AS target_etag,
                target.last_modified_iso AS target_last_modified_iso,
                target.storage_class AS target_storage_class
            FROM compare_objects source
            INNER JOIN compare_objects target ON target.side = 'target' AND target.key = source.key
            WHERE source.side = 'source'
            ORDER BY source.key
            """
        )

    def _object_detail_from_row(self, row: sqlite3.Row) -> BucketObjectDetail:
        storage_class = row["storage_class"]
        return BucketObjectDetail(
            key=str(row["key"]),
            size=int(row["size"] or 0),
            etag=row["etag"] if isinstance(row["etag"], str) else None,
            last_modified=self._datetime_from_iso(row["last_modified_iso"]),
            storage_class=storage_class if isinstance(storage_class, str) else None,
        )

    def _source_entry_from_joined_row(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "size": int(row["source_size"] or 0),
            "etag": row["source_etag"] if isinstance(row["source_etag"], str) else None,
            "last_modified": self._datetime_from_iso(row["source_last_modified_iso"]),
            "storage_class": row["source_storage_class"] if isinstance(row["source_storage_class"], str) else None,
        }

    def _target_entry_from_joined_row(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "size": int(row["target_size"] or 0),
            "etag": row["target_etag"] if isinstance(row["target_etag"], str) else None,
            "last_modified": self._datetime_from_iso(row["target_last_modified_iso"]),
            "storage_class": row["target_storage_class"] if isinstance(row["target_storage_class"], str) else None,
        }

    def _datetime_from_iso(self, value: Any) -> Optional[datetime]:
        if not isinstance(value, str) or not value:
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None

    def _datetime_timestamp(self, value: datetime) -> float:
        normalized = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        return normalized.astimezone(timezone.utc).timestamp()
