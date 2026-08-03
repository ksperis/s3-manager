# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import Future
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Callable

from app.models.ceph_admin import CephAdminBucketSummary
from app.routers.ceph_admin.dependencies import CephAdminContext
from app.services.bucket_owner_enrichment import BucketOwnerUsage
from app.utils.cache import prune_expired_lru_cache
from app.utils.rgw import extract_bucket_list

BUCKET_LIST_CACHE_TTL_SECONDS = 1800.0
BUCKET_LIST_CACHE_MAX_ENTRIES = 64
RGW_BUCKET_PAYLOAD_CACHE_MAX_ENTRIES = 16
BUCKET_ENRICH_MAX_WORKERS = 6
BUCKET_OWNER_LOOKUP_MAX_WORKERS = 6


@dataclass(frozen=True)
class _BucketListCacheKey:
    endpoint_id: int
    advanced_filter: str | None
    sort_by: str
    sort_dir: str
    with_stats: bool
    with_owner_metadata: bool
    with_owner_usage: bool


@dataclass
class _BucketListCacheEntry:
    endpoint_id: int
    expires_at: float
    listing: _BucketListingSnapshot


@dataclass
class _BucketListingSnapshot:
    items: list[CephAdminBucketSummary]
    stats_available: bool = True
    stats_warning: str | None = None
    owner_usage_by_key: dict[str, BucketOwnerUsage] | None = None


@dataclass(frozen=True)
class _RgwBucketPayloadCacheKey:
    endpoint_id: int
    with_stats: bool


@dataclass
class _RgwBucketPayloadCacheEntry:
    endpoint_id: int
    expires_at: float
    entries: list[dict]


_BUCKET_LIST_CACHE: OrderedDict[_BucketListCacheKey, _BucketListCacheEntry] = OrderedDict()
_BUCKET_LIST_CACHE_LOCK = Lock()
_BUCKET_LIST_INFLIGHT: dict[_BucketListCacheKey, Future[_BucketListingSnapshot]] = {}
_RGW_BUCKET_PAYLOAD_CACHE: OrderedDict[_RgwBucketPayloadCacheKey, _RgwBucketPayloadCacheEntry] = OrderedDict()
_RGW_BUCKET_PAYLOAD_CACHE_LOCK = Lock()
_RGW_BUCKET_PAYLOAD_ENDPOINT_LOCKS: dict[int, Lock] = {}
_RGW_BUCKET_PAYLOAD_ENDPOINT_LOCKS_LOCK = Lock()


def _clone_bucket(bucket: CephAdminBucketSummary) -> CephAdminBucketSummary:
    return bucket.model_copy(deep=True)


def _clone_bucket_list(items: list[CephAdminBucketSummary]) -> list[CephAdminBucketSummary]:
    return [_clone_bucket(item) for item in items]


def _get_rgw_bucket_payload_endpoint_lock(endpoint_id: int) -> Lock:
    with _RGW_BUCKET_PAYLOAD_ENDPOINT_LOCKS_LOCK:
        lock = _RGW_BUCKET_PAYLOAD_ENDPOINT_LOCKS.get(endpoint_id)
        if lock is None:
            lock = Lock()
            _RGW_BUCKET_PAYLOAD_ENDPOINT_LOCKS[endpoint_id] = lock
        return lock


def _get_rgw_bucket_entries_from_cache(key: _RgwBucketPayloadCacheKey) -> list[dict] | None:
    now = monotonic()
    with _RGW_BUCKET_PAYLOAD_CACHE_LOCK:
        prune_expired_lru_cache(
            _RGW_BUCKET_PAYLOAD_CACHE,
            now=now,
            max_entries=RGW_BUCKET_PAYLOAD_CACHE_MAX_ENTRIES,
        )
        cached = _RGW_BUCKET_PAYLOAD_CACHE.get(key)
        if cached is not None:
            _RGW_BUCKET_PAYLOAD_CACHE.move_to_end(key)
            return cached.entries

        if not key.with_stats:
            stats_key = _RgwBucketPayloadCacheKey(endpoint_id=key.endpoint_id, with_stats=True)
            cached_stats = _RGW_BUCKET_PAYLOAD_CACHE.get(stats_key)
            if cached_stats is not None:
                _RGW_BUCKET_PAYLOAD_CACHE.move_to_end(stats_key)
                return cached_stats.entries
    return None


