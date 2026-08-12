# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Caches owned by the Ceph Admin RGW account listing."""

from collections import OrderedDict
from threading import Lock
from typing import Any, Callable

from fastapi import status

from app.models.ceph_admin import CephAdminRgwAccountSummary
from app.routers.ceph_admin.dependencies import CephAdminContext
from app.routers.ceph_admin.listing_common import (
    EndpointCacheEntry,
    EndpointListCacheKey,
    EndpointPayloadCacheKey,
    get_or_set_cache,
    invalidate_cache,
)
from app.services.rgw_admin import RGWAdminError
from app.utils.http_errors import raise_http_exception_from_exception

ACCOUNTS_LIST_CACHE_TTL_SECONDS = 30.0
ACCOUNTS_LIST_CACHE_MAX_ENTRIES = 64
RGW_ACCOUNTS_PAYLOAD_CACHE_MAX_ENTRIES = 16

ACCOUNTS_LIST_CACHE: OrderedDict[EndpointListCacheKey, EndpointCacheEntry] = OrderedDict()
ACCOUNTS_LIST_CACHE_LOCK = Lock()
RGW_ACCOUNTS_PAYLOAD_CACHE: OrderedDict[EndpointPayloadCacheKey, EndpointCacheEntry] = OrderedDict()
RGW_ACCOUNTS_PAYLOAD_CACHE_LOCK = Lock()


def get_cached_rgw_accounts_payload(ctx: CephAdminContext) -> list[Any]:
    key = EndpointPayloadCacheKey(endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0))

    def fetch_payload() -> list[Any]:
        try:
            try:
                payload = ctx.rgw_admin.list_accounts(include_details=False)
            except TypeError:
                payload = ctx.rgw_admin.list_accounts()
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        return payload or []

    return get_or_set_cache(
        RGW_ACCOUNTS_PAYLOAD_CACHE,
        RGW_ACCOUNTS_PAYLOAD_CACHE_LOCK,
        key,
        ttl_seconds=ACCOUNTS_LIST_CACHE_TTL_SECONDS,
        max_entries=RGW_ACCOUNTS_PAYLOAD_CACHE_MAX_ENTRIES,
        builder=fetch_payload,
    )


def get_cached_accounts_listing(
    key: EndpointListCacheKey,
    builder: Callable[[], list[CephAdminRgwAccountSummary]],
) -> list[CephAdminRgwAccountSummary]:
    return get_or_set_cache(
        ACCOUNTS_LIST_CACHE,
        ACCOUNTS_LIST_CACHE_LOCK,
        key,
        ttl_seconds=ACCOUNTS_LIST_CACHE_TTL_SECONDS,
        max_entries=ACCOUNTS_LIST_CACHE_MAX_ENTRIES,
        builder=builder,
    )


def invalidate_accounts_listing_cache(endpoint_id: int | None = None) -> None:
    invalidate_cache(ACCOUNTS_LIST_CACHE, ACCOUNTS_LIST_CACHE_LOCK, endpoint_id=endpoint_id)
    invalidate_cache(RGW_ACCOUNTS_PAYLOAD_CACHE, RGW_ACCOUNTS_PAYLOAD_CACHE_LOCK, endpoint_id=endpoint_id)
