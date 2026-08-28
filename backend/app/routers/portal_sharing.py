# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal public-link and storage-space sharing endpoints."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.core.database import get_db
from app.core.sensitive_data import sanitize_error_detail
from app.db import User
from app.models.access_context import AccountAccess
from app.models.portal import (
    PortalPublicLink,
    PortalPublicLinkCreate,
    PortalStorageSpaceShare,
    PortalStorageSpaceShareCandidate,
    PortalStorageSpaceSharePayload,
    PortalStorageSpaceShareUpdate,
)
from app.routers.dependencies import get_audit_service, get_portal_account_access
from app.routers.portal_common import (
    get_portal_service_dependency,
    raise_portal_storage_runtime,
)
from app.services.audit_service import AuditService
from app.services.portal_service import PortalService
from app.services.users_service import UsersService, get_users_service
from app.utils.http_errors import raise_bad_gateway_from_runtime
from app.utils.http_headers import build_attachment_content_disposition

router = APIRouter()


@router.get("/storage-spaces/{space_id}/public-links", response_model=list[PortalPublicLink])
def portal_storage_space_public_links(
    space_id: str,
    object_key: Optional[str] = Query(None),
    include_revoked: bool = Query(False),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> list[PortalPublicLink]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.list_storage_space_public_links(
            actor,
            access,
            space_id,
            object_key=object_key,
            include_revoked=include_revoked,
        )
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.post("/storage-spaces/{space_id}/public-links", response_model=PortalPublicLink, status_code=status.HTTP_201_CREATED)
def create_portal_storage_space_public_link(
    space_id: str,
    payload: PortalPublicLinkCreate,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalPublicLink:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        link = service.create_storage_space_public_link(
            actor,
            access,
            space_id,
            object_key=payload.object_key,
            label=payload.label,
            expires_at=payload.expires_at,
        )
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="create_public_link",
            entity_type="object",
            entity_id=payload.object_key,
            account=access.account,
            metadata={
                "storage_space_id": space_id,
                "public_link_id": link.id,
                "expires_at": link.expires_at.isoformat() if link.expires_at else None,
            },
        )
        return link
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.delete("/storage-spaces/{space_id}/public-links/{link_id}", response_model=list[PortalPublicLink])
def revoke_portal_storage_space_public_link(
    space_id: str,
    link_id: int,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(get_portal_service_dependency),
) -> list[PortalPublicLink]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        links = service.revoke_storage_space_public_link(actor, access, space_id, link_id)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="revoke_public_link",
            entity_type="storage_space",
            entity_id=space_id,
            account=access.account,
            metadata={"storage_space_id": space_id, "public_link_id": link_id},
        )
        return links
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.get("/public-links/{token}/download")
def download_portal_public_link(
    token: str,
    service: PortalService = Depends(get_portal_service_dependency),
) -> StreamingResponse:
    try:
        stream, content_type, filename = service.download_public_link(token)
    except RuntimeError as exc:
        detail = sanitize_error_detail(str(exc))
        lowered = detail.lower()
        if "not found" in lowered:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from exc
        if "expired" in lowered or "revoked" in lowered or "archived" in lowered or "suspended" in lowered:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail=detail) from exc
        raise_bad_gateway_from_runtime(exc)
    headers = {"Content-Disposition": build_attachment_content_disposition(filename)}
    return StreamingResponse(stream, media_type=content_type or "application/octet-stream", headers=headers)


@router.get("/storage-spaces/{space_id}/shares", response_model=list[PortalStorageSpaceShare])
def portal_storage_space_shares(
    space_id: str,
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> list[PortalStorageSpaceShare]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.list_storage_space_shares(actor, access, space_id)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.get("/share-candidates", response_model=list[PortalStorageSpaceShareCandidate])
def portal_share_candidates(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> list[PortalStorageSpaceShareCandidate]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    if not access.capabilities.can_manage_portal_users:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager rights required for this account")
    try:
        return service.list_storage_space_share_candidates(actor, access)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.get("/storage-spaces/{space_id}/share-candidates", response_model=list[PortalStorageSpaceShareCandidate])
def portal_storage_space_share_candidates(
    space_id: str,
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> list[PortalStorageSpaceShareCandidate]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.list_storage_space_share_candidates(actor, access, space_id)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


def _resolve_share_target(payload: PortalStorageSpaceSharePayload, users_service: UsersService) -> User:
    target = None
    if payload.user_id is not None:
        target = users_service.get_by_id(payload.user_id)
    elif payload.email:
        target = users_service.get_by_email_case_insensitive(payload.email)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return target


@router.post("/storage-spaces/{space_id}/shares", response_model=PortalStorageSpaceShare, status_code=status.HTTP_201_CREATED)
def grant_portal_storage_space_share(
    space_id: str,
    payload: PortalStorageSpaceSharePayload,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalStorageSpaceShare:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    target = _resolve_share_target(payload, users_service)
    try:
        share = service.set_storage_space_share(actor, access, target, space_id, payload.role)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="grant_storage_space_share",
            entity_type="storage_space",
            entity_id=space_id,
            account=access.account,
            metadata={"target_user_id": target.id, "role": payload.role},
        )
        return share
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.put("/storage-spaces/{space_id}/shares/{user_id}", response_model=PortalStorageSpaceShare)
def update_portal_storage_space_share(
    space_id: str,
    user_id: int,
    payload: PortalStorageSpaceShareUpdate,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalStorageSpaceShare:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    target = users_service.get_by_id(user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    try:
        share = service.set_storage_space_share(actor, access, target, space_id, payload.role)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="update_storage_space_share",
            entity_type="storage_space",
            entity_id=space_id,
            account=access.account,
            metadata={"target_user_id": target.id, "role": payload.role},
        )
        return share
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.delete("/storage-spaces/{space_id}/shares/{user_id}", response_model=list[PortalStorageSpaceShare])
def revoke_portal_storage_space_share(
    space_id: str,
    user_id: int,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    service: PortalService = Depends(get_portal_service_dependency),
) -> list[PortalStorageSpaceShare]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    target = users_service.get_by_id(user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    try:
        shares = service.revoke_storage_space_share(actor, access, target, space_id)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="revoke_storage_space_share",
            entity_type="storage_space",
            entity_id=space_id,
            account=access.account,
            metadata={"target_user_id": target.id},
        )
        return shares
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
