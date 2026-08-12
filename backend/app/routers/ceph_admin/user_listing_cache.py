# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Caches owned by the Ceph Admin RGW user listing."""

from collections import OrderedDict
from threading import Lock
from typing import Any, Callable

from fastapi import status

from app.models.ceph_admin import CephAdminRgwUserSummary
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

USERS_LIST_CACHE_TTL_SECONDS = 30.0
USERS_LIST_CACHE_MAX_ENTRIES = 64
RGW_USERS_PAYLOAD_CACHE_MAX_ENTRIES = 16

USERS_LIST_CACHE: OrderedDict[EndpointListCacheKey, EndpointCacheEntry] = OrderedDict()
USERS_LIST_CACHE_LOCK = Lock()
RGW_USERS_PAYLOAD_CACHE: OrderedDict[EndpointPayloadCacheKey, EndpointCacheEntry] = OrderedDict()
RGW_USERS_PAYLOAD_CACHE_LOCK = Lock()


def get_cached_rgw_users_payload(ctx: CephAdminContext) -> list[Any]:
    key = EndpointPayloadCacheKey(endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0))

    def fetch_payload() -> list[Any]:
        try:
            payload = ctx.rgw_admin.list_users()
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        return payload or []

    return get_or_set_cache(
        RGW_USERS_PAYLOAD_CACHE,
        RGW_USERS_PAYLOAD_CACHE_LOCK,
        key,
        ttl_seconds=USERS_LIST_CACHE_TTL_SECONDS,
        max_entries=RGW_USERS_PAYLOAD_CACHE_MAX_ENTRIES,
        builder=fetch_payload,
    )


def get_cached_users_listing(
    key: EndpointListCacheKey,
    builder: Callable[[], list[CephAdminRgwUserSummary]],
) -> list[CephAdminRgwUserSummary]:
    return get_or_set_cache(
        USERS_LIST_CACHE,
        USERS_LIST_CACHE_LOCK,
        key,
        ttl_seconds=USERS_LIST_CACHE_TTL_SECONDS,
        max_entries=USERS_LIST_CACHE_MAX_ENTRIES,
        builder=builder,
    )


def invalidate_users_listing_cache(endpoint_id: int | None = None) -> None:
    invalidate_cache(USERS_LIST_CACHE, USERS_LIST_CACHE_LOCK, endpoint_id=endpoint_id)
    invalidate_cache(RGW_USERS_PAYLOAD_CACHE, RGW_USERS_PAYLOAD_CACHE_LOCK, endpoint_id=endpoint_id)
