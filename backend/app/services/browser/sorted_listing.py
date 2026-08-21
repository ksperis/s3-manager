# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

from botocore.exceptions import BotoCoreError, ClientError

from app.models.browser import BrowserObject, BrowserObjectSortBy, BrowserObjectSortDir
from app.services.object_listing_temp_store import TemporarySqliteStore


@dataclass(frozen=True)
class SortedObjectScanOptions:
    bucket_name: str
    prefix: str
    item_type: str
    storage_class: str | None
    recursive: bool
    sort_by: BrowserObjectSortBy
    sort_dir: BrowserObjectSortDir


@dataclass
class SortedObjectSnapshot:
    store: TemporarySqliteStore
    sort_by: BrowserObjectSortBy
    sort_dir: BrowserObjectSortDir
    prefix_count: int = 0
    object_count: int = 0

    def close(self) -> None:
        self.store.close()

    def fetch_prefixes(self, offset: int, limit: int) -> list[str]:
        if limit <= 0:
            return []
        cursor = self.store.connection.execute(
            """
            SELECT prefix
            FROM sorted_prefixes
            ORDER BY prefix
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        )
        return [str(row["prefix"]) for row in cursor]

    def fetch_objects(self, offset: int, limit: int) -> list[BrowserObject]:
        if limit <= 0:
            return []
        cursor = self.store.connection.execute(
            f"""
            SELECT key, size, last_modified_iso, storage_class, etag
            FROM sorted_objects
            ORDER BY {self._object_order_by()}
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        )
        return [self._object_from_row(row) for row in cursor]

    def _object_order_by(self) -> str:
        direction = "ASC" if self.sort_dir == "asc" else "DESC"
        null_direction = "ASC" if self.sort_dir == "asc" else "DESC"
        if self.sort_by == "name":
            return f"key {direction}"
        if self.sort_by == "size":
            return f"size {direction}, key ASC"
        if self.sort_by == "modified":
            return f"last_modified_ts IS NULL {null_direction}, last_modified_ts {direction}, key ASC"
        if self.sort_by == "storage_class":
            return f"storage_class IS NULL {null_direction}, storage_class {direction}, key ASC"
        return f"etag IS NULL {null_direction}, etag {direction}, key ASC"

    @staticmethod
    def _object_from_row(row) -> BrowserObject:
        last_modified = None
        raw_last_modified = row["last_modified_iso"]
        if isinstance(raw_last_modified, str) and raw_last_modified:
            try:
                last_modified = datetime.fromisoformat(raw_last_modified)
            except ValueError:
                last_modified = None
        return BrowserObject(
            key=str(row["key"]),
            size=int(row["size"] or 0),
            last_modified=last_modified,
            storage_class=row["storage_class"] if isinstance(row["storage_class"], str) else None,
            etag=row["etag"] if isinstance(row["etag"], str) else None,
        )


