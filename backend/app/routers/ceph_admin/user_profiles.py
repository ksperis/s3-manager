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
from app.routers.ceph_admin.profile_common import nullable_update, raise_if_unsupported
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
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.normalize import normalize_optional_scalar
from app.utils.quota_stats import extract_quota_limits
from app.utils.rgw_payloads import extract_bucket_list, extract_rgw_user_payload
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.usage_stats import summarize_bucket_usage

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/users", tags=["ceph-admin-users"])
router.include_router(user_keys.router)

USER_UPDATE_FIELDS = (
    "display_name",
    "email",
    "suspended",
    "max_buckets",
    "op_mask",
    "admin",
    "system",
    "account_root",
)
USER_UPDATE_FIELD_SET = frozenset(USER_UPDATE_FIELDS)
USER_UPDATE_CLEAR_VALUES: dict[str, Any] = {
    "display_name": "",
    "email": "",
    "max_buckets": 0,
    "op_mask": "",
}
USER_QUOTA_FIELDS = frozenset({"quota_enabled", "quota_max_size_bytes", "quota_max_objects"})


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


def _load_user_detail(uid: str, tenant: Optional[str], ctx: CephAdminContext) -> CephAdminRgwUserDetail:
    payload = load_user_payload(uid, tenant, ctx)
    user_values = extract_rgw_user_payload(payload)
    account_id = normalize_optional_scalar(payload.get("account_id") or user_values.get("account_id"))
    account_name = _resolve_account_name(
        account_id,
        ctx,
        payload_account_name=normalize_optional_scalar(payload.get("account_name") or user_values.get("account_name")),
    )
    return _build_user_detail(
        payload,
        uid_fallback=uid,
        tenant_fallback=tenant,
        account_name=account_name,
        keys=serialize_access_keys(ctx.rgw_admin.list_user_keys(uid, tenant=tenant)),
    )


def _user_update_params(
    update: CephAdminRgwUserCreate | CephAdminRgwUserConfigUpdate,
    field_set: set[str],
    *,
    clear_nulls: bool,
) -> dict[str, Any]:
    if not clear_nulls:
        return {
            field: getattr(update, field) if field in field_set else None
            for field in USER_UPDATE_FIELDS
        }
    return {
        field: nullable_update(
            getattr(update, field),
            field,
            field_set,
            USER_UPDATE_CLEAR_VALUES.get(field),
        )
        for field in USER_UPDATE_FIELDS
    }


def _apply_user_update(
    uid: str,
    tenant: Optional[str],
    params: dict[str, Any],
    ctx: CephAdminContext,
) -> None:
    try:
        result = ctx.rgw_admin.update_user(uid, tenant=tenant, **params)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    raise_if_unsupported(result, "RGW user update is not supported on this cluster")


def _apply_user_quota_update(
    uid: str,
    tenant: Optional[str],
    *,
    max_size_bytes: Optional[int],
    max_objects: Optional[int],
    enabled: Optional[bool],
    ctx: CephAdminContext,
) -> None:
    try:
        result = ctx.rgw_admin.set_user_quota(
            uid,
            tenant=tenant,
            max_size_bytes=max_size_bytes,
            max_objects=max_objects,
            enabled=bool(enabled) if enabled is not None else True,
        )
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    raise_if_unsupported(result, "RGW user quota update is not supported on this cluster")


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


def _extract_generated_key_from_payload(
    raw: Any,
    rgw_admin: RGWAdminClient,
) -> Optional[CephAdminRgwGeneratedAccessKey]:
    entries = rgw_admin.extract_keys(raw)
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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tenant cannot be combined with account_id",
        )

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

    if isinstance(create_result, dict) and create_result.get("conflict"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="RGW user already exists")
    raise_if_unsupported(create_result, "RGW user creation is not supported on this cluster")

    field_set = fields_set(payload)
    if USER_UPDATE_FIELD_SET & field_set:
        _apply_user_update(
            uid,
            lookup_tenant,
            _user_update_params(payload, field_set, clear_nulls=False),
            ctx,
        )

    if payload.caps is not None:
        _apply_caps_update(uid, lookup_tenant, payload.caps.mode, payload.caps.values, ctx)

    if any(getattr(payload, field) is not None for field in USER_QUOTA_FIELDS):
        _apply_user_quota_update(
            uid,
            lookup_tenant,
            max_size_bytes=payload.quota_max_size_bytes,
            max_objects=payload.quota_max_objects,
            enabled=payload.quota_enabled,
            ctx=ctx,
        )

    invalidate_users_listing_cache(int(getattr(ctx.endpoint, "id", 0) or 0))
    detail = _load_user_detail(uid, lookup_tenant, ctx)
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
    return _load_user_detail(user_id.strip(), tenant, ctx)


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
    if USER_UPDATE_FIELD_SET & field_set or update.extra_params:
        params = _user_update_params(update, field_set, clear_nulls=True)
        params["extra_params"] = update.extra_params or None
        _apply_user_update(uid, tenant, params, ctx)

    if "caps" in field_set and update.caps is not None:
        _apply_caps_update(uid, tenant, update.caps.mode, update.caps.values, ctx)

    if USER_QUOTA_FIELDS & field_set:
        _apply_user_quota_update(
            uid,
            tenant,
            max_size_bytes=nullable_update(
                update.quota_max_size_bytes,
                "quota_max_size_bytes",
                field_set,
                0,
            ),
            max_objects=nullable_update(update.quota_max_objects, "quota_max_objects", field_set, 0),
            enabled=update.quota_enabled if "quota_enabled" in field_set else True,
            ctx=ctx,
        )

    invalidate_users_listing_cache(int(getattr(ctx.endpoint, "id", 0) or 0))
    record_ceph_admin_action(
        ctx,
        action="rgw_user.update",
        entity_type="rgw_user",
        entity_id=f"{tenant}${uid}" if tenant else uid,
        metadata={"fields": sorted(field_set)},
    )
    return _load_user_detail(uid, tenant, ctx)


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
