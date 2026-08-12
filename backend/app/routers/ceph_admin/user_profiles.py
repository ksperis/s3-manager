# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Ceph Admin RGW user creation, profile, configuration, and metrics routes."""

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status

from app.models.ceph_admin import (
    CephAdminEntityMetrics,
    CephAdminRgwAccessKey,
    CephAdminRgwGeneratedAccessKey,
    CephAdminRgwQuotaConfig,
    CephAdminRgwUserConfigUpdate,
    CephAdminRgwUserCreate,
    CephAdminRgwUserCreateResponse,
    CephAdminRgwUserDetail,
)
from app.routers.ceph_admin import user_keys
from app.routers.ceph_admin.audit import record_ceph_admin_action
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.routers.ceph_admin.listing_common import fields_set, parse_int
from app.routers.ceph_admin.user_common import (
    coerce_bool,
    extract_access_key,
    load_user_payload,
    optional_account_lookup_enabled,
    parse_suspended,
    serialize_access_keys,
    split_tenant_uid,
)
from app.routers.ceph_admin.user_listing_cache import invalidate_users_listing_cache
from app.services.rgw_admin import RGWAdminError
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.normalize import normalize_optional_scalar
from app.utils.quota_stats import extract_quota_limits
from app.utils.rgw_payloads import extract_bucket_list, extract_rgw_user_payload
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.usage_stats import summarize_bucket_usage

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/users", tags=["ceph-admin-users"])
router.include_router(user_keys.router)


def _extract_user_setting(payload: dict[str, Any], user_payload: dict[str, Any], *keys: str) -> Optional[str]:
    for key in keys:
        value = normalize_optional_scalar(user_payload.get(key))
        if value is not None:
            return value
        value = normalize_optional_scalar(payload.get(key))
        if value is not None:
            return value
    return None


def _extract_quota_enabled(payload: dict[str, Any], keys: tuple[str, ...] = ("user_quota", "quota")) -> Optional[bool]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, dict):
            parsed = coerce_bool(value.get("enabled"))
            if parsed is not None:
                return parsed
    return None


def _extract_caps(payload: dict[str, Any]) -> list[str]:
    values = payload.get("caps")
    if values is None and isinstance(payload.get("user"), dict):
        values = payload["user"].get("caps")
    result: list[str] = []
    if isinstance(values, dict):
        for key, value in values.items():
            key_value = normalize_optional_scalar(key)
            perm_value = normalize_optional_scalar(value)
            if key_value and perm_value:
                result.append(f"{key_value}={perm_value}")
    elif isinstance(values, list):
        for entry in values:
            if isinstance(entry, dict):
                cap_type = normalize_optional_scalar(entry.get("type"))
                perm = normalize_optional_scalar(entry.get("perm"))
                if cap_type and perm:
                    result.append(f"{cap_type}={perm}")
                elif cap_type:
                    result.append(cap_type)
            elif isinstance(entry, str):
                cleaned = entry.strip()
                if cleaned:
                    result.append(cleaned)
    elif isinstance(values, str):
        cleaned = values.strip()
        if cleaned:
            result.append(cleaned)
    return list(dict.fromkeys(result))


def _resolve_user_identity(
    payload: dict[str, Any],
    *,
    uid_fallback: str,
    tenant_fallback: Optional[str],
) -> tuple[Optional[str], str]:
    user_payload = extract_rgw_user_payload(payload)
    uid_raw = normalize_optional_scalar(user_payload.get("uid") or payload.get("uid")) or uid_fallback
    tenant = tenant_fallback
    uid = uid_raw
    if "$" in uid_raw:
        tenant, uid = split_tenant_uid(uid_raw)
    return tenant, uid


