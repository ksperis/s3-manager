# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from time import monotonic
from typing import Any, Callable, Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.models.browser import (
    BrowserObject,
    BrowserObjectSortBy,
    BrowserObjectSortDir,
    BrowserObjectVersion,
    ListBrowserObjectsResponse,
    ListObjectVersionsResponse,
)
from app.services.object_listing_temp_store import TemporarySqliteStore
from app.services.s3_execution_context import S3ExecutionTarget

from ._shared import (
    OBJECT_LIST_SCAN_PAGE_BUDGET,
    OBJECT_LIST_SCAN_TIME_BUDGET_MS,
    _OBJECT_LIST_CACHE,
    _OBJECT_SORT_SNAPSHOT_CACHE,
    _SortedObjectSnapshot,
    _decode_sorted_cursor,
    _encode_sorted_cursor,
    _sorted_snapshot_signature,
)

logger = logging.getLogger(__name__)


@dataclass
class _FilteredObjectListing:
    normalized_prefix: str
    max_keys: int
    matches_query: Callable[[str], bool]
    type_filter: str
    storage_filter: str | None
    recursive: bool
    objects: list[BrowserObject] = field(default_factory=list)
    prefixes: list[str] = field(default_factory=list)
    seen_prefixes: set[str] = field(default_factory=set)

    @property
    def item_count(self) -> int:
        return len(self.objects) + len(self.prefixes)

    @property
    def is_full(self) -> bool:
        return self.item_count >= self.max_keys

    def add_page(self, response: dict[str, Any], clean_etag: Callable[[Any], str | None]) -> None:
        recursive_prefixes = self._add_objects(response.get("Contents", []), clean_etag)
        if not self.recursive and self.type_filter != "file":
            common_prefixes = [
                prefix
                for entry in (response.get("CommonPrefixes", []) or [])
                if (prefix := entry.get("Prefix"))
            ]
            self._add_prefixes(common_prefixes)
        elif self.recursive and self.type_filter != "file":
            self._add_prefixes(sorted(recursive_prefixes))

    def _add_objects(
        self,
        entries: list[dict[str, Any]],
        clean_etag: Callable[[Any], str | None],
    ) -> set[str]:
        recursive_prefixes: set[str] = set()
        for entry in entries:
            key = entry.get("Key")
            if not key:
                continue
            size = int(entry.get("Size") or 0)
            if self.normalized_prefix and key.rstrip("/") == self.normalized_prefix.rstrip("/") and size == 0:
                continue
            is_folder_marker = key.endswith("/") and size == 0

            if self.recursive and self.type_filter != "file":
                recursive_prefixes.update(self._recursive_prefixes_for_key(key, is_folder_marker))

            if self.type_filter == "folder" or (self.recursive and is_folder_marker):
                continue
            if not self.matches_query(key):
                continue
            storage_class = entry.get("StorageClass")
            if self.storage_filter and storage_class != self.storage_filter:
                continue
            if self.is_full:
                continue
            self.objects.append(
                BrowserObject(
                    key=key,
                    size=size,
                    last_modified=entry.get("LastModified"),
                    storage_class=storage_class,
                    etag=clean_etag(entry.get("ETag")),
                )
            )
        return recursive_prefixes

    def _recursive_prefixes_for_key(self, key: str, is_folder_marker: bool) -> set[str]:
        prefixes: set[str] = set()
        if is_folder_marker and key != self.normalized_prefix:
            prefixes.add(key)
        relative = (
            key[len(self.normalized_prefix):]
            if self.normalized_prefix and key.startswith(self.normalized_prefix)
            else key
        )
        segments = [segment for segment in relative.split("/") if segment]
        running = self.normalized_prefix
        for segment in segments[:-1]:
            running = f"{running}{segment}/"
            prefixes.add(running)
        return prefixes

    def _add_prefixes(self, candidates: list[str]) -> None:
        for prefix in candidates:
            if prefix in self.seen_prefixes or not self.matches_query(prefix):
                continue
            if self.is_full:
                break
            self.seen_prefixes.add(prefix)
            self.prefixes.append(prefix)


