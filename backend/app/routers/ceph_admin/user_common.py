# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Shared Ceph Admin RGW user payload helpers."""

from typing import Any, Optional

from fastapi import HTTPException, status

from app.models.ceph_admin import CephAdminRgwAccessKey
from app.routers.ceph_admin.dependencies import CephAdminContext
from app.services.rgw_admin import RGWAdminError
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.normalize import normalize_optional_scalar
from app.utils.storage_endpoint_features import resolve_feature_flags


def split_tenant_uid(value: str) -> tuple[Optional[str], str]:
    raw = value.strip()
    if "$" in raw:
        tenant, uid = raw.split("$", 1)
        if tenant and uid:
            return tenant, uid
    return None, raw


def optional_account_lookup_enabled(ctx: CephAdminContext) -> bool | None:
    try:
        return resolve_feature_flags(ctx.endpoint).account_enabled
    except Exception:
        return None


def parse_suspended(raw: Any) -> Optional[bool]:
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)):
        return bool(raw)
    if isinstance(raw, str):
        normalized = raw.strip().lower()
        if normalized in {"true", "1", "yes", "suspended", "enabled"}:
            return True
        if normalized in {"false", "0", "no", "disabled", "active"}:
            return False
    return None


def coerce_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "y", "on", "enabled", "suspended"}:
            return True
        if normalized in {"false", "0", "no", "n", "off", "disabled", "active"}:
            return False
    return None


def extract_access_key(payload: dict) -> tuple[Optional[str], Optional[str]]:
    return payload.get("access_key"), payload.get("secret_key")


def serialize_access_keys(entries: list[dict]) -> list[CephAdminRgwAccessKey]:
    results: list[CephAdminRgwAccessKey] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        access_key_value = entry.get("access_key") or entry.get("access_key_id")
        access_key = normalize_optional_scalar(access_key_value)
        if not access_key or access_key in seen:
            continue
        seen.add(access_key)
        status_text, is_active = _parse_key_status(
            entry.get("status") or entry.get("key_status") or entry.get("state")
        )
        results.append(
            CephAdminRgwAccessKey(
                access_key=access_key,
                secret_key=normalize_optional_scalar(entry.get("secret_key")),
                status=status_text,
                is_active=is_active,
                created_at=entry.get("create_date") or entry.get("created_at"),
                user=normalize_optional_scalar(entry.get("user") or entry.get("uid")),
                subuser=normalize_optional_scalar(entry.get("subuser")),
            )
        )
    return results


def load_user_payload(uid: str, tenant: Optional[str], ctx: CephAdminContext) -> dict[str, Any]:
    normalized_uid = uid.strip()
    if not normalized_uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="uid is required")
    try:
        payload = ctx.rgw_admin.get_user(normalized_uid, tenant=tenant, allow_not_found=True)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    if not payload or (isinstance(payload, dict) and payload.get("not_found")):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RGW user not found")
    if not isinstance(payload, dict):
        return {"payload": payload}
    return payload


def _parse_key_status(status_value: Any) -> tuple[Optional[str], Optional[bool]]:
    if status_value is None:
        return None, None
    status_text = str(status_value).strip()
    if not status_text:
        return None, None
    normalized = status_text.lower()
    if normalized in {"enabled", "active", "true", "1"}:
        return status_text, True
    if normalized in {"disabled", "inactive", "suspended", "false", "0"}:
        return status_text, False
    return status_text, None
