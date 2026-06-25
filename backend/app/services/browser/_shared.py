# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import base64
import hashlib
import json
import logging
import os
import re
import sys
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from time import monotonic
from typing import Callable, Generic, Optional, TypeVar
from urllib.parse import unquote, urlencode

from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import get_settings
from app.db import S3Account
from app.models.browser import (
    BrowserBucket,
    BrowserObjectLazyColumn,
    BrowserObjectSortBy,
    BrowserObjectSortDir,
    BrowserObject,
    BrowserObjectVersion,
    BrowserStsCredentials,
    BucketCorsRule,
    BucketCorsStatus,
    CleanupObjectVersionsPayload,
    CleanupObjectVersionsResponse,
    CompleteMultipartUploadRequest,
    CopyObjectPayload,
    DeleteObjectsPayload,
    ListBrowserObjectsResponse,
    ListMultipartUploadsResponse,
    ListObjectVersionsResponse,
    ListPartsResponse,
    MultipartPart,
    MultipartUploadInitRequest,
    MultipartUploadInitResponse,
    MultipartUploadItem,
    ObjectMetadata,
    ObjectAcl,
    ObjectColumnValues,
    ObjectColumnsResponse,
    ObjectLegalHold,
    ObjectMetadataUpdate,
    ObjectRetention,
    ObjectRestoreRequest,
    ObjectTag,
    ObjectTags,
    PaginatedBrowserBucketsResponse,
    PresignPartRequest,
    PresignPartResponse,
    PresignRequest,
    PresignedUrl,
    SseCustomerContext,
    StsStatus,
)
from app.services.s3_client import (
    _delete_objects as _s3_delete_objects,
    create_bucket as _s3_create_bucket,
    get_s3_client as _get_s3_client,
    set_bucket_versioning as _s3_set_bucket_versioning,
)
from app.services.object_listing_temp_store import TemporarySqliteStore
from app.services.sts_service import get_session_token as _get_session_token
from app.utils.s3_endpoint import resolve_s3_client_options as _resolve_s3_client_options
from app.utils.storage_endpoint_features import resolve_feature_flags, resolve_sts_endpoint

logger = logging.getLogger(__name__)
settings = get_settings()


def _facade_override(name: str):
    facade = sys.modules.get("app.services.browser_service")
    if facade is None:
        return None
    override = getattr(facade, name, None)
    current = globals().get(name)
    if callable(override) and override is not current:
        return override
    return None


def _delete_objects(*args, **kwargs):
    override = _facade_override("_delete_objects")
    if override is not None:
        return override(*args, **kwargs)
    return _s3_delete_objects(*args, **kwargs)


def s3_create_bucket(*args, **kwargs):
    override = _facade_override("s3_create_bucket")
    if override is not None:
        return override(*args, **kwargs)
    return _s3_create_bucket(*args, **kwargs)


def get_s3_client(*args, **kwargs):
    override = _facade_override("get_s3_client")
    if override is not None:
        return override(*args, **kwargs)
    return _get_s3_client(*args, **kwargs)


def s3_set_bucket_versioning(*args, **kwargs):
    override = _facade_override("s3_set_bucket_versioning")
    if override is not None:
        return override(*args, **kwargs)
    return _s3_set_bucket_versioning(*args, **kwargs)


def get_session_token(*args, **kwargs):
    override = _facade_override("get_session_token")
    if override is not None:
        return override(*args, **kwargs)
    return _get_session_token(*args, **kwargs)


def resolve_s3_client_options(*args, **kwargs):
    override = _facade_override("resolve_s3_client_options")
    if override is not None:
        return override(*args, **kwargs)
    return _resolve_s3_client_options(*args, **kwargs)

