# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Ceph Admin RGW account creation, profile, configuration, and metrics routes."""

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.models.ceph_admin import (
    CephAdminEntityMetrics,
    CephAdminRgwAccountConfigUpdate,
    CephAdminRgwAccountCreate,
    CephAdminRgwAccountCreateResponse,
    CephAdminRgwAccountDetail,
)
from app.routers.ceph_admin.account_common import build_account_detail, load_account_payload
from app.routers.ceph_admin.account_listing_cache import invalidate_accounts_listing_cache
from app.routers.ceph_admin.audit import record_ceph_admin_action
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.routers.ceph_admin.listing_common import fields_set
from app.services.rgw_admin import RGWAdminError
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.normalize import normalize_optional_scalar
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.usage_stats import summarize_bucket_usage

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/accounts", tags=["ceph-admin-accounts"])


def _raise_if_unsupported(result: object, detail: str) -> None:
    if isinstance(result, dict) and (result.get("not_found") or result.get("not_implemented")):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)


@router.post("", response_model=CephAdminRgwAccountCreateResponse, status_code=status.HTTP_201_CREATED)
def create_rgw_account(
    payload: CephAdminRgwAccountCreate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwAccountCreateResponse:
    requested_account_id = payload.account_id.strip() if isinstance(payload.account_id, str) else None
    requested_account_id = requested_account_id or None
    account_name = payload.account_name.strip()
    if not account_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="account_name is required")
    try:
        create_result = ctx.rgw_admin.create_account(
            account_id=requested_account_id,
            account_name=account_name,
            email=payload.email,
            max_users=payload.max_users,
            max_buckets=payload.max_buckets,
            max_roles=payload.max_roles,
            max_groups=payload.max_groups,
            max_access_keys=payload.max_access_keys,
            extra_params=payload.extra_params or None,
        )
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    if isinstance(create_result, dict) and create_result.get("conflict"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="RGW account already exists")
    _raise_if_unsupported(create_result, "RGW account creation is not supported on this cluster")

    account_id = requested_account_id
    if isinstance(create_result, dict):
        account_id = (
            normalize_optional_scalar(create_result.get("id"))
            or normalize_optional_scalar(create_result.get("account_id"))
            or account_id
        )
        account_payload = create_result.get("account")
        if not account_id and isinstance(account_payload, dict):
            account_id = (
                normalize_optional_scalar(account_payload.get("id"))
                or normalize_optional_scalar(account_payload.get("account_id"))
            )
    if not account_id:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to determine created account id from RGW response",
        )

    account_quota_updated = (
        payload.quota_enabled is not None
        or payload.quota_max_size_bytes is not None
        or payload.quota_max_objects is not None
    )
    if account_quota_updated:
        try:
            quota_result = ctx.rgw_admin.set_account_quota(
                account_id,
                max_size_bytes=payload.quota_max_size_bytes,
                max_objects=payload.quota_max_objects,
                quota_type="account",
                enabled=bool(payload.quota_enabled) if payload.quota_enabled is not None else True,
            )
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        _raise_if_unsupported(quota_result, "RGW account quota update is not supported on this cluster")

    bucket_quota_updated = (
        payload.bucket_quota_enabled is not None
        or payload.bucket_quota_max_size_bytes is not None
        or payload.bucket_quota_max_objects is not None
    )
    if bucket_quota_updated:
        try:
            quota_result = ctx.rgw_admin.set_account_quota(
                account_id,
                max_size_bytes=payload.bucket_quota_max_size_bytes,
                max_objects=payload.bucket_quota_max_objects,
                quota_type="bucket",
                enabled=bool(payload.bucket_quota_enabled) if payload.bucket_quota_enabled is not None else True,
            )
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        _raise_if_unsupported(quota_result, "RGW bucket quota update is not supported on this cluster")

    invalidate_accounts_listing_cache(int(getattr(ctx.endpoint, "id", 0) or 0))
    account_detail = build_account_detail(load_account_payload(account_id, ctx), account_id_fallback=account_id)
    record_ceph_admin_action(
        ctx,
        action="rgw_account.create",
        entity_type="rgw_account",
        entity_id=account_id,
        metadata={
            "requested_account_id": requested_account_id,
            "quota_updated": account_quota_updated,
            "bucket_quota_updated": bucket_quota_updated,
        },
    )
    return CephAdminRgwAccountCreateResponse(account=account_detail)


