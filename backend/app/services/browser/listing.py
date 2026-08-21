# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Callable, Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.models.browser import (
    BrowserObjectSortBy,
    BrowserObjectSortDir,
    BrowserObjectVersion,
    ListBrowserObjectsResponse,
    ListObjectVersionsResponse,
)
from app.services.s3_execution_context import S3ExecutionTarget

from ._shared import (
    _OBJECT_LIST_CACHE,
    _OBJECT_SORT_SNAPSHOT_CACHE,
    _decode_sorted_cursor,
    _encode_sorted_cursor,
    _sorted_snapshot_signature,
)
from .default_listing import DefaultObjectListingLoader, DefaultObjectScanOptions
from .sorted_listing import (
    SortedObjectScanOptions,
    SortedObjectSnapshot,
    SortedObjectSnapshotBuilder,
)

logger = logging.getLogger(__name__)


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
        result = DefaultObjectListingLoader(
            client=self._client(account),
            options=DefaultObjectScanOptions(
                bucket_name=bucket_name,
                prefix=normalized_prefix,
                max_keys=normalized_max_keys,
                item_type=type_filter,
                storage_class=storage_filter,
                recursive=recursive,
            ),
            matches_query=self._build_query_matcher(
                normalized_prefix=normalized_prefix,
                query_value_raw=query_value_raw,
                query_exact=query_exact,
                query_case_sensitive=query_case_sensitive,
            ),
            clean_etag=self._clean_etag,
        ).load(
            continuation_token=continuation_token,
            filtered=(
                bool(query_value_raw)
                or type_filter != "all"
                or storage_filter is not None
                or recursive
            ),
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
    ) -> SortedObjectSnapshot:
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

        snapshot = SortedObjectSnapshotBuilder(
            client=self._client(account),
            options=SortedObjectScanOptions(
                bucket_name=bucket_name,
                prefix=normalized_prefix,
                item_type=type_filter,
                storage_class=storage_filter,
                recursive=recursive,
                sort_by=sort_by,
                sort_dir=sort_dir,
            ),
            matches_query=self._build_query_matcher(
                normalized_prefix=normalized_prefix,
                query_value_raw=query_value_raw,
                query_exact=query_exact,
                query_case_sensitive=query_case_sensitive,
            ),
            clean_etag=self._clean_etag,
            normalize_datetime=self._normalize_datetime_value,
        ).build()
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
                item_type=(
                    (item_type or "all").lower()
                    if (item_type or "").lower() in {"all", "file", "folder"}
                    else "all"
                ),
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
