# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Callable, Literal, Optional

from app.db import S3Account, StorageEndpoint, StorageProvider
from app.models.ceph_admin import CephAdminBucketSummary
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.utils.quota_stats import extract_quota_limits
from app.utils.rgw import get_supervision_credentials, is_rgw_account_id
from app.utils.storage_endpoint_features import resolve_admin_endpoint, resolve_rgw_admin_api_endpoint

OWNER_DETAILS_CACHE_TTL_SECONDS = 30.0
OWNER_ACCOUNT_LIST_CACHE_MAX_ENTRIES = 32
OWNER_ACCOUNT_DETAIL_CACHE_MAX_ENTRIES = 256
OWNER_USER_DETAIL_CACHE_MAX_ENTRIES = 512
OWNER_LOOKUP_MAX_WORKERS = 6


@dataclass(frozen=True)
class BucketOwnerIdentity:
    key: str
    tenant: str | None
    owner: str
    owner_kind: Literal["account", "user"]


@dataclass
class BucketOwnerMetadata:
    owner_name: str | None = None
    quota_max_size_bytes: int | None = None
    quota_max_objects: int | None = None


@dataclass
class BucketOwnerUsage:
    used_bytes: int | None = None
    object_count: int | None = None


@dataclass
class _CacheEntry:
    expires_at: float
    value: object


_ACCOUNT_LIST_CACHE: OrderedDict[int, _CacheEntry] = OrderedDict()
_ACCOUNT_LIST_CACHE_LOCK = Lock()
_ACCOUNT_DETAIL_CACHE: OrderedDict[tuple[int, str], _CacheEntry] = OrderedDict()
_ACCOUNT_DETAIL_CACHE_LOCK = Lock()
_ACCOUNT_DETAIL_INFLIGHT: dict[tuple[int, str], Future[object]] = {}
_USER_DETAIL_CACHE: OrderedDict[tuple[int, str | None, str], _CacheEntry] = OrderedDict()
_USER_DETAIL_CACHE_LOCK = Lock()
_USER_DETAIL_INFLIGHT: dict[tuple[int, str | None, str], Future[object]] = {}