def _build_user_detail(
    payload: dict[str, Any],
    *,
    uid_fallback: str,
    tenant_fallback: Optional[str],
    account_name: Optional[str] = None,
    keys: Optional[list[CephAdminRgwAccessKey]] = None,
) -> CephAdminRgwUserDetail:
    user_payload = extract_rgw_user_payload(payload)
    tenant, uid = _resolve_user_identity(payload, uid_fallback=uid_fallback, tenant_fallback=tenant_fallback)
    account_id = normalize_optional_scalar(payload.get("account_id") or user_payload.get("account_id"))
    quota_size, quota_objects = extract_quota_limits(payload, keys=("user_quota", "quota"))
    quota_enabled = _extract_quota_enabled(payload)
    quota = None
    if quota_enabled is not None or quota_size is not None or quota_objects is not None:
        quota = CephAdminRgwQuotaConfig(
            enabled=quota_enabled,
            max_size_bytes=quota_size,
            max_objects=quota_objects,
        )
    return CephAdminRgwUserDetail(
        uid=uid,
        tenant=tenant,
        display_name=normalize_optional_scalar(user_payload.get("display_name") or payload.get("display_name")),
        email=normalize_optional_scalar(user_payload.get("email") or payload.get("email")),
        account_id=account_id,
        account_name=account_name,
        suspended=parse_suspended(user_payload.get("suspended") or payload.get("suspended")),
        admin=coerce_bool(user_payload.get("admin") if "admin" in user_payload else payload.get("admin")),
        system=coerce_bool(user_payload.get("system") if "system" in user_payload else payload.get("system")),
        account_root=coerce_bool(user_payload.get("account_root") or payload.get("account_root")),
        max_buckets=parse_int(user_payload.get("max_buckets") or payload.get("max_buckets")),
        op_mask=normalize_optional_scalar(user_payload.get("op_mask") or payload.get("op_mask")),
        default_placement=_extract_user_setting(
            payload,
            user_payload,
            "default_placement",
            "default_placement_rule",
        ),
        default_storage_class=_extract_user_setting(payload, user_payload, "default_storage_class"),
        caps=_extract_caps(payload),
        quota=quota,
        keys=keys or [],
    )


def _resolve_account_name(
    account_id: Optional[str],
    ctx: CephAdminContext,
    *,
    payload_account_name: Optional[str] = None,
) -> Optional[str]:
    if not account_id or optional_account_lookup_enabled(ctx) is False:
        return payload_account_name
    try:
        account_payload = ctx.rgw_admin.get_account(
            account_id,
            allow_not_found=True,
            allow_not_implemented=True,
        )
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    if not isinstance(account_payload, dict) or account_payload.get("not_found"):
        return payload_account_name
    return normalize_optional_scalar(
        account_payload.get("name") or account_payload.get("display_name") or account_payload.get("account_name")
    ) or payload_account_name


def _extract_generated_key_from_payload(raw: Any, rgw_admin: Any) -> Optional[CephAdminRgwGeneratedAccessKey]:
    entries = rgw_admin._extract_keys(raw) if hasattr(rgw_admin, "_extract_keys") else []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        access_key, secret_key = extract_access_key(entry)
        if access_key and secret_key:
            return CephAdminRgwGeneratedAccessKey(access_key=access_key, secret_key=secret_key)
    return None