@router.get("/{account_id}/detail", response_model=CephAdminRgwAccountDetail)
def get_rgw_account_detail(
    account_id: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwAccountDetail:
    return build_account_detail(load_account_payload(account_id, ctx), account_id_fallback=account_id.strip())


@router.put("/{account_id}/config", response_model=CephAdminRgwAccountDetail)
def update_rgw_account_config(
    account_id: str,
    update: CephAdminRgwAccountConfigUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwAccountDetail:
    normalized_account_id = account_id.strip()
    if not normalized_account_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="account_id is required")

    field_set = fields_set(update)
    account_fields = {
        "account_name",
        "email",
        "max_users",
        "max_buckets",
        "max_roles",
        "max_groups",
        "max_access_keys",
    }
    if account_fields & field_set or update.extra_params:
        try:
            update_result = ctx.rgw_admin.update_account(
                normalized_account_id,
                account_name=_nullable_update(update.account_name, "account_name", field_set, ""),
                email=_nullable_update(update.email, "email", field_set, ""),
                max_users=_nullable_update(update.max_users, "max_users", field_set, 0),
                max_buckets=_nullable_update(update.max_buckets, "max_buckets", field_set, 0),
                max_roles=_nullable_update(update.max_roles, "max_roles", field_set, 0),
                max_groups=_nullable_update(update.max_groups, "max_groups", field_set, 0),
                max_access_keys=_nullable_update(update.max_access_keys, "max_access_keys", field_set, 0),
                extra_params=update.extra_params or None,
            )
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        _raise_if_unsupported(update_result, "RGW account update is not supported on this cluster")

    if {"quota_enabled", "quota_max_size_bytes", "quota_max_objects"} & field_set:
        try:
            quota_result = ctx.rgw_admin.set_account_quota(
                normalized_account_id,
                max_size_bytes=_nullable_update(
                    update.quota_max_size_bytes,
                    "quota_max_size_bytes",
                    field_set,
                    0,
                ),
                max_objects=_nullable_update(update.quota_max_objects, "quota_max_objects", field_set, 0),
                enabled=bool(update.quota_enabled) if update.quota_enabled is not None else True,
            )
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        _raise_if_unsupported(quota_result, "RGW account quota update is not supported on this cluster")

    if {"bucket_quota_enabled", "bucket_quota_max_size_bytes", "bucket_quota_max_objects"} & field_set:
        try:
            quota_result = ctx.rgw_admin.set_account_quota(
                normalized_account_id,
                max_size_bytes=_nullable_update(
                    update.bucket_quota_max_size_bytes,
                    "bucket_quota_max_size_bytes",
                    field_set,
                    0,
                ),
                max_objects=_nullable_update(
                    update.bucket_quota_max_objects,
                    "bucket_quota_max_objects",
                    field_set,
                    0,
                ),
                quota_type="bucket",
                enabled=bool(update.bucket_quota_enabled) if update.bucket_quota_enabled is not None else True,
            )
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        _raise_if_unsupported(quota_result, "RGW bucket quota update is not supported on this cluster")

    invalidate_accounts_listing_cache(int(getattr(ctx.endpoint, "id", 0) or 0))
    payload = load_account_payload(normalized_account_id, ctx)
    record_ceph_admin_action(
        ctx,
        action="rgw_account.update",
        entity_type="rgw_account",
        entity_id=normalized_account_id,
        metadata={"fields": sorted(field_set)},
    )
    return build_account_detail(payload, account_id_fallback=normalized_account_id)


@router.get("/{account_id}/metrics", response_model=CephAdminEntityMetrics)
def get_rgw_account_metrics(
    account_id: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminEntityMetrics:
    if not resolve_feature_flags(ctx.endpoint).metrics_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Storage metrics are disabled for this endpoint",
        )
    normalized_account_id = account_id.strip()
    if not normalized_account_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="account_id is required")
    try:
        payload = ctx.rgw_admin.get_all_buckets(account_id=normalized_account_id, with_stats=True)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)

    bucket_usage, total_bytes, total_objects, bucket_count = summarize_bucket_usage(extract_bucket_list(payload))
    bucket_usage.sort(key=lambda item: item.get("used_bytes") or 0, reverse=True)
    return CephAdminEntityMetrics(
        total_bytes=total_bytes,
        total_objects=total_objects,
        bucket_count=bucket_count,
        bucket_usage=bucket_usage,
        generated_at=datetime.now(timezone.utc).replace(microsecond=0),
    )


@router.get("/{account_id}")
def get_rgw_account(
    account_id: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> dict[str, Any]:
    return load_account_payload(account_id, ctx)


def _nullable_update(value: Any, field: str, field_set: set[str], cleared_value: Any) -> Any:
    if field not in field_set:
        return None
    return value if value is not None else cleared_value
