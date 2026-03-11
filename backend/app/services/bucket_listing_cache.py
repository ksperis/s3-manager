# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import Future
from dataclasses import dataclass
from hashlib import sha256
from threading import Lock
from time import monotonic
from typing import Callable

from app.db import S3Account
from app.models.bucket import Bucket
from app.utils.s3_endpoint import resolve_s3_client_options

BUCKET_LISTING_CACHE_TTL_SECONDS = 30.0
BUCKET_LISTING_CACHE_MAX_ENTRIES = 512


@dataclass(frozen=True)
class BucketListingCacheKey:
    scope_key: str
    creds_key: str
    include_key: str
    with_stats: bool


@dataclass
class BucketListingCacheEntry:
    scope_key: str
    expires_at: float
    items: list[Bucket]


_BUCKET_LISTING_CACHE: OrderedDict[BucketListingCacheKey, BucketListingCacheEntry] = OrderedDict()
_BUCKET_LISTING_CACHE_LOCK = Lock()
_BUCKET_LISTING_INFLIGHT: dict[BucketListingCacheKey, Future[list[Bucket]]] = {}


def _clone_bucket(item: Bucket) -> Bucket:
    if hasattr(item, "model_copy"):
        return item.model_copy(deep=True)
    if hasattr(item, "copy"):
        return item.copy(deep=True)
    payload = item.model_dump() if hasattr(item, "model_dump") else item.dict()
    return Bucket(**payload)


def _clone_bucket_list(items: list[Bucket]) -> list[Bucket]:
    return [_clone_bucket(item) for item in items]


def _prune_bucket_listing_cache(now: float) -> None:
    expired_keys = [key for key, entry in _BUCKET_LISTING_CACHE.items() if entry.expires_at <= now]
    for key in expired_keys:
        _BUCKET_LISTING_CACHE.pop(key, None)
    while len(_BUCKET_LISTING_CACHE) > BUCKET_LISTING_CACHE_MAX_ENTRIES:
        _BUCKET_LISTING_CACHE.popitem(last=False)


def _normalize_include_key(include: set[str]) -> str:
    if not include:
        return ""
    normalized = sorted({str(item).strip() for item in include if str(item).strip()})
    return ",".join(normalized)


def _account_scope_key(account: S3Account) -> str:
    connection_id = getattr(account, "s3_connection_id", None)
    if isinstance(connection_id, int) and connection_id > 0:
        return f"conn-{connection_id}"

    s3_user_id = getattr(account, "s3_user_id", None)
    if isinstance(s3_user_id, int) and s3_user_id > 0:
        return f"s3u-{s3_user_id}"

    ceph_admin_endpoint_id = getattr(account, "ceph_admin_endpoint_id", None)
    if isinstance(ceph_admin_endpoint_id, int) and ceph_admin_endpoint_id > 0:
        return f"ceph-admin-{ceph_admin_endpoint_id}"

    account_id = getattr(account, "id", None)
    if isinstance(account_id, int) and account_id > 0:
        return str(account_id)

    rgw_account_id = str(getattr(account, "rgw_account_id", "") or "").strip()
    if rgw_account_id:
        return f"rgw:{rgw_account_id}"

    context_id = str(getattr(account, "context_id", "") or "").strip()
    if context_id:
        return f"context:{context_id}"

    fallback_name = str(getattr(account, "name", "") or "").strip()
    if fallback_name:
        return f"name:{fallback_name.lower()}"

    return "unknown"


def _account_credentials_key(account: S3Account) -> str:
    access_key = ""
    secret_key = ""
    if hasattr(account, "effective_rgw_credentials"):
        raw_access, raw_secret = account.effective_rgw_credentials()
        access_key = str(raw_access or "")
        secret_key = str(raw_secret or "")
    endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(account)
    session_token = account.session_token() if hasattr(account, "session_token") else getattr(account, "_session_token", None)
    raw = "|".join(
        [
            access_key,
            secret_key,
            str(endpoint or ""),
            str(region or ""),
            "1" if force_path_style else "0",
            "1" if verify_tls else "0",
            str(session_token or ""),
        ]
    )
    return sha256(raw.encode("utf-8")).hexdigest()


def get_cached_bucket_listing_for_account(
    *,
    account: S3Account,
    include: set[str],
    with_stats: bool,
    builder: Callable[[], list[Bucket]],
) -> list[Bucket]:
    key = BucketListingCacheKey(
        scope_key=_account_scope_key(account),
        creds_key=_account_credentials_key(account),
        include_key=_normalize_include_key(include),
        with_stats=bool(with_stats),
    )
    now = monotonic()
    is_owner = False
    in_flight: Future[list[Bucket]] | None = None
    with _BUCKET_LISTING_CACHE_LOCK:
        _prune_bucket_listing_cache(now)
        cached = _BUCKET_LISTING_CACHE.get(key)
        if cached is not None:
            _BUCKET_LISTING_CACHE.move_to_end(key)
            return _clone_bucket_list(cached.items)
        in_flight = _BUCKET_LISTING_INFLIGHT.get(key)
        if in_flight is None:
            in_flight = Future()
            _BUCKET_LISTING_INFLIGHT[key] = in_flight
            is_owner = True

    if not is_owner:
        return _clone_bucket_list(in_flight.result())

    try:
        items = builder()
        cached_items = _clone_bucket_list(items)
        expires_at = monotonic() + BUCKET_LISTING_CACHE_TTL_SECONDS
        with _BUCKET_LISTING_CACHE_LOCK:
            _prune_bucket_listing_cache(monotonic())
            _BUCKET_LISTING_CACHE[key] = BucketListingCacheEntry(
                scope_key=key.scope_key,
                expires_at=expires_at,
                items=cached_items,
            )
            _BUCKET_LISTING_CACHE.move_to_end(key)
            _prune_bucket_listing_cache(monotonic())
        in_flight.set_result(cached_items)
        return _clone_bucket_list(cached_items)
    except Exception as exc:
        in_flight.set_exception(exc)
        raise
    finally:
        with _BUCKET_LISTING_CACHE_LOCK:
            if _BUCKET_LISTING_INFLIGHT.get(key) is in_flight:
                _BUCKET_LISTING_INFLIGHT.pop(key, None)


def invalidate_bucket_listing_cache(scope_key: str | None = None) -> None:
    with _BUCKET_LISTING_CACHE_LOCK:
        if scope_key is None:
            _BUCKET_LISTING_CACHE.clear()
            return
        invalid_keys = [key for key in _BUCKET_LISTING_CACHE.keys() if key.scope_key == scope_key]
        for key in invalid_keys:
            _BUCKET_LISTING_CACHE.pop(key, None)


def invalidate_bucket_listing_cache_for_account(account: S3Account) -> None:
    invalidate_bucket_listing_cache(_account_scope_key(account))
