# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from time import monotonic
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError

from app.models.browser import BrowserObject, ListBrowserObjectsResponse

from ._shared import OBJECT_LIST_SCAN_PAGE_BUDGET, OBJECT_LIST_SCAN_TIME_BUDGET_MS


@dataclass(frozen=True)
class DefaultObjectScanOptions:
    bucket_name: str
    prefix: str
    max_keys: int
    item_type: str
    storage_class: str | None
    recursive: bool


@dataclass
class _FilteredObjectListing:
    options: DefaultObjectScanOptions
    matches_query: Callable[[str], bool]
    objects: list[BrowserObject] = field(default_factory=list)
    prefixes: list[str] = field(default_factory=list)
    seen_prefixes: set[str] = field(default_factory=set)

    @property
    def item_count(self) -> int:
        return len(self.objects) + len(self.prefixes)

    @property
    def is_full(self) -> bool:
        return self.item_count >= self.options.max_keys

    def add_page(
        self,
        response: dict[str, Any],
        clean_etag: Callable[[Any], str | None],
    ) -> None:
        recursive_prefixes = self._add_objects(response.get("Contents", []), clean_etag)
        if not self.options.recursive and self.options.item_type != "file":
            common_prefixes = [
                prefix
                for entry in (response.get("CommonPrefixes", []) or [])
                if (prefix := entry.get("Prefix"))
            ]
            self._add_prefixes(common_prefixes)
        elif self.options.recursive and self.options.item_type != "file":
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
            if (
                self.options.prefix
                and key.rstrip("/") == self.options.prefix.rstrip("/")
                and size == 0
            ):
                continue
            is_folder_marker = key.endswith("/") and size == 0

            if self.options.recursive and self.options.item_type != "file":
                recursive_prefixes.update(
                    self._recursive_prefixes_for_key(key, is_folder_marker)
                )

            if self.options.item_type == "folder" or (
                self.options.recursive and is_folder_marker
            ):
                continue
            if not self.matches_query(key):
                continue
            storage_class = entry.get("StorageClass")
            if self.options.storage_class and storage_class != self.options.storage_class:
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
        if is_folder_marker and key != self.options.prefix:
            prefixes.add(key)
        relative = (
            key[len(self.options.prefix) :]
            if self.options.prefix and key.startswith(self.options.prefix)
            else key
        )
        segments = [segment for segment in relative.split("/") if segment]
        running = self.options.prefix
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


class DefaultObjectListingLoader:
    def __init__(
        self,
        *,
        client: Any,
        options: DefaultObjectScanOptions,
        matches_query: Callable[[str], bool],
        clean_etag: Callable[[Any], str | None],
    ) -> None:
        self.client = client
        self.options = options
        self.matches_query = matches_query
        self.clean_etag = clean_etag

    def load(
        self,
        *,
        continuation_token: str | None,
        filtered: bool,
    ) -> ListBrowserObjectsResponse:
        if filtered:
            return self._load_filtered(continuation_token)
        return self._load_unfiltered(continuation_token)

    def _request_page(
        self,
        *,
        max_keys: int,
        continuation_token: str | None,
        delimiter: bool,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "Bucket": self.options.bucket_name,
            "Prefix": self.options.prefix,
            "MaxKeys": max_keys,
        }
        if delimiter:
            kwargs["Delimiter"] = "/"
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token
        try:
            return self.client.list_objects_v2(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to list objects for '{self.options.bucket_name}': {exc}"
            ) from exc

    def _load_unfiltered(
        self,
        continuation_token: str | None,
    ) -> ListBrowserObjectsResponse:
        response = self._request_page(
            max_keys=self.options.max_keys,
            continuation_token=continuation_token,
            delimiter=True,
        )
        objects: list[BrowserObject] = []
        for item in response.get("Contents", []):
            key = item.get("Key")
            if not key:
                continue
            size = int(item.get("Size") or 0)
            if (
                self.options.prefix
                and key.rstrip("/") == self.options.prefix.rstrip("/")
                and size == 0
            ):
                continue
            objects.append(
                BrowserObject(
                    key=key,
                    size=size,
                    last_modified=item.get("LastModified"),
                    storage_class=item.get("StorageClass"),
                    etag=self.clean_etag(item.get("ETag")),
                )
            )
        prefixes = [
            prefix
            for entry in (response.get("CommonPrefixes", []) or [])
            if (prefix := entry.get("Prefix"))
        ]
        return ListBrowserObjectsResponse(
            prefix=self.options.prefix,
            objects=objects,
            prefixes=prefixes,
            is_truncated=bool(response.get("IsTruncated")),
            next_continuation_token=response.get("NextContinuationToken"),
        )

    def _load_filtered(
        self,
        continuation_token: str | None,
    ) -> ListBrowserObjectsResponse:
        listing = _FilteredObjectListing(
            options=self.options,
            matches_query=self.matches_query,
        )
        scan_token = continuation_token
        scan_start = monotonic()
        pages_scanned = 0

        while True:
            elapsed_ms = int((monotonic() - scan_start) * 1000)
            if (
                pages_scanned >= OBJECT_LIST_SCAN_PAGE_BUDGET
                or elapsed_ms >= OBJECT_LIST_SCAN_TIME_BUDGET_MS
            ):
                break
            response = self._request_page(
                max_keys=max(self.options.max_keys - listing.item_count, 1),
                continuation_token=scan_token,
                delimiter=not self.options.recursive,
            )
            pages_scanned += 1
            listing.add_page(response, self.clean_etag)

            is_truncated = bool(response.get("IsTruncated"))
            scan_token = response.get("NextContinuationToken") if is_truncated else None
            if listing.is_full or not is_truncated:
                break

        return ListBrowserObjectsResponse(
            prefix=self.options.prefix,
            objects=listing.objects,
            prefixes=listing.prefixes,
            is_truncated=bool(scan_token),
            next_continuation_token=scan_token,
        )