def _apply_caps_update(
    uid: str,
    tenant: Optional[str],
    mode: str,
    values: list[str],
    ctx: CephAdminContext,
) -> None:
    caps_values = list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))
    try:
        existing_caps = _extract_caps(load_user_payload(uid, tenant, ctx))
        if mode == "replace":
            if existing_caps:
                ctx.rgw_admin.set_user_caps(uid, existing_caps, tenant=tenant, op="rm")
            if caps_values:
                ctx.rgw_admin.set_user_caps(uid, caps_values, tenant=tenant, op="add")
        elif mode == "add":
            if caps_values:
                ctx.rgw_admin.set_user_caps(uid, caps_values, tenant=tenant, op="add")
        elif caps_values:
            ctx.rgw_admin.set_user_caps(uid, caps_values, tenant=tenant, op="rm")
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.post("", response_model=CephAdminRgwUserCreateResponse, status_code=status.HTTP_201_CREATED)
def create_rgw_user(
    payload: CephAdminRgwUserCreate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwUserCreateResponse:
    uid = payload.uid.strip()
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="uid is required")
    tenant = payload.tenant.strip() if isinstance(payload.tenant, str) else None
    tenant = tenant or None
    account_id = payload.account_id.strip() if isinstance(payload.account_id, str) else None
    account_id = account_id or None
    if account_id and tenant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tenant cannot be combined with account_id")

    try:
        if account_id:
            create_result = ctx.rgw_admin.create_user_with_account_id(
                uid=uid,
                account_id=account_id,
                display_name=payload.display_name or uid,
                account_root=bool(payload.account_root) if payload.account_root is not None else False,
                email=payload.email,
                generate_key=bool(payload.generate_key),
                extra_params=payload.extra_params or None,
            )
            lookup_tenant: Optional[str] = None
        else:
            create_result = ctx.rgw_admin.create_user(
                uid=uid,
                display_name=payload.display_name or uid,
                email=payload.email,
                tenant=tenant,
                generate_key=bool(payload.generate_key),
                extra_params=payload.extra_params or None,
            )
            lookup_tenant = tenant
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)

    if isinstance(create_result, dict):
        if create_result.get("conflict"):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="RGW user already exists")
        if create_result.get("not_found") or create_result.get("not_implemented"):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="RGW user creation is not supported on this cluster",
            )

    field_set = fields_set(payload)
    should_update_user = bool(
        {"display_name", "email", "suspended", "max_buckets", "op_mask", "admin", "system", "account_root"}
        & field_set
    )
    if should_update_user:
        try:
            update_result = ctx.rgw_admin.update_user(
                uid,
                tenant=lookup_tenant,
                display_name=payload.display_name if "display_name" in field_set else None,
                email=payload.email if "email" in field_set else None,
                suspended=payload.suspended if "suspended" in field_set else None,
                max_buckets=payload.max_buckets if "max_buckets" in field_set else None,
                op_mask=payload.op_mask if "op_mask" in field_set else None,
                admin=payload.admin if "admin" in field_set else None,
                system=payload.system if "system" in field_set else None,
                account_root=payload.account_root if "account_root" in field_set else None,
            )
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        if isinstance(update_result, dict) and (update_result.get("not_found") or update_result.get("not_implemented")):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="RGW user update is not supported on this cluster",
            )

    if payload.caps is not None:
        _apply_caps_update(uid, lookup_tenant, payload.caps.mode, payload.caps.values, ctx)

    if payload.quota_enabled is not None or payload.quota_max_size_bytes is not None or payload.quota_max_objects is not None:
        try:
            quota_result = ctx.rgw_admin.set_user_quota(
                uid,
                tenant=lookup_tenant,
                max_size_bytes=payload.quota_max_size_bytes,
                max_objects=payload.quota_max_objects,
                enabled=bool(payload.quota_enabled) if payload.quota_enabled is not None else True,
            )
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        if isinstance(quota_result, dict) and (quota_result.get("not_found") or quota_result.get("not_implemented")):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="RGW user quota update is not supported on this cluster",
            )

    invalidate_users_listing_cache(int(getattr(ctx.endpoint, "id", 0) or 0))
    user_payload = load_user_payload(uid, lookup_tenant, ctx)
    user_values = extract_rgw_user_payload(user_payload)
    resolved_account_id = normalize_optional_scalar(user_payload.get("account_id") or user_values.get("account_id"))
    account_name = _resolve_account_name(
        resolved_account_id,
        ctx,
        payload_account_name=normalize_optional_scalar(
            user_payload.get("account_name") or user_values.get("account_name")
        ),
    )
    detail = _build_user_detail(
        user_payload,
        uid_fallback=uid,
        tenant_fallback=lookup_tenant,
        account_name=account_name,
        keys=serialize_access_keys(ctx.rgw_admin.list_user_keys(uid, tenant=lookup_tenant)),
    )
    generated_key = _extract_generated_key_from_payload(create_result, ctx.rgw_admin)
    record_ceph_admin_action(
        ctx,
        action="rgw_user.create",
        entity_type="rgw_user",
        entity_id=f"{lookup_tenant}${uid}" if lookup_tenant else uid,
        metadata={
            "account_id": account_id,
            "tenant": lookup_tenant,
            "generate_key": bool(payload.generate_key),
            "fields": sorted(field_set),
        },
    )
    return CephAdminRgwUserCreateResponse(detail=detail, generated_key=generated_key)


