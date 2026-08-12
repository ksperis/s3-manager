# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Shared Ceph Admin RGW account payload helpers."""

from typing import Any, Optional

from fastapi import HTTPException, status

from app.models.ceph_admin import CephAdminRgwAccountDetail, CephAdminRgwQuotaConfig
from app.routers.ceph_admin.dependencies import CephAdminContext
from app.routers.ceph_admin.listing_common import parse_bool, parse_int
from app.services.rgw_admin import RGWAdminError
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.normalize import normalize_optional_scalar
from app.utils.quota_stats import extract_quota_limits


def extract_count(data: dict[str, Any], keys: tuple[str, ...]) -> Optional[int]:
    for key in keys:
        parsed = parse_int(data.get(key))
        if parsed is not None:
            return parsed
    return None


def extract_bucket_count(payload: dict[str, Any]) -> Optional[int]:
    direct = extract_count(payload, ("bucket_count", "num_buckets", "buckets_count"))
    if direct is not None:
        return direct
    stats = payload.get("stats")
    if isinstance(stats, dict):
        from_stats = extract_count(stats, ("bucket_count", "num_buckets", "buckets_count"))
        if from_stats is not None:
            return from_stats
    buckets = payload.get("bucket_list") or payload.get("buckets")
    return len(buckets) if isinstance(buckets, list) else None


def extract_user_count(payload: dict[str, Any]) -> Optional[int]:
    direct = extract_count(payload, ("user_count", "users_count", "num_users", "users"))
    if direct is not None:
        return direct
    stats = payload.get("stats")
    if isinstance(stats, dict):
        from_stats = extract_count(stats, ("user_count", "users_count", "num_users"))
        if from_stats is not None:
            return from_stats
    users = payload.get("user_list")
    return len(users) if isinstance(users, list) else None


def build_account_detail(payload: dict[str, Any], account_id_fallback: str) -> CephAdminRgwAccountDetail:
    account_id = normalize_optional_scalar(payload.get("id") or payload.get("account_id")) or account_id_fallback
    limits_payload = payload.get("limits") if isinstance(payload.get("limits"), dict) else {}
    quota_size, quota_objects = extract_quota_limits(payload, keys=("quota", "account_quota"))
    quota_enabled = _extract_quota_enabled(payload, keys=("quota", "account_quota"))
    quota = None
    if quota_enabled is not None or quota_size is not None or quota_objects is not None:
        quota = CephAdminRgwQuotaConfig(
            enabled=quota_enabled,
            max_size_bytes=quota_size,
            max_objects=quota_objects,
        )
    bucket_quota_size, bucket_quota_objects = extract_quota_limits(payload, keys=("bucket_quota",))
    bucket_quota_enabled = _extract_quota_enabled(payload, keys=("bucket_quota",))
    bucket_quota = None
    if bucket_quota_enabled is not None or bucket_quota_size is not None or bucket_quota_objects is not None:
        bucket_quota = CephAdminRgwQuotaConfig(
            enabled=bucket_quota_enabled,
            max_size_bytes=bucket_quota_size,
            max_objects=bucket_quota_objects,
        )
    return CephAdminRgwAccountDetail(
        account_id=account_id,
        account_name=normalize_optional_scalar(
            payload.get("name") or payload.get("account_name") or payload.get("display_name")
        ),
        email=normalize_optional_scalar(payload.get("email") or payload.get("mail")),
        max_users=parse_int(payload.get("max_users") or limits_payload.get("max_users")),
        max_buckets=parse_int(payload.get("max_buckets") or limits_payload.get("max_buckets")),
        max_roles=parse_int(payload.get("max_roles") or limits_payload.get("max_roles")),
        max_groups=parse_int(payload.get("max_groups") or limits_payload.get("max_groups")),
        max_access_keys=parse_int(payload.get("max_access_keys") or limits_payload.get("max_access_keys")),
        bucket_count=extract_bucket_count(payload),
        user_count=extract_user_count(payload),
        quota=quota,
        bucket_quota=bucket_quota,
    )


def load_account_payload(account_id: str, ctx: CephAdminContext) -> dict[str, Any]:
    normalized_account_id = account_id.strip()
    if not normalized_account_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="account_id is required")
    try:
        payload = ctx.rgw_admin.get_account(normalized_account_id, allow_not_found=True)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    if not payload or (isinstance(payload, dict) and payload.get("not_found")):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RGW account not found")
    if not isinstance(payload, dict):
        return {"payload": payload}
    return payload


def _extract_quota_enabled(
    payload: dict[str, Any],
    keys: tuple[str, ...] = ("quota", "account_quota"),
) -> Optional[bool]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, dict):
            parsed = parse_bool(value.get("enabled"))
            if parsed is not None:
                return parsed
    return None
