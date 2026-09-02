# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Literal

from app.models.bucket_listing import BucketListingSummary
from app.utils.normalize import normalize_optional_scalar
from app.utils.rgw_identifiers import is_rgw_account_id
from app.utils.usage_stats import extract_usage_stats


def split_tenant_uid(value: str) -> tuple[str | None, str]:
    if "$" in value:
        tenant, uid = value.split("$", 1)
        return (tenant.strip() or None), uid.strip()
    return None, value.strip()


def owner_kind_from_owner(owner_id: str | None) -> Literal["account", "user"] | None:
    if not owner_id:
        return None
    return "account" if is_rgw_account_id(owner_id) else "user"


def extract_bucket_owner_scope(entry: dict) -> tuple[str | None, str | None]:
    if not isinstance(entry, dict):
        return None, None
    tenant = normalize_optional_scalar(entry.get("tenant"))
    owner = normalize_optional_scalar(entry.get("owner"))
    if owner and "$" in owner:
        split_tenant, split_uid = split_tenant_uid(owner)
        if split_tenant:
            tenant = split_tenant
        owner = split_uid or None
    return tenant, owner


def resolve_bucket_owner_identity(entry: dict) -> tuple[str | None, str | None]:
    tenant, owner = extract_bucket_owner_scope(entry)
    if not owner:
        return None, None
    if is_rgw_account_id(owner):
        return owner, None
    if tenant:
        return None, f"{tenant}${owner}"
    return None, owner


def build_bucket_summary(entry: dict) -> BucketListingSummary | None:
    if not isinstance(entry, dict):
        return None
    bucket_name = extract_bucket_name(entry)
    if not bucket_name:
        return None
    tenant = normalize_optional_scalar(entry.get("tenant"))
    owner = normalize_optional_scalar(entry.get("owner"))
    usage_bytes, objects = extract_usage_stats(entry.get("usage"))
    quota_size = None
    quota_objects = None
    quota = entry.get("bucket_quota") or entry.get("quota")
    if isinstance(quota, dict):
        try:
            # RGW may return both max_size (bytes) and max_size_kb (KiB).
            # max_size has priority and must not be scaled again.
            if quota.get("max_size") is not None:
                quota_size = int(quota.get("max_size"))
            elif quota.get("max_size_kb") is not None:
                quota_size = int(quota.get("max_size_kb")) * 1024
        except (TypeError, ValueError):
            quota_size = None
        try:
            if quota.get("max_objects") is not None:
                quota_objects = int(quota.get("max_objects"))
        except (TypeError, ValueError):
            quota_objects = None
    return BucketListingSummary(
        name=bucket_name,
        tenant=tenant,
        tenant_metadata_resolved="tenant" in entry and entry.get("tenant") is not None,
        owner=owner,
        used_bytes=usage_bytes,
        object_count=objects,
        quota_max_size_bytes=quota_size,
        quota_max_objects=quota_objects,
    )


def extract_bucket_name(entry: dict) -> str | None:
    if not isinstance(entry, dict):
        return None
    name = entry.get("name")
    if not name and isinstance(entry.get("bucket"), str):
        name = entry.get("bucket")
    bucket_name = str(name or "").strip()
    return bucket_name or None