@router.get("/{user_id}")
def get_rgw_user(
    user_id: str,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> dict[str, Any]:
    return load_user_payload(user_id, tenant, ctx)


@router.get("/{user_id}/detail", response_model=CephAdminRgwUserDetail)
def get_rgw_user_detail(
    user_id: str,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwUserDetail:
    payload = load_user_payload(user_id, tenant, ctx)
    user_values = extract_rgw_user_payload(payload)
    account_id = normalize_optional_scalar(payload.get("account_id") or user_values.get("account_id"))
    account_name = _resolve_account_name(
        account_id,
        ctx,
        payload_account_name=normalize_optional_scalar(payload.get("account_name") or user_values.get("account_name")),
    )
    return _build_user_detail(
        payload,
        uid_fallback=user_id.strip(),
        tenant_fallback=tenant,
        account_name=account_name,
        keys=serialize_access_keys(ctx.rgw_admin.list_user_keys(user_id.strip(), tenant=tenant)),
    )


@router.put("/{user_id}/config", response_model=CephAdminRgwUserDetail)
def update_rgw_user_config(
    user_id: str,
    update: CephAdminRgwUserConfigUpdate,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwUserDetail:
    uid = user_id.strip()
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="uid is required")
    field_set = fields_set(update)
    should_update_user = bool(
        {"display_name", "email", "suspended", "max_buckets", "op_mask", "admin", "system", "account_root"}
        & field_set
    ) or bool(update.extra_params)
    if should_update_user:
        try:
            update_result = ctx.rgw_admin.update_user(
                uid,
                tenant=tenant,
                display_name=(
                    update.display_name
                    if "display_name" in field_set and update.display_name is not None
                    else ("" if "display_name" in field_set else None)
                ),
                email=(
                    update.email
                    if "email" in field_set and update.email is not None
                    else ("" if "email" in field_set else None)
                ),
                suspended=update.suspended if "suspended" in field_set else None,
                max_buckets=(
                    update.max_buckets
                    if "max_buckets" in field_set and update.max_buckets is not None
                    else (0 if "max_buckets" in field_set else None)
                ),
                op_mask=(
                    update.op_mask
                    if "op_mask" in field_set and update.op_mask is not None
                    else ("" if "op_mask" in field_set else None)
                ),
                admin=update.admin if "admin" in field_set else None,
                system=update.system if "system" in field_set else None,
                account_root=update.account_root if "account_root" in field_set else None,
                extra_params=update.extra_params or None,
            )
            if isinstance(update_result, dict) and (
                update_result.get("not_found") or update_result.get("not_implemented")
            ):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="RGW user update is not supported on this cluster",
                )
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)

    if "caps" in field_set and update.caps is not None:
        _apply_caps_update(uid, tenant, update.caps.mode, update.caps.values, ctx)

    if {"quota_enabled", "quota_max_size_bytes", "quota_max_objects"} & field_set:
        enabled = update.quota_enabled if "quota_enabled" in field_set else True
        max_size_bytes = (
            update.quota_max_size_bytes
            if "quota_max_size_bytes" in field_set and update.quota_max_size_bytes is not None
            else (0 if "quota_max_size_bytes" in field_set else None)
        )
        max_objects = (
            update.quota_max_objects
            if "quota_max_objects" in field_set and update.quota_max_objects is not None
            else (0 if "quota_max_objects" in field_set else None)
        )
        try:
            quota_result = ctx.rgw_admin.set_user_quota(
                uid,
                tenant=tenant,
                max_size_bytes=max_size_bytes,
                max_objects=max_objects,
                enabled=bool(enabled) if enabled is not None else True,
            )
            if isinstance(quota_result, dict) and (
                quota_result.get("not_found") or quota_result.get("not_implemented")
            ):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="RGW user quota update is not supported on this cluster",
                )
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)

    invalidate_users_listing_cache(int(getattr(ctx.endpoint, "id", 0) or 0))
    payload = load_user_payload(uid, tenant, ctx)
    user_values = extract_rgw_user_payload(payload)
    account_id = normalize_optional_scalar(payload.get("account_id") or user_values.get("account_id"))
    account_name = _resolve_account_name(
        account_id,
        ctx,
        payload_account_name=normalize_optional_scalar(payload.get("account_name") or user_values.get("account_name")),
    )
    record_ceph_admin_action(
        ctx,
        action="rgw_user.update",
        entity_type="rgw_user",
        entity_id=f"{tenant}${uid}" if tenant else uid,
        metadata={"fields": sorted(field_set)},
    )
    return _build_user_detail(
        payload,
        uid_fallback=uid,
        tenant_fallback=tenant,
        account_name=account_name,
        keys=serialize_access_keys(ctx.rgw_admin.list_user_keys(uid, tenant=tenant)),
    )


@router.get("/{user_id}/metrics", response_model=CephAdminEntityMetrics)
def get_rgw_user_metrics(
    user_id: str,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminEntityMetrics:
    if not resolve_feature_flags(ctx.endpoint).metrics_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Storage metrics are disabled for this endpoint",
        )
    uid = user_id.strip()
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="uid is required")
    lookup_uid = f"{tenant}${uid}" if tenant else uid
    try:
        payload = ctx.rgw_admin.get_all_buckets(uid=lookup_uid, with_stats=True)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    bucket_usage, total_bytes, total_objects, bucket_count = summarize_bucket_usage(extract_bucket_list(payload))
    return CephAdminEntityMetrics(
        total_bytes=total_bytes,
        total_objects=total_objects,
        bucket_count=bucket_count,
        bucket_usage=bucket_usage,
        generated_at=datetime.now(timezone.utc).replace(microsecond=0),
    )