class BrowserListingMixin:
    def _build_query_matcher(
        self,
        *,
        normalized_prefix: str,
        query_value_raw: str,
        query_exact: bool,
        query_case_sensitive: bool,
    ) -> Callable[[str], bool]:
        query_value = query_value_raw if query_case_sensitive else query_value_raw.lower()

        def matches_query(value: str) -> bool:
            if not query_value:
                return True
            relative = value
            if normalized_prefix and relative.startswith(normalized_prefix):
                relative = relative[len(normalized_prefix):]
            if relative.endswith("/"):
                relative = relative[:-1]
            comparable_value = relative if query_case_sensitive else relative.lower()
            if query_exact:
                return comparable_value == query_value
            return query_value in comparable_value

        return matches_query

    def _list_objects_default_order(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        *,
        prefix: str = "",
        continuation_token: Optional[str] = None,
        max_keys: int = 1000,
        query: Optional[str] = None,
        query_exact: bool = False,
        query_case_sensitive: bool = False,
        item_type: Optional[str] = None,
        storage_class: Optional[str] = None,
        recursive: bool = False,
    ) -> ListBrowserObjectsResponse:
        normalized_prefix = prefix or ""
        normalized_max_keys = max(1, min(1000, int(max_keys or 1000)))
        query_value_raw = (query or "").strip()
        type_filter = (item_type or "all").lower()
        if type_filter not in {"all", "file", "folder"}:
            type_filter = "all"
        storage_filter = (storage_class or "").strip() or None
        account_cache_key = self._account_cache_key(account)
        object_cache_key = self._object_list_cache_key(
            account_cache_key=account_cache_key,
            bucket_name=bucket_name,
            prefix=normalized_prefix,
            continuation_token=continuation_token,
            max_keys=normalized_max_keys,
            query=query_value_raw,
            query_exact=query_exact,
            query_case_sensitive=query_case_sensitive,
            item_type=type_filter,
            storage_class=storage_filter,
            recursive=recursive,
        )
        cached = _OBJECT_LIST_CACHE.get(object_cache_key)
        if cached is not None:
            logger.debug("Browser object cache hit: account=%s bucket=%s", account_cache_key, bucket_name)
            return cached.model_copy(deep=True)
        client = self._client(account)
        matches_query = self._build_query_matcher(
            normalized_prefix=normalized_prefix,
            query_value_raw=query_value_raw,
            query_exact=query_exact,
            query_case_sensitive=query_case_sensitive,
        )
        filtered_mode = bool(query_value_raw) or type_filter != "all" or storage_filter is not None or recursive

        if not filtered_mode:
            kwargs = {
                "Bucket": bucket_name,
                "Prefix": normalized_prefix,
                "MaxKeys": normalized_max_keys,
                "Delimiter": "/",
            }
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token
            try:
                resp = client.list_objects_v2(**kwargs)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to list objects for '{bucket_name}': {exc}") from exc
            objects: list[BrowserObject] = []
            for obj in resp.get("Contents", []):
                key = obj.get("Key")
                if not key:
                    continue
                size = int(obj.get("Size") or 0)
                if prefix and key.rstrip("/") == prefix.rstrip("/") and size == 0:
                    continue
                objects.append(
                    BrowserObject(
                        key=key,
                        size=size,
                        last_modified=obj.get("LastModified"),
                        storage_class=obj.get("StorageClass"),
                        etag=self._clean_etag(obj.get("ETag")),
                    )
                )
            prefixes = [
                prefix_value
                for entry in (resp.get("CommonPrefixes", []) or [])
                if (prefix_value := entry.get("Prefix"))
            ]
            result = ListBrowserObjectsResponse(
                prefix=prefix,
                objects=objects,
                prefixes=prefixes,
                is_truncated=bool(resp.get("IsTruncated")),
                next_continuation_token=resp.get("NextContinuationToken"),
            )
            _OBJECT_LIST_CACHE.set(object_cache_key, result.model_copy(deep=True))
            logger.debug("Browser object cache miss: account=%s bucket=%s", account_cache_key, bucket_name)
            return result

        listing = _FilteredObjectListing(
            normalized_prefix=normalized_prefix,
            max_keys=normalized_max_keys,
            matches_query=matches_query,
            type_filter=type_filter,
            storage_filter=storage_filter,
            recursive=recursive,
        )
        scan_token = continuation_token
        scan_start = monotonic()
        pages_scanned = 0

        while True:
            elapsed_ms = int((monotonic() - scan_start) * 1000)
            if pages_scanned >= OBJECT_LIST_SCAN_PAGE_BUDGET or elapsed_ms >= OBJECT_LIST_SCAN_TIME_BUDGET_MS:
                break

            remaining = max(normalized_max_keys - listing.item_count, 1)
            kwargs = {
                "Bucket": bucket_name,
                "Prefix": normalized_prefix,
                "MaxKeys": remaining,
            }
            if not recursive:
                kwargs["Delimiter"] = "/"
            if scan_token:
                kwargs["ContinuationToken"] = scan_token
            try:
                resp = client.list_objects_v2(**kwargs)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to list objects for '{bucket_name}': {exc}") from exc

            pages_scanned += 1
            listing.add_page(resp, self._clean_etag)

            is_truncated = bool(resp.get("IsTruncated"))
            scan_token = resp.get("NextContinuationToken") if is_truncated else None
            if listing.is_full:
                break
            if not is_truncated:
                break

        result = ListBrowserObjectsResponse(
            prefix=prefix,
            objects=listing.objects,
            prefixes=listing.prefixes,
            is_truncated=bool(scan_token),
            next_continuation_token=scan_token,
        )
        _OBJECT_LIST_CACHE.set(object_cache_key, result.model_copy(deep=True))
        logger.debug("Browser object cache miss: account=%s bucket=%s", account_cache_key, bucket_name)
        return result

    def _scan_sorted_object_snapshot(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        *,
        prefix: str = "",
        query: Optional[str] = None,
        query_exact: bool = False,
        query_case_sensitive: bool = False,
        item_type: Optional[str] = None,
        storage_class: Optional[str] = None,
        recursive: bool = False,
        sort_by: BrowserObjectSortBy,
        sort_dir: BrowserObjectSortDir,
    ) -> _SortedObjectSnapshot:
        normalized_prefix = prefix or ""
        query_value_raw = (query or "").strip()
        type_filter = (item_type or "all").lower()
        if type_filter not in {"all", "file", "folder"}:
            type_filter = "all"
        storage_filter = (storage_class or "").strip() or None
        account_cache_key = self._account_cache_key(account)
        snapshot_cache_key = self._object_sort_snapshot_cache_key(
            account_cache_key=account_cache_key,
            bucket_name=bucket_name,
            prefix=normalized_prefix,
            query=query_value_raw,
            query_exact=query_exact,
            query_case_sensitive=query_case_sensitive,
            item_type=type_filter,
            storage_class=storage_filter,
            recursive=recursive,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
        cached = _OBJECT_SORT_SNAPSHOT_CACHE.get(snapshot_cache_key)
        if cached is not None:
            return cached

        client = self._client(account)
        matches_query = self._build_query_matcher(
            normalized_prefix=normalized_prefix,
            query_value_raw=query_value_raw,
            query_exact=query_exact,
            query_case_sensitive=query_case_sensitive,
        )
        store = TemporarySqliteStore(prefix="bucketreef-browser-sort-")
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
        scan_token: Optional[str] = None

        def datetime_values(value: object) -> tuple[Optional[float], Optional[str]]:
            normalized = self._normalize_datetime_value(value if isinstance(value, datetime) else None)
            if normalized is None:
                return None, None
            return normalized.timestamp(), normalized.isoformat()

        def insert_object(obj: dict) -> None:
            key = obj.get("Key")
            if not isinstance(key, str) or not key:
                return
            size = int(obj.get("Size") or 0)
            if prefix and key.rstrip("/") == prefix.rstrip("/") and size == 0:
                return
            is_folder_marker = key.endswith("/") and size == 0

            if recursive and type_filter != "file":
                if is_folder_marker and key != normalized_prefix:
                    if matches_query(key):
                        store.connection.execute("INSERT OR IGNORE INTO sorted_prefixes(prefix) VALUES (?)", (key,))
                if normalized_prefix and key.startswith(normalized_prefix):
                    relative = key[len(normalized_prefix):]
                else:
                    relative = key
                segments = [segment for segment in relative.split("/") if segment]
                if len(segments) > 1:
                    running = normalized_prefix
                    for segment in segments[:-1]:
                        running = f"{running}{segment}/"
                        if matches_query(running):
                            store.connection.execute("INSERT OR IGNORE INTO sorted_prefixes(prefix) VALUES (?)", (running,))

            if type_filter == "folder":
                return
            if recursive and is_folder_marker:
                return
            if not matches_query(key):
                return
            storage = obj.get("StorageClass")
            if storage_filter and storage != storage_filter:
                return
            last_modified_ts, last_modified_iso = datetime_values(obj.get("LastModified"))
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
                    storage if isinstance(storage, str) else None,
                    self._clean_etag(obj.get("ETag")),
                ),
            )

        try:
            while True:
                kwargs = {
                    "Bucket": bucket_name,
                    "Prefix": normalized_prefix,
                    "MaxKeys": 1000,
                }
                if not recursive:
                    kwargs["Delimiter"] = "/"
                if scan_token:
                    kwargs["ContinuationToken"] = scan_token
                try:
                    resp = client.list_objects_v2(**kwargs)
                except (ClientError, BotoCoreError) as exc:
                    raise RuntimeError(f"Unable to list objects for '{bucket_name}': {exc}") from exc

                for obj in resp.get("Contents", []):
                    insert_object(obj)

                if not recursive and type_filter != "file":
                    for entry in resp.get("CommonPrefixes", []) or []:
                        prefix_value = entry.get("Prefix")
                        if not prefix_value or not matches_query(prefix_value):
                            continue
                        store.connection.execute("INSERT OR IGNORE INTO sorted_prefixes(prefix) VALUES (?)", (prefix_value,))

                if not resp.get("IsTruncated"):
                    break
                scan_token = resp.get("NextContinuationToken")
                if not scan_token:
                    break

            store.connection.execute("CREATE INDEX sorted_objects_size_idx ON sorted_objects(size, key)")
            store.connection.execute("CREATE INDEX sorted_objects_modified_idx ON sorted_objects(last_modified_ts, key)")
            store.connection.execute("CREATE INDEX sorted_objects_storage_idx ON sorted_objects(storage_class, key)")
            store.connection.execute("CREATE INDEX sorted_objects_etag_idx ON sorted_objects(etag, key)")
            store.connection.commit()
            prefix_count_row = store.connection.execute("SELECT COUNT(*) AS count FROM sorted_prefixes").fetchone()
            object_count_row = store.connection.execute("SELECT COUNT(*) AS count FROM sorted_objects").fetchone()
            snapshot = _SortedObjectSnapshot(
                store=store,
                sort_by=sort_by,
                sort_dir=sort_dir,
                prefix_count=int(prefix_count_row["count"] or 0) if prefix_count_row else 0,
                object_count=int(object_count_row["count"] or 0) if object_count_row else 0,
            )
        except Exception:
            store.close()
            raise
        _OBJECT_SORT_SNAPSHOT_CACHE.set(snapshot_cache_key, snapshot)
        return snapshot

    def list_objects(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        prefix: str = "",
        continuation_token: Optional[str] = None,
        max_keys: int = 1000,
        query: Optional[str] = None,
        query_exact: bool = False,
        query_case_sensitive: bool = False,
        item_type: Optional[str] = None,
        storage_class: Optional[str] = None,
        recursive: bool = False,
        sort_by: BrowserObjectSortBy = "name",
        sort_dir: BrowserObjectSortDir = "asc",
        force_refresh: bool = False,
    ) -> ListBrowserObjectsResponse:
        normalized_max_keys = max(1, min(1000, int(max_keys or 1000)))
        if force_refresh:
            self.invalidate_object_list_cache_for_account(account, bucket_name)
        if sort_by == "name" and sort_dir == "asc":
            return self._list_objects_default_order(
                bucket_name,
                account,
                prefix=prefix,
                continuation_token=continuation_token,
                max_keys=normalized_max_keys,
                query=query,
                query_exact=query_exact,
                query_case_sensitive=query_case_sensitive,
                item_type=item_type,
                storage_class=storage_class,
                recursive=recursive,
            )

        snapshot = self._scan_sorted_object_snapshot(
            bucket_name,
            account,
            prefix=prefix,
            query=query,
            query_exact=query_exact,
            query_case_sensitive=query_case_sensitive,
            item_type=item_type,
            storage_class=storage_class,
            recursive=recursive,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
        account_cache_key = self._account_cache_key(account)
        snapshot_signature = _sorted_snapshot_signature(
            self._object_sort_snapshot_cache_key(
                account_cache_key=account_cache_key,
                bucket_name=bucket_name,
                prefix=prefix or "",
                query=(query or "").strip(),
                query_exact=query_exact,
                query_case_sensitive=query_case_sensitive,
                item_type=(item_type or "all").lower() if (item_type or "").lower() in {"all", "file", "folder"} else "all",
                storage_class=(storage_class or "").strip() or None,
                recursive=recursive,
                sort_by=sort_by,
                sort_dir=sort_dir,
            )
        )
        cursor_payload = _decode_sorted_cursor(continuation_token)
        prefixes_offset = 0
        objects_offset = 0
        if cursor_payload and cursor_payload.get("sig") == snapshot_signature:
            prefixes_offset = max(0, int(cursor_payload.get("po") or 0))
            objects_offset = max(0, int(cursor_payload.get("oo") or 0))
        prefixes_offset = min(prefixes_offset, snapshot.prefix_count)
        objects_offset = min(objects_offset, snapshot.object_count)

        prefixes = snapshot.fetch_prefixes(prefixes_offset, normalized_max_keys)
        remaining = normalized_max_keys - len(prefixes)
        objects = snapshot.fetch_objects(objects_offset, remaining)
        next_prefixes_offset = prefixes_offset + len(prefixes)
        next_objects_offset = objects_offset + len(objects)
        has_more = next_prefixes_offset < snapshot.prefix_count or next_objects_offset < snapshot.object_count
        next_token = None
        if has_more:
            next_token = _encode_sorted_cursor(
                prefixes_offset=next_prefixes_offset,
                objects_offset=next_objects_offset,
                signature=snapshot_signature,
            )
        return ListBrowserObjectsResponse(
            prefix=prefix,
            objects=objects,
            prefixes=list(prefixes),
            is_truncated=has_more,
            next_continuation_token=next_token,
        )

    def list_object_versions(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        prefix: str = "",
        delimiter: Optional[str] = None,
        key: Optional[str] = None,
        key_marker: Optional[str] = None,
        version_id_marker: Optional[str] = None,
        max_keys: int = 1000,
    ) -> ListObjectVersionsResponse:
        client = self._client(account)
        filter_key = (key or "").strip() or None
        query_prefix = filter_key or (prefix or "")
        kwargs = {
            "Bucket": bucket_name,
            "Prefix": query_prefix,
            "MaxKeys": max_keys,
        }
        if delimiter and not filter_key:
            kwargs["Delimiter"] = delimiter
        if key_marker:
            kwargs["KeyMarker"] = key_marker
        if version_id_marker:
            kwargs["VersionIdMarker"] = version_id_marker
        try:
            resp = client.list_object_versions(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list object versions for '{bucket_name}': {exc}") from exc
        versions: list[BrowserObjectVersion] = []
        delete_markers: list[BrowserObjectVersion] = []
        for ver in resp.get("Versions", []):
            key = ver.get("Key")
            if not key:
                continue
            if filter_key and key != filter_key:
                continue
            versions.append(
                BrowserObjectVersion(
                    key=key,
                    version_id=ver.get("VersionId"),
                    is_latest=bool(ver.get("IsLatest")),
                    last_modified=ver.get("LastModified"),
                    size=int(ver.get("Size") or 0),
                    etag=self._clean_etag(ver.get("ETag")),
                    storage_class=ver.get("StorageClass"),
                )
            )
        for marker in resp.get("DeleteMarkers", []):
            key = marker.get("Key")
            if not key:
                continue
            if filter_key and key != filter_key:
                continue
            delete_markers.append(
                BrowserObjectVersion(
                    key=key,
                    version_id=marker.get("VersionId"),
                    is_latest=bool(marker.get("IsLatest")),
                    is_delete_marker=True,
                    last_modified=marker.get("LastModified"),
                )
            )
        response_prefix = filter_key or (prefix or None)
        return ListObjectVersionsResponse(
            prefix=response_prefix,
            common_prefixes=[
                str(entry["Prefix"])
                for entry in resp.get("CommonPrefixes", [])
                if entry.get("Prefix")
            ],
            versions=versions,
            delete_markers=delete_markers,
            is_truncated=bool(resp.get("IsTruncated")),
            key_marker=resp.get("KeyMarker"),
            version_id_marker=resp.get("VersionIdMarker"),
            next_key_marker=resp.get("NextKeyMarker"),
            next_version_id_marker=resp.get("NextVersionIdMarker"),
        )
