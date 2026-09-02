# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal storage-space object and history endpoints."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from app.core.sensitive_data import sanitize_error_detail
from app.db import User
from app.models.access_context import AccountAccess
from app.models.portal_objects import PortalStorageObjectDeleteResponse, PortalStorageObjectDetail
from app.models.portal_versions import (
    PortalDeletedPrefixRestoreRequest,
    PortalStorageObjectRestoreRequest,
    PortalStorageObjectRestoreResponse,
    PortalStorageObjectVersionsResponse,
    PortalStorageSpaceVersionCleanupRequest,
    PortalTrashResponse,
)
from app.routers.dependencies import get_audit_service, get_portal_account_access
from app.routers.portal_common import (
    get_portal_service_dependency,
    raise_portal_storage_runtime,
)
from app.routers.portal_streams import (
    stream_portal_deleted_prefix_restore,
    stream_portal_storage_space_version_cleanup,
)
from app.services.audit_service import AuditService
from app.services.portal_service import PortalService
from app.utils.http_headers import build_attachment_content_disposition

router = APIRouter()


@router.post("/storage-spaces/{space_id}/versions/cleanup/stream")
def portal_storage_space_version_cleanup_stream(
    request: Request,
    space_id: str,
    payload: PortalStorageSpaceVersionCleanupRequest,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(get_portal_service_dependency),
) -> StreamingResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        target = service.prepare_storage_space_version_cleanup(
            actor,
            access,
            space_id,
            confirmation=payload.confirmation,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
    return stream_portal_storage_space_version_cleanup(
        request,
        actor=actor,
        access=access,
        service=service,
        audit_service=audit_service,
        target=target,
    )


@router.get("/storage-spaces/{space_id}/objects/detail", response_model=PortalStorageObjectDetail)
def portal_storage_space_object_detail(
    space_id: str,
    key: str = Query(..., min_length=1),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalStorageObjectDetail:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.get_storage_space_object_detail(actor, access, space_id, key)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.get(
    "/storage-spaces/{space_id}/objects/versions",
    response_model=PortalStorageObjectVersionsResponse,
)
def portal_storage_space_object_versions(
    space_id: str,
    key: str = Query(..., min_length=1),
    key_marker: Optional[str] = None,
    version_id_marker: Optional[str] = None,
    max_keys: int = Query(default=1000, ge=1, le=1000),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalStorageObjectVersionsResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.get_storage_space_object_versions(
            actor,
            access,
            space_id,
            key,
            key_marker=key_marker,
            version_id_marker=version_id_marker,
            max_keys=max_keys,
        )
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.get("/storage-spaces/{space_id}/trash", response_model=PortalTrashResponse)
def portal_storage_space_trash(
    space_id: str,
    key_marker: Optional[str] = None,
    version_id_marker: Optional[str] = None,
    max_keys: int = Query(default=1000, ge=1, le=1000),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalTrashResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.list_storage_space_trash(
            actor,
            access,
            space_id,
            key_marker=key_marker,
            version_id_marker=version_id_marker,
            max_keys=max_keys,
        )
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.post(
    "/storage-spaces/{space_id}/objects/restore",
    response_model=PortalStorageObjectRestoreResponse,
)
def portal_restore_storage_space_object(
    space_id: str,
    payload: PortalStorageObjectRestoreRequest,
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalStorageObjectRestoreResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.restore_storage_space_object_version(
            actor,
            access,
            space_id,
            payload.key,
            version_id=payload.version_id,
        )
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.post("/storage-spaces/{space_id}/trash/restore-prefix/stream")
def portal_restore_deleted_prefix_stream(
    request: Request,
    space_id: str,
    payload: PortalDeletedPrefixRestoreRequest,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(get_portal_service_dependency),
) -> StreamingResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Portal endpoints require a UI user",
        )
    try:
        target = service.prepare_deleted_prefix_restore(
            actor,
            access,
            space_id,
            prefix=payload.prefix,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
    return stream_portal_deleted_prefix_restore(
        request,
        actor=actor,
        access=access,
        service=service,
        audit_service=audit_service,
        target=target,
    )


@router.delete("/storage-spaces/{space_id}/objects", response_model=PortalStorageObjectDeleteResponse)
def portal_delete_storage_space_object(
    space_id: str,
    key: str = Query(..., min_length=1),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalStorageObjectDeleteResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        deleted_key = service.delete_storage_space_object(actor, access, space_id, key)
        return PortalStorageObjectDeleteResponse(key=deleted_key, message="Deleted")
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.get("/storage-spaces/{space_id}/objects/download")
def portal_download_storage_space_object(
    space_id: str,
    key: str = Query(..., min_length=1),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> StreamingResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        stream, content_type, filename = service.download_storage_space_object(actor, access, space_id, key)
        headers = {}
        if filename:
            headers["Content-Disposition"] = build_attachment_content_disposition(filename)
        return StreamingResponse(stream, media_type=content_type or "application/octet-stream", headers=headers)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
