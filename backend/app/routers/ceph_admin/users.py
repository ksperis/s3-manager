# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import timezone
from typing import Any, Optional, Tuple
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.ceph_admin import (
    CephAdminAssumeUserResponse,
    CephAdminRgwUserSummary,
    PaginatedCephAdminUsersResponse,
)
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.routers.dependencies import get_audit_logger, get_current_ceph_admin
from app.services.audit_service import AuditService
from app.services.rgw_admin import RGWAdminError
from app.services.s3_connections_service import S3ConnectionsService
from app.services.sts_service import get_session_token
from app.utils.quota_stats import extract_quota_limits
from app.utils.storage_endpoint_features import resolve_feature_flags, resolve_sts_endpoint

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/users", tags=["ceph-admin-users"])

STS_ASSUME_DURATION_SECONDS = 3600


def _split_tenant_uid(value: str) -> Tuple[Optional[str], str]:
    raw = value.strip()
    if "$" in raw:
        tenant, uid = raw.split("$", 1)
        if tenant and uid:
            return tenant, uid
    return None, raw


def _extract_access_key(payload: dict) -> tuple[Optional[str], Optional[str]]:
    access_key = payload.get("access_key") or payload.get("access-key")
    secret_key = payload.get("secret_key") or payload.get("secret-key")
    return access_key, secret_key


def _parse_includes(include: list[str]) -> set[str]:
    include_set: set[str] = set()
    for item in include:
        if not isinstance(item, str):
            continue
        for part in item.split(","):
            normalized = part.strip()
            if normalized:
                include_set.add(normalized)
    return include_set