class SortedObjectSnapshotBuilder:
    def __init__(
        self,
        *,
        client: Any,
        options: SortedObjectScanOptions,
        matches_query: Callable[[str], bool],
        clean_etag: Callable[[Any], str | None],
        normalize_datetime: Callable[[datetime | None], datetime | None],
    ) -> None:
        self.client = client
        self.options = options
        self.matches_query = matches_query
        self.clean_etag = clean_etag
        self.normalize_datetime = normalize_datetime

    def build(self) -> SortedObjectSnapshot:
        store = TemporarySqliteStore(prefix="bucketreef-browser-sort-")
        try:
            self._create_schema(store)
            self._scan_pages(store)
            self._create_indexes(store)
            store.connection.commit()
            prefix_count, object_count = self._row_counts(store)
            return SortedObjectSnapshot(
                store=store,
                sort_by=self.options.sort_by,
                sort_dir=self.options.sort_dir,
                prefix_count=prefix_count,
                object_count=object_count,
            )
        except Exception:
            store.close()
            raise

    @staticmethod
    def _create_schema(store: TemporarySqliteStore) -> None:
        store.connection.execute(
            """
            CREATE TABLE sorted_prefixes (
                prefix TEXT PRIMARY KEY
            )
            """
        )
        store.connection.execute(
            """
            CREATE TABLE sorted_objects (
                key TEXT PRIMARY KEY,
                size INTEGER NOT NULL,
                last_modified_ts REAL,
                last_modified_iso TEXT,
                storage_class TEXT,
                etag TEXT
            )
            """
        )

    def _scan_pages(self, store: TemporarySqliteStore) -> None:
        scan_token: str | None = None
        while True:
            kwargs = {
                "Bucket": self.options.bucket_name,
                "Prefix": self.options.prefix,
                "MaxKeys": 1000,
            }
            if not self.options.recursive:
                kwargs["Delimiter"] = "/"
            if scan_token:
                kwargs["ContinuationToken"] = scan_token
            try:
                response = self.client.list_objects_v2(**kwargs)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(
                    f"Unable to list objects for '{self.options.bucket_name}': {exc}"
                ) from exc

            for item in response.get("Contents", []):
                self._insert_object(store, item)
            self._insert_common_prefixes(store, response)
            if not response.get("IsTruncated"):
                return
            scan_token = response.get("NextContinuationToken")
            if not scan_token:
                return

    def _insert_object(self, store: TemporarySqliteStore, item: dict) -> None:
        key = item.get("Key")
        if not isinstance(key, str) or not key:
            return
        size = int(item.get("Size") or 0)
        if self.options.prefix and key.rstrip("/") == self.options.prefix.rstrip("/") and size == 0:
            return
        is_folder_marker = key.endswith("/") and size == 0
        if self.options.recursive and self.options.item_type != "file":
            self._insert_recursive_prefixes(store, key, is_folder_marker)
        if self.options.item_type == "folder" or (self.options.recursive and is_folder_marker):
            return
        if not self.matches_query(key):
            return
        storage_class = item.get("StorageClass")
        if self.options.storage_class and storage_class != self.options.storage_class:
            return
        last_modified_ts, last_modified_iso = self._datetime_values(item.get("LastModified"))
        store.connection.execute(
            """
            INSERT OR REPLACE INTO sorted_objects(
                key, size, last_modified_ts, last_modified_iso, storage_class, etag
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                key,
                size,
                last_modified_ts,
                last_modified_iso,
                storage_class if isinstance(storage_class, str) else None,
                self.clean_etag(item.get("ETag")),
            ),
        )

    def _insert_recursive_prefixes(
        self,
        store: TemporarySqliteStore,
        key: str,
        is_folder_marker: bool,
    ) -> None:
        if is_folder_marker and key != self.options.prefix and self.matches_query(key):
            self._insert_prefix(store, key)
        relative = key[len(self.options.prefix):] if key.startswith(self.options.prefix) else key
        segments = [segment for segment in relative.split("/") if segment]
        running = self.options.prefix
        for segment in segments[:-1]:
            running = f"{running}{segment}/"
            if self.matches_query(running):
                self._insert_prefix(store, running)

    def _insert_common_prefixes(self, store: TemporarySqliteStore, response: dict) -> None:
        if self.options.recursive or self.options.item_type == "file":
            return
        for entry in response.get("CommonPrefixes", []) or []:
            prefix = entry.get("Prefix")
            if prefix and self.matches_query(prefix):
                self._insert_prefix(store, prefix)

    @staticmethod
    def _insert_prefix(store: TemporarySqliteStore, prefix: str) -> None:
        store.connection.execute(
            "INSERT OR IGNORE INTO sorted_prefixes(prefix) VALUES (?)",
            (prefix,),
        )

    def _datetime_values(self, value: object) -> tuple[float | None, str | None]:
        normalized = self.normalize_datetime(value if isinstance(value, datetime) else None)
        if normalized is None:
            return None, None
        return normalized.timestamp(), normalized.isoformat()

    @staticmethod
    def _create_indexes(store: TemporarySqliteStore) -> None:
        store.connection.execute("CREATE INDEX sorted_objects_size_idx ON sorted_objects(size, key)")
        store.connection.execute(
            "CREATE INDEX sorted_objects_modified_idx ON sorted_objects(last_modified_ts, key)"
        )
        store.connection.execute(
            "CREATE INDEX sorted_objects_storage_idx ON sorted_objects(storage_class, key)"
        )
        store.connection.execute("CREATE INDEX sorted_objects_etag_idx ON sorted_objects(etag, key)")

    @staticmethod
    def _row_counts(store: TemporarySqliteStore) -> tuple[int, int]:
        prefix_row = store.connection.execute(
            "SELECT COUNT(*) AS count FROM sorted_prefixes"
        ).fetchone()
        object_row = store.connection.execute(
            "SELECT COUNT(*) AS count FROM sorted_objects"
        ).fetchone()
        prefix_count = int(prefix_row["count"] or 0) if prefix_row else 0
        object_count = int(object_row["count"] or 0) if object_row else 0
        return prefix_count, object_count