STS_SESSION_DURATION_SECONDS = 3600
STS_CACHE_TTL_BUFFER = timedelta(minutes=5)
STS_FAILURE_TTL = timedelta(seconds=60)
BUCKET_LIST_CACHE_TTL_SECONDS = 30
BUCKET_LIST_CACHE_MAX_ENTRIES = 64
OBJECT_LIST_CACHE_TTL_SECONDS = 10
OBJECT_LIST_CACHE_MAX_ENTRIES = 512
OBJECT_SORT_SNAPSHOT_CACHE_MAX_ENTRIES = 128
OBJECT_LAZY_COLUMN_CACHE_TTL_SECONDS = 15
OBJECT_LAZY_COLUMN_CACHE_MAX_ENTRIES = 2048
OBJECT_LIST_SCAN_PAGE_BUDGET = 20
OBJECT_LIST_SCAN_TIME_BUDGET_MS = 1200
MISSING_OBJECT_LOCK_CONFIGURATION_CODES = {
    "nosuchobjectlockconfiguration",
    "objectlockconfigurationnotfounderror",
}


def _client_error_code(exc: ClientError) -> str:
    return str(exc.response.get("Error", {}).get("Code") or "").strip().lower()


def _is_missing_object_lock_configuration(exc: ClientError) -> bool:
    return _client_error_code(exc) in MISSING_OBJECT_LOCK_CONFIGURATION_CODES


@dataclass(frozen=True)
class CachedStsCredentials:
    access_key_id: str
    secret_access_key: str
    session_token: str
    expiration: datetime


@dataclass
class StsCacheEntry:
    credentials: Optional[CachedStsCredentials] = None
    failed_until: Optional[datetime] = None


_STS_CACHE: dict[str, StsCacheEntry] = {}
_STS_CACHE_LOCK = Lock()

_CacheKey = TypeVar("_CacheKey")
_CacheValue = TypeVar("_CacheValue")


@dataclass
class _TtlLruCacheEntry(Generic[_CacheValue]):
    value: _CacheValue
    expires_at: float


class _TtlLruCache(Generic[_CacheKey, _CacheValue]):
    def __init__(
        self,
        max_entries: int,
        ttl_seconds: int,
        *,
        on_evict: Optional[Callable[[_CacheValue], None]] = None,
    ) -> None:
        self._max_entries = max_entries
        self._ttl_seconds = float(ttl_seconds)
        self._store: OrderedDict[_CacheKey, _TtlLruCacheEntry[_CacheValue]] = OrderedDict()
        self._lock = Lock()
        self._on_evict = on_evict

    def _evict_entry(self, entry: _TtlLruCacheEntry[_CacheValue]) -> None:
        if self._on_evict is None:
            return
        try:
            self._on_evict(entry.value)
        except Exception:  # noqa: BLE001
            logger.debug("Cache eviction cleanup failed", exc_info=True)

    def get(self, key: _CacheKey) -> Optional[_CacheValue]:
        now = monotonic()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            if entry.expires_at <= now:
                del self._store[key]
                self._evict_entry(entry)
                return None
            self._store.move_to_end(key)
            return entry.value

    def set(self, key: _CacheKey, value: _CacheValue) -> None:
        expires_at = monotonic() + self._ttl_seconds
        with self._lock:
            previous = self._store.get(key)
            if previous is not None:
                self._evict_entry(previous)
            self._store[key] = _TtlLruCacheEntry(value=value, expires_at=expires_at)
            self._store.move_to_end(key)
            while len(self._store) > self._max_entries:
                _, evicted = self._store.popitem(last=False)
                self._evict_entry(evicted)

    def invalidate_where(self, predicate: Callable[[_CacheKey], bool]) -> int:
        removed = 0
        with self._lock:
            keys_to_remove = [key for key in self._store.keys() if predicate(key)]
            for key in keys_to_remove:
                entry = self._store.pop(key, None)
                if entry is not None:
                    self._evict_entry(entry)
                removed += 1
        return removed