def _normalize_optional_str(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _extract_user_payload(raw: dict) -> dict:
    if not isinstance(raw, dict):
        return {}
    user_payload = raw.get("user")
    if isinstance(user_payload, dict):
        return user_payload
    return raw


def _parse_suspended(raw: Any) -> Optional[bool]:
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


def _parse_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        try:
            return int(float(cleaned))
        except ValueError:
            return None
    return None


@router.get("", response_model=PaginatedCephAdminUsersResponse)
def list_rgw_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: str | None = Query(None),
    sort_by: str = Query("uid"),
    sort_dir: str = Query("asc"),
    include: list[str] = Query(default=[]),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> PaginatedCephAdminUsersResponse:
    try:
        payload = ctx.rgw_admin.list_users()
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    results: list[CephAdminRgwUserSummary] = []
    for entry in payload or []:
        uid_value = None
        if isinstance(entry, dict):
            uid_value = entry.get("user") or entry.get("uid") or entry.get("id")
        else:
            uid_value = entry
        uid = str(uid_value or "").strip()
        if not uid:
            continue
        tenant, user_uid = _split_tenant_uid(uid)
        results.append(CephAdminRgwUserSummary(uid=user_uid if tenant else uid, tenant=tenant))

    search_value = search.strip().lower() if isinstance(search, str) else ""
    if search_value:
        results = [
            item
            for item in results
            if search_value in item.uid.lower()
            or search_value in (item.tenant or "").lower()
        ]

    def sort_key(item: CephAdminRgwUserSummary):
        if sort_by == "tenant":
            return ((item.tenant or "").lower(), item.uid.lower())
        return (item.uid.lower(), (item.tenant or "").lower())

    results.sort(key=sort_key, reverse=sort_dir == "desc")

    total = len(results)
    start = max(page - 1, 0) * page_size
    end = start + page_size
    page_items = results[start:end]
    has_next = end < total
    include_set = _parse_includes(include)
    requested = include_set & {"account", "profile", "status", "limits", "quota"}
    if requested and page_items:
        account_name_by_id: dict[str, Optional[str]] = {}
        for item in page_items:
            try:
                payload = ctx.rgw_admin.get_user(item.uid, tenant=item.tenant, allow_not_found=True)
            except RGWAdminError as exc:
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
            if not payload or payload.get("not_found"):
                continue
            user_payload = _extract_user_payload(payload)
            account_id = _normalize_optional_str(payload.get("account_id") or user_payload.get("account_id"))
            item.account_id = account_id
            if "account" in requested and account_id:
                if account_id not in account_name_by_id:
                    try:
                        account_payload = ctx.rgw_admin.get_account(account_id, allow_not_found=True)
                    except RGWAdminError as exc:
                        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
                    account_name_by_id[account_id] = _normalize_optional_str(
                        account_payload.get("name") if isinstance(account_payload, dict) else None
                    )
                item.account_name = account_name_by_id.get(account_id)
            if "profile" in requested:
                item.full_name = _normalize_optional_str(
                    user_payload.get("display_name")
                    or user_payload.get("display-name")
                    or payload.get("display_name")
                    or payload.get("display-name")
                )
                item.email = _normalize_optional_str(user_payload.get("email") or payload.get("email"))
            if "status" in requested:
                item.suspended = _parse_suspended(
                    user_payload.get("suspended")
                    or user_payload.get("suspension")
                    or payload.get("suspended")
                    or payload.get("suspension")
                )
            if "limits" in requested:
                item.max_buckets = _parse_int(
                    user_payload.get("max_buckets")
                    or user_payload.get("max-buckets")
                    or payload.get("max_buckets")
                    or payload.get("max-buckets")
                )
            if "quota" in requested:
                quota_size, quota_objects = extract_quota_limits(payload, keys=("user_quota", "quota"))
                item.quota_max_size_bytes = quota_size
                item.quota_max_objects = quota_objects

    return PaginatedCephAdminUsersResponse(
        items=page_items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=has_next,
    )


@router.get("/{user_id}")
def get_rgw_user(
    user_id: str,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> dict[str, Any]:
    uid = user_id.strip()
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="uid is required")
    try:
        payload = ctx.rgw_admin.get_user(uid, tenant=tenant, allow_not_found=True)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if not payload:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RGW user not found")
    return payload if isinstance(payload, dict) else {"payload": payload}


@router.post("/{user_id}/assume", response_model=CephAdminAssumeUserResponse)
def assume_rgw_user(
    user_id: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_ceph_admin),
    audit: AuditService = Depends(get_audit_logger),
) -> CephAdminAssumeUserResponse:
    uid = user_id.strip()
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="uid is required")
    flags = resolve_feature_flags(ctx.endpoint)
    if not flags.sts_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="STS is disabled for this endpoint")
    sts_endpoint = resolve_sts_endpoint(ctx.endpoint)
    if not sts_endpoint:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="STS endpoint is not configured")
    try:
        payload = ctx.rgw_admin.get_user(uid, tenant=None, allow_not_found=True)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if not payload or payload.get("not_found"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RGW user not found")
    try:
        key_response = ctx.rgw_admin.create_access_key(uid, tenant=None)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    entries = ctx.rgw_admin._extract_keys(key_response)
    access_key = secret_key = None
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        access_key, secret_key = _extract_access_key(entry)
        if access_key and secret_key:
            break
    if not access_key or not secret_key:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="RGW did not return access credentials for this user",
        )
    session_nonce = uuid.uuid4().hex[:8]
    session_name = f"ceph-admin-{uid[:24]}-{session_nonce}"
    try:
        sts_access, sts_secret, sts_token, expiration = get_session_token(
            session_name,
            STS_ASSUME_DURATION_SECONDS,
            access_key,
            secret_key,
            endpoint=sts_endpoint,
            region=ctx.region,
            verify_tls=True,
        )
    except RuntimeError as exc:
        try:
            ctx.rgw_admin.delete_access_key(uid, access_key, tenant=None)
        except RGWAdminError:
            pass
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    if expiration.tzinfo is not None:
        expires_at = expiration.astimezone(timezone.utc).replace(tzinfo=None)
    else:
        expires_at = expiration

    service = S3ConnectionsService(db)
    name = f"Assume {uid}"
    if expires_at:
        suffix = expires_at.strftime("%Y%m%d%H%M%S")
        name = f"{name} ({suffix}-{session_nonce[:6]})"
    conn = service.create_temporary(
        owner_user_id=actor.id,
        name=name,
        storage_endpoint_id=ctx.endpoint.id,
        access_key_id=sts_access,
        secret_access_key=sts_secret,
        session_token=sts_token,
        expires_at=expires_at,
        temp_user_uid=uid,
        temp_access_key_id=access_key,
    )
    audit.record_action(
        user=actor,
        scope="ceph_admin",
        action="assume_user",
        entity_type="rgw_user",
        entity_id=uid,
        metadata={"connection_id": conn.id, "expires_at": expires_at.isoformat() if expires_at else None},
    )
    return CephAdminAssumeUserResponse(context_id=f"conn-{conn.id}", expires_at=expires_at)