def _normalize_optional_str(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _normalize_owner_identity(tenant: str | None, owner: str | None) -> BucketOwnerIdentity | None:
    cleaned_owner = _normalize_optional_str(owner)
    if not cleaned_owner:
        return None
    cleaned_tenant = _normalize_optional_str(tenant)
    if "$" in cleaned_owner:
        embedded_tenant, embedded_uid = cleaned_owner.split("$", 1)
        embedded_tenant = embedded_tenant.strip() or None
        embedded_uid = embedded_uid.strip()
        if embedded_tenant:
            cleaned_tenant = embedded_tenant
        cleaned_owner = embedded_uid
    owner_kind: Literal["account", "user"] = "account" if is_rgw_account_id(cleaned_owner) else "user"
    key = f"{cleaned_tenant or ''}:{cleaned_owner}"
    return BucketOwnerIdentity(
        key=key,
        tenant=cleaned_tenant,
        owner=cleaned_owner,
        owner_kind=owner_kind,
    )


def owner_identity_key(tenant: str | None, owner: str | None) -> str | None:
    identity = _normalize_owner_identity(tenant, owner)
    return identity.key if identity else None


def compute_bucket_owner_usage(
    buckets: list[CephAdminBucketSummary],
) -> dict[str, BucketOwnerUsage]:
    totals_bytes: dict[str, int] = {}
    totals_objects: dict[str, int] = {}
    has_bytes: set[str] = set()
    has_objects: set[str] = set()
    for bucket in buckets:
        identity = _normalize_owner_identity(bucket.tenant, bucket.owner)
        if identity is None:
            continue
        if bucket.used_bytes is not None:
            totals_bytes[identity.key] = totals_bytes.get(identity.key, 0) + int(bucket.used_bytes)
            has_bytes.add(identity.key)
        if bucket.object_count is not None:
            totals_objects[identity.key] = totals_objects.get(identity.key, 0) + int(bucket.object_count)
            has_objects.add(identity.key)
    results: dict[str, BucketOwnerUsage] = {}
    for key in has_bytes | has_objects:
        results[key] = BucketOwnerUsage(
            used_bytes=totals_bytes.get(key) if key in has_bytes else None,
            object_count=totals_objects.get(key) if key in has_objects else None,
        )
    return results


def apply_bucket_owner_usage_map(
    buckets: list[CephAdminBucketSummary],
    usage_by_key: dict[str, BucketOwnerUsage],
) -> list[CephAdminBucketSummary]:
    for bucket in buckets:
        owner_key = owner_identity_key(bucket.tenant, bucket.owner)
        usage = usage_by_key.get(owner_key) if owner_key else None
        bucket.owner_used_bytes = usage.used_bytes if usage else None
        bucket.owner_object_count = usage.object_count if usage else None
    return buckets


def apply_bucket_owner_usage(buckets: list[CephAdminBucketSummary]) -> list[CephAdminBucketSummary]:
    return apply_bucket_owner_usage_map(buckets, compute_bucket_owner_usage(buckets))


def _prune_cache(cache: OrderedDict[object, _CacheEntry], *, now: float, max_entries: int) -> None:
    expired = [key for key, entry in cache.items() if entry.expires_at <= now]
    for key in expired:
        cache.pop(key, None)
    while len(cache) > max_entries:
        cache.popitem(last=False)


def _cache_get(
    cache: OrderedDict[object, _CacheEntry],
    lock: Lock,
    key: object,
    *,
    max_entries: int,
) -> object | None:
    now = monotonic()
    with lock:
        _prune_cache(cache, now=now, max_entries=max_entries)
        cached = cache.get(key)
        if cached is None:
            return None
        cache.move_to_end(key)
        return cached.value


def _cache_set(
    cache: OrderedDict[object, _CacheEntry],
    lock: Lock,
    key: object,
    value: object,
    *,
    max_entries: int,
) -> object:
    expires_at = monotonic() + OWNER_DETAILS_CACHE_TTL_SECONDS
    with lock:
        _prune_cache(cache, now=monotonic(), max_entries=max_entries)
        cache[key] = _CacheEntry(expires_at=expires_at, value=value)
        cache.move_to_end(key)
        _prune_cache(cache, now=monotonic(), max_entries=max_entries)
    return value


def _get_or_set_inflight_cache(
    cache: OrderedDict[object, _CacheEntry],
    lock: Lock,
    inflight: dict[object, Future[object]],
    key: object,
    *,
    max_entries: int,
    builder: Callable[[], object],
) -> object:
    cached = _cache_get(cache, lock, key, max_entries=max_entries)
    if cached is not None:
        return cached

    is_owner = False
    future: Future[object] | None = None
    with lock:
        _prune_cache(cache, now=monotonic(), max_entries=max_entries)
        cached = cache.get(key)
        if cached is not None:
            cache.move_to_end(key)
            return cached.value
        future = inflight.get(key)
        if future is None:
            future = Future()
            inflight[key] = future
            is_owner = True

    if not is_owner:
        return future.result()

    try:
        value = builder()
        _cache_set(cache, lock, key, value, max_entries=max_entries)
        future.set_result(value)
        return value
    except Exception as exc:
        future.set_exception(exc)
        raise
    finally:
        with lock:
            if inflight.get(key) is future:
                inflight.pop(key, None)


def invalidate_bucket_owner_metadata_cache(endpoint_id: int | None = None) -> None:
    def invalidate(cache: OrderedDict[object, _CacheEntry], lock: Lock) -> None:
        with lock:
            if endpoint_id is None:
                cache.clear()
                return
            keys = [key for key in cache.keys() if isinstance(key, tuple) and key and key[0] == endpoint_id]
            if isinstance(next(iter(cache.keys()), None), int):
                keys.extend([key for key in cache.keys() if key == endpoint_id])
            for key in keys:
                cache.pop(key, None)

    invalidate(_ACCOUNT_LIST_CACHE, _ACCOUNT_LIST_CACHE_LOCK)
    invalidate(_ACCOUNT_DETAIL_CACHE, _ACCOUNT_DETAIL_CACHE_LOCK)
    invalidate(_USER_DETAIL_CACHE, _USER_DETAIL_CACHE_LOCK)


class BucketOwnerMetadataService:
    def __init__(
        self,
        *,
        endpoint_id: int,
        endpoint: StorageEndpoint | None = None,
        rgw_admin: RGWAdminClient | None = None,
        account: S3Account | None = None,
    ) -> None:
        self.endpoint_id = int(endpoint_id)
        self.endpoint = endpoint or getattr(account, "storage_endpoint", None)
        self.rgw_admin = rgw_admin
        self.account = account

    def enrich_buckets(
        self,
        buckets: list[CephAdminBucketSummary],
        *,
        include_name: bool = False,
        include_quota: bool = False,
        include_usage: bool = False,
        usage_by_key: dict[str, BucketOwnerUsage] | None = None,
    ) -> list[CephAdminBucketSummary]:
        if not buckets:
            return buckets
        if include_usage:
            apply_bucket_owner_usage_map(buckets, usage_by_key or compute_bucket_owner_usage(buckets))
        if not include_name and not include_quota:
            return buckets

        owner_targets: dict[str, BucketOwnerIdentity] = {}
        for bucket in buckets:
            identity = _normalize_owner_identity(bucket.tenant, bucket.owner)
            if identity is not None:
                owner_targets.setdefault(identity.key, identity)
        if not owner_targets:
            for bucket in buckets:
                if include_name:
                    bucket.owner_name = None
                if include_quota:
                    bucket.owner_quota_max_size_bytes = None
                    bucket.owner_quota_max_objects = None
            return buckets

        metadata_by_key: dict[str, BucketOwnerMetadata] = {}
        account_targets = [item for item in owner_targets.values() if item.owner_kind == "account"]
        user_targets = [item for item in owner_targets.values() if item.owner_kind == "user"]

        if account_targets:
            metadata_by_key.update(self._resolve_account_metadata(account_targets, include_name=include_name, include_quota=include_quota))
        if user_targets:
            metadata_by_key.update(self._resolve_user_metadata(user_targets, include_name=include_name, include_quota=include_quota))

        for bucket in buckets:
            owner_key = owner_identity_key(bucket.tenant, bucket.owner)
            metadata = metadata_by_key.get(owner_key) if owner_key else None
            if include_name:
                bucket.owner_name = metadata.owner_name if metadata else None
            if include_quota:
                bucket.owner_quota_max_size_bytes = metadata.quota_max_size_bytes if metadata else None
                bucket.owner_quota_max_objects = metadata.quota_max_objects if metadata else None
        return buckets

    def _resolve_account_metadata(
        self,
        owners: list[BucketOwnerIdentity],
        *,
        include_name: bool,
        include_quota: bool,
    ) -> dict[str, BucketOwnerMetadata]:
        metadata_by_key: dict[str, BucketOwnerMetadata] = {}
        account_listing = self._get_account_listing()
        listing_by_id: dict[str, dict] = {}
        for entry in account_listing:
            if not isinstance(entry, dict):
                continue
            account_id = _normalize_optional_str(entry.get("account_id") or entry.get("id"))
            if account_id:
                listing_by_id[account_id] = entry

        for identity in owners:
            listing_entry = listing_by_id.get(identity.owner)
            detail = listing_entry or self._get_account_detail(identity.owner)
            quota_size = quota_objects = None
            owner_name = None
            if isinstance(detail, dict):
                if include_name:
                    owner_name = _normalize_optional_str(detail.get("name") or detail.get("account_name"))
                if include_quota:
                    quota_size, quota_objects = extract_quota_limits(detail, keys=("quota", "account_quota"))
            metadata_by_key[identity.key] = BucketOwnerMetadata(
                owner_name=owner_name,
                quota_max_size_bytes=quota_size,
                quota_max_objects=quota_objects,
            )
        return metadata_by_key

    def _resolve_user_metadata(
        self,
        owners: list[BucketOwnerIdentity],
        *,
        include_name: bool,
        include_quota: bool,
    ) -> dict[str, BucketOwnerMetadata]:
        if len(owners) <= 1:
            return {owner.key: self._build_user_metadata(owner, include_name=include_name, include_quota=include_quota) for owner in owners}

        max_workers = min(OWNER_LOOKUP_MAX_WORKERS, len(owners))
        with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="bucket-owner-user") as executor:
            results = executor.map(
                lambda owner: (
                    owner.key,
                    self._build_user_metadata(owner, include_name=include_name, include_quota=include_quota),
                ),
                owners,
            )
            return dict(results)

    def _build_user_metadata(
        self,
        identity: BucketOwnerIdentity,
        *,
        include_name: bool,
        include_quota: bool,
    ) -> BucketOwnerMetadata:
        payload = self._get_user_detail(identity.owner, tenant=identity.tenant)
        if not isinstance(payload, dict):
            return BucketOwnerMetadata()
        owner_name = _normalize_optional_str(payload.get("display_name")) if include_name else None
        quota_size = quota_objects = None
        if include_quota:
            quota_size, quota_objects = extract_quota_limits(payload, keys=("user_quota", "quota"))
        return BucketOwnerMetadata(
            owner_name=owner_name,
            quota_max_size_bytes=quota_size,
            quota_max_objects=quota_objects,
        )

    def _get_account_listing(self) -> list[dict]:
        cached = _cache_get(
            _ACCOUNT_LIST_CACHE,
            _ACCOUNT_LIST_CACHE_LOCK,
            self.endpoint_id,
            max_entries=OWNER_ACCOUNT_LIST_CACHE_MAX_ENTRIES,
        )
        if isinstance(cached, list):
            return cached
        client = self._get_rgw_admin()
        if client is None:
            return []
        try:
            payload = client.list_accounts(include_details=False)
        except (RGWAdminError, TypeError):
            try:
                payload = client.list_accounts()
            except RGWAdminError:
                payload = []
        normalized = payload if isinstance(payload, list) else []
        return _cache_set(
            _ACCOUNT_LIST_CACHE,
            _ACCOUNT_LIST_CACHE_LOCK,
            self.endpoint_id,
            normalized,
            max_entries=OWNER_ACCOUNT_LIST_CACHE_MAX_ENTRIES,
        )

    def _get_account_detail(self, account_id: str) -> dict | None:
        key = (self.endpoint_id, account_id)

        def builder() -> object:
            client = self._get_rgw_admin()
            if client is None:
                return None
            try:
                payload = client.get_account(account_id, allow_not_found=True, allow_not_implemented=True)
            except RGWAdminError:
                return None
            if isinstance(payload, dict) and payload.get("not_found"):
                return None
            return payload if isinstance(payload, dict) else None

        cached = _get_or_set_inflight_cache(
            _ACCOUNT_DETAIL_CACHE,
            _ACCOUNT_DETAIL_CACHE_LOCK,
            _ACCOUNT_DETAIL_INFLIGHT,
            key,
            max_entries=OWNER_ACCOUNT_DETAIL_CACHE_MAX_ENTRIES,
            builder=builder,
        )
        return cached if isinstance(cached, dict) else None

    def _get_user_detail(self, uid: str, *, tenant: str | None) -> dict | None:
        key = (self.endpoint_id, tenant, uid)

        def builder() -> object:
            client = self._get_rgw_admin()
            if client is None:
                return None
            try:
                payload = client.get_user(uid, tenant=tenant, allow_not_found=True)
            except RGWAdminError:
                return None
            if isinstance(payload, dict) and payload.get("not_found"):
                return None
            return payload if isinstance(payload, dict) else None

        cached = _get_or_set_inflight_cache(
            _USER_DETAIL_CACHE,
            _USER_DETAIL_CACHE_LOCK,
            _USER_DETAIL_INFLIGHT,
            key,
            max_entries=OWNER_USER_DETAIL_CACHE_MAX_ENTRIES,
            builder=builder,
        )
        return cached if isinstance(cached, dict) else None

    def _get_rgw_admin(self) -> RGWAdminClient | None:
        if self.rgw_admin is not None:
            return self.rgw_admin
        endpoint = self.endpoint
        if endpoint is None:
            return None
        provider = str(getattr(endpoint, "provider", "") or "").strip().lower()
        if provider and provider != StorageProvider.CEPH.value:
            return None

        supervision_access_key = getattr(endpoint, "supervision_access_key", None)
        supervision_secret_key = getattr(endpoint, "supervision_secret_key", None)
        supervision_creds = None
        if self.account is not None:
            supervision_creds = get_supervision_credentials(self.account)
        elif supervision_access_key and supervision_secret_key:
            supervision_creds = (supervision_access_key, supervision_secret_key)
        if supervision_creds:
            access_key, secret_key = supervision_creds
            admin_endpoint = resolve_rgw_admin_api_endpoint(endpoint)
            if admin_endpoint:
                try:
                    self.rgw_admin = get_rgw_admin_client(
                        access_key=access_key,
                        secret_key=secret_key,
                        endpoint=admin_endpoint,
                        region=endpoint.region,
                        verify_tls=bool(getattr(endpoint, "verify_tls", True)),
                    )
                    return self.rgw_admin
                except RGWAdminError:
                    pass

        admin_endpoint = resolve_admin_endpoint(endpoint)
        access_key = getattr(endpoint, "admin_access_key", None)
        secret_key = getattr(endpoint, "admin_secret_key", None)
        if not admin_endpoint or not access_key or not secret_key:
            return None
        try:
            self.rgw_admin = get_rgw_admin_client(
                access_key=access_key,
                secret_key=secret_key,
                endpoint=admin_endpoint,
                region=endpoint.region,
                verify_tls=bool(getattr(endpoint, "verify_tls", True)),
            )
        except RGWAdminError:
            self.rgw_admin = None
        return self.rgw_admin