@dataclass
class _SortedObjectSnapshot:
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
        order_by = self._object_order_by()
        cursor = self.store.connection.execute(
            f"""
            SELECT key, size, last_modified_iso, storage_class, etag
            FROM sorted_objects
            ORDER BY {order_by}
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

    def _object_from_row(self, row) -> BrowserObject:
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


@dataclass(frozen=True)
class _ObjectLazyHeadCacheValue:
    content_type: Optional[str]
    metadata_count: Optional[int]
    cache_control: Optional[str]
    expires: Optional[datetime]
    restore_status: Optional[str]
    available: bool


@dataclass(frozen=True)
class _ObjectLazyTagsCacheValue:
    tags_count: Optional[int]
    available: bool


_BUCKET_LIST_CACHE: _TtlLruCache[str, list[BrowserBucket]] = _TtlLruCache(
    max_entries=BUCKET_LIST_CACHE_MAX_ENTRIES,
    ttl_seconds=BUCKET_LIST_CACHE_TTL_SECONDS,
)
_OBJECT_LIST_CACHE: _TtlLruCache[tuple, ListBrowserObjectsResponse] = _TtlLruCache(
    max_entries=OBJECT_LIST_CACHE_MAX_ENTRIES,
    ttl_seconds=OBJECT_LIST_CACHE_TTL_SECONDS,
)
_OBJECT_SORT_SNAPSHOT_CACHE: _TtlLruCache[tuple, _SortedObjectSnapshot] = _TtlLruCache(
    max_entries=OBJECT_SORT_SNAPSHOT_CACHE_MAX_ENTRIES,
    ttl_seconds=OBJECT_LIST_CACHE_TTL_SECONDS,
    on_evict=lambda snapshot: snapshot.close(),
)
_OBJECT_LAZY_HEAD_CACHE: _TtlLruCache[tuple, _ObjectLazyHeadCacheValue] = _TtlLruCache(
    max_entries=OBJECT_LAZY_COLUMN_CACHE_MAX_ENTRIES,
    ttl_seconds=OBJECT_LAZY_COLUMN_CACHE_TTL_SECONDS,
)
_OBJECT_LAZY_TAGS_CACHE: _TtlLruCache[tuple, _ObjectLazyTagsCacheValue] = _TtlLruCache(
    max_entries=OBJECT_LAZY_COLUMN_CACHE_MAX_ENTRIES,
    ttl_seconds=OBJECT_LAZY_COLUMN_CACHE_TTL_SECONDS,
)


def _resolve_endpoint(account: S3Account) -> str:
    endpoint, _, _, _ = resolve_s3_client_options(account)
    if not endpoint:
        raise RuntimeError("S3 endpoint is not configured for this account")
    return endpoint


def _sts_cache_key(access_key: str, endpoint: str) -> str:
    return f"{endpoint}::{access_key}"


def _normalize_expiration(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _sorted_snapshot_signature(parts: tuple[object, ...]) -> str:
    serialized = json.dumps(parts, separators=(",", ":"), default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _encode_sorted_cursor(*, prefixes_offset: int, objects_offset: int, signature: str) -> str:
    payload = {
        "v": 1,
        "mode": "sorted",
        "po": max(0, int(prefixes_offset)),
        "oo": max(0, int(objects_offset)),
        "sig": signature,
    }
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    return encoded.rstrip("=")


def _decode_sorted_cursor(token: Optional[str]) -> Optional[dict[str, object]]:
    if not token:
        return None
    padded = token + "=" * (-len(token) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
        payload = json.loads(decoded.decode("utf-8"))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    if payload.get("mode") != "sorted" or payload.get("v") != 1:
        return None
    return payload


def _get_cached_sts_credentials(cache_key: str) -> Optional[CachedStsCredentials]:
    now = datetime.now(tz=timezone.utc)
    with _STS_CACHE_LOCK:
        entry = _STS_CACHE.get(cache_key)
        if not entry:
            return None
        if entry.credentials:
            expiration = _normalize_expiration(entry.credentials.expiration)
            if expiration - STS_CACHE_TTL_BUFFER > now:
                return entry.credentials
            entry.credentials = None
        if entry.failed_until and entry.failed_until > now:
            return None
        if entry.failed_until and entry.failed_until <= now:
            entry.failed_until = None
    return None


def _store_sts_credentials(cache_key: str, credentials: CachedStsCredentials) -> None:
    with _STS_CACHE_LOCK:
        _STS_CACHE[cache_key] = StsCacheEntry(credentials=credentials, failed_until=None)


def _record_sts_failure(cache_key: str) -> None:
    now = datetime.now(tz=timezone.utc)
    with _STS_CACHE_LOCK:
        entry = _STS_CACHE.get(cache_key) or StsCacheEntry()
        entry.credentials = None
        entry.failed_until = now + STS_FAILURE_TTL
        _STS_CACHE[cache_key] = entry


__all__ = [name for name in globals() if not name.startswith("__")]
