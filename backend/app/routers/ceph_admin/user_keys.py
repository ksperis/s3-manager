# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Ceph Admin RGW user access-key routes."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3User
from app.models.ceph_admin import (
    CephAdminRgwAccessKey,
    CephAdminRgwAccessKeyStatusChange,
    CephAdminRgwGeneratedAccessKey,
)
from app.routers.ceph_admin.audit import record_ceph_admin_action
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.routers.ceph_admin.user_common import load_user_payload, serialize_access_keys
from app.services.managed_private_access_service import ManagedPrivateAccessService
from app.services.rgw_admin import RGWAdminError
from app.services.rgw_user_key_parser import RgwUserKeyParser
from app.utils.http_errors import raise_http_exception_from_exception

router = APIRouter()


def _managed_private_key(
    db: Session,
    ctx: CephAdminContext,
    *,
    uid: str,
    tenant: Optional[str],
    access_key: str,
):
    remote_uids = {uid}
    if tenant:
        remote_uids.add(f"{tenant}${uid}")
    sources = (
        db.query(S3User)
        .filter(
            S3User.storage_endpoint_id == ctx.endpoint.id,
            S3User.rgw_user_uid.in_(remote_uids),
        )
        .all()
    )
    managed = ManagedPrivateAccessService(db)
    for source in sources:
        provisioning = managed.managed_key("s3_user", source.id, access_key)
        if provisioning is not None:
            return provisioning
    return None


@router.get("/{user_id}/keys", response_model=list[CephAdminRgwAccessKey])
def list_rgw_user_keys(
    user_id: str,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    db: Session = Depends(get_db),
) -> list[CephAdminRgwAccessKey]:
    uid = user_id.strip()
    load_user_payload(uid, tenant, ctx)
    try:
        keys = ctx.rgw_admin.list_user_keys(uid, tenant=tenant)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    serialized = serialize_access_keys(keys)
    for key in serialized:
        provisioning = _managed_private_key(
            db,
            ctx,
            uid=uid,
            tenant=tenant,
            access_key=key.access_key,
        )
        if provisioning is not None:
            key.is_private_access_managed = True
            key.managed_connection_id = provisioning.s3_connection_id
    return serialized


@router.post("/{user_id}/keys", response_model=CephAdminRgwGeneratedAccessKey, status_code=status.HTTP_201_CREATED)
def create_rgw_user_key(
    user_id: str,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwGeneratedAccessKey:
    uid = user_id.strip()
    load_user_payload(uid, tenant, ctx)
    try:
        response = ctx.rgw_admin.create_access_key(uid, tenant=tenant)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    access_key, secret_key = RgwUserKeyParser.select_complete_credentials(
        ctx.rgw_admin.extract_keys(response)
    )
    if not access_key or not secret_key:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="RGW did not return access credentials for this key",
        )
    record_ceph_admin_action(
        ctx,
        action="rgw_user_key.create",
        entity_type="rgw_user",
        entity_id=f"{tenant}${uid}" if tenant else uid,
        metadata={"access_key_suffix": access_key[-4:]},
    )
    return CephAdminRgwGeneratedAccessKey(access_key=access_key, secret_key=secret_key)


@router.put("/{user_id}/keys/{access_key}/status", response_model=CephAdminRgwAccessKey)
def update_rgw_user_key_status(
    user_id: str,
    access_key: str,
    update: CephAdminRgwAccessKeyStatusChange,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    db: Session = Depends(get_db),
) -> CephAdminRgwAccessKey:
    uid = user_id.strip()
    normalized_key = access_key.strip()
    if not normalized_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="access_key is required")
    if _managed_private_key(db, ctx, uid=uid, tenant=tenant, access_key=normalized_key) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This key belongs to a managed private access; update or delete its private connection instead",
        )
    load_user_payload(uid, tenant, ctx)
    try:
        ctx.rgw_admin.set_access_key_status(uid, normalized_key, update.active, tenant=tenant)
        keys = ctx.rgw_admin.list_user_keys(uid, tenant=tenant)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    updated_key = next(
        (key for key in serialize_access_keys(keys) if key.access_key == normalized_key),
        CephAdminRgwAccessKey(
            access_key=normalized_key,
            status="enabled" if update.active else "suspended",
            is_active=update.active,
        ),
    )
    record_ceph_admin_action(
        ctx,
        action="rgw_user_key.update_status",
        entity_type="rgw_user",
        entity_id=f"{tenant}${uid}" if tenant else uid,
        metadata={"access_key_suffix": normalized_key[-4:], "active": update.active},
    )
    return updated_key


@router.delete("/{user_id}/keys/{access_key}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_rgw_user_key(
    user_id: str,
    access_key: str,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    db: Session = Depends(get_db),
) -> Response:
    uid = user_id.strip()
    normalized_key = access_key.strip()
    if not normalized_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="access_key is required")
    if _managed_private_key(db, ctx, uid=uid, tenant=tenant, access_key=normalized_key) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This key belongs to a managed private access; delete its private connection instead",
        )
    load_user_payload(uid, tenant, ctx)
    try:
        ctx.rgw_admin.delete_access_key(uid, normalized_key, tenant=tenant)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    record_ceph_admin_action(
        ctx,
        action="rgw_user_key.delete",
        entity_type="rgw_user",
        entity_id=f"{tenant}${uid}" if tenant else uid,
        metadata={"access_key_suffix": normalized_key[-4:]},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