def _get_cached_rgw_bucket_entries(ctx: CephAdminContext, with_stats: bool) -> list[dict]:
    endpoint_id = int(getattr(ctx.endpoint, "id", 0) or 0)
    key = _RgwBucketPayloadCacheKey(endpoint_id=endpoint_id, with_stats=with_stats)
    cached = _get_rgw_bucket_entries_from_cache(key)
    if cached is not None:
        return cached

    endpoint_lock = _get_rgw_bucket_payload_endpoint_lock(endpoint_id)
    with endpoint_lock:
        cached = _get_rgw_bucket_entries_from_cache(key)
        if cached is not None:
            return cached

        payload = ctx.rgw_admin.get_all_buckets(with_stats=with_stats)
        entries = extract_bucket_list(payload)
        expires_at = monotonic() + BUCKET_LIST_CACHE_TTL_SECONDS
        with _RGW_BUCKET_PAYLOAD_CACHE_LOCK:
            prune_expired_lru_cache(
                _RGW_BUCKET_PAYLOAD_CACHE,
                now=monotonic(),
                max_entries=RGW_BUCKET_PAYLOAD_CACHE_MAX_ENTRIES,
            )
            _RGW_BUCKET_PAYLOAD_CACHE[key] = _RgwBucketPayloadCacheEntry(
                endpoint_id=key.endpoint_id,
                expires_at=expires_at,
                entries=entries,
            )
            _RGW_BUCKET_PAYLOAD_CACHE.move_to_end(key)
            prune_expired_lru_cache(
                _RGW_BUCKET_PAYLOAD_CACHE,
                now=monotonic(),
                max_entries=RGW_BUCKET_PAYLOAD_CACHE_MAX_ENTRIES,
            )
        return entries


def _get_cached_bucket_listing(
    key: _BucketListCacheKey,
    builder: Callable[[], _BucketListingSnapshot],
) -> _BucketListingSnapshot:
    now = monotonic()
    is_owner = False
    in_flight: Future[_BucketListingSnapshot] | None = None
    with _BUCKET_LIST_CACHE_LOCK:
        prune_expired_lru_cache(
            _BUCKET_LIST_CACHE,
            now=now,
            max_entries=BUCKET_LIST_CACHE_MAX_ENTRIES,
        )
        cached = _BUCKET_LIST_CACHE.get(key)
        if cached is not None:
            _BUCKET_LIST_CACHE.move_to_end(key)
            return cached.listing
        in_flight = _BUCKET_LIST_INFLIGHT.get(key)
        if in_flight is None:
            in_flight = Future()
            _BUCKET_LIST_INFLIGHT[key] = in_flight
            is_owner = True

    if not is_owner:
        return in_flight.result()

    try:
        listing = builder()
        expires_at = monotonic() + BUCKET_LIST_CACHE_TTL_SECONDS
        with _BUCKET_LIST_CACHE_LOCK:
            prune_expired_lru_cache(
                _BUCKET_LIST_CACHE,
                now=monotonic(),
                max_entries=BUCKET_LIST_CACHE_MAX_ENTRIES,
            )
            _BUCKET_LIST_CACHE[key] = _BucketListCacheEntry(
                endpoint_id=key.endpoint_id,
                expires_at=expires_at,
                listing=listing,
            )
            _BUCKET_LIST_CACHE.move_to_end(key)
            prune_expired_lru_cache(
                _BUCKET_LIST_CACHE,
                now=monotonic(),
                max_entries=BUCKET_LIST_CACHE_MAX_ENTRIES,
            )
        in_flight.set_result(listing)
        return listing
    except Exception as exc:
        in_flight.set_exception(exc)
        raise
    finally:
        with _BUCKET_LIST_CACHE_LOCK:
            if _BUCKET_LIST_INFLIGHT.get(key) is in_flight:
                _BUCKET_LIST_INFLIGHT.pop(key, None)


def _invalidate_bucket_listing_cache(endpoint_id: int) -> None:
    with _BUCKET_LIST_CACHE_LOCK:
        invalid_keys = [key for key, entry in _BUCKET_LIST_CACHE.items() if entry.endpoint_id == endpoint_id]
        for key in invalid_keys:
            _BUCKET_LIST_CACHE.pop(key, None)
    with _RGW_BUCKET_PAYLOAD_CACHE_LOCK:
        invalid_keys = [key for key, entry in _RGW_BUCKET_PAYLOAD_CACHE.items() if entry.endpoint_id == endpoint_id]
        for key in invalid_keys:
            _RGW_BUCKET_PAYLOAD_CACHE.pop(key, None)
