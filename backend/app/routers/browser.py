# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""User-facing S3 browser endpoints.

These endpoints back the `/browser` surface.

They are credential-first and can be used with:
- RGW accounts (account-centric) for members with bucket permissions
- Legacy S3 users (when explicitly linked)
- User-scoped S3 connections (selector `conn-<id>`)

The endpoints reuse the existing `account_id` selector and context resolution
logic implemented in :func:`app.routers.dependencies.get_account_context`.
"""

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.db import S3Account, User
from app.models.app_settings import BrowserSettings
from app.models.browser import (
    BrowserBucket,
    BucketCorsStatus,
    CleanupObjectVersionsPayload,
    CleanupObjectVersionsResponse,
    CompleteMultipartUploadRequest,
    CopyObjectPayload,
    DeleteObjectsPayload,
    ListBrowserObjectsResponse,
    ListMultipartUploadsResponse,
    ListObjectVersionsResponse,
    ListPartsResponse,
    MultipartUploadInitRequest,
    MultipartUploadInitResponse,
    ObjectAcl,
    ObjectLegalHold,
    ObjectMetadata,
    ObjectMetadataUpdate,
    ObjectRestoreRequest,
    ObjectRetention,
    ObjectTags,
    PresignPartRequest,
    PresignPartResponse,
    PresignRequest,
    PresignedUrl,
    StsStatus,
    BrowserStsCredentials,
)
from app.routers.dependencies import get_account_context, get_audit_logger, get_current_account_user
from app.services.app_settings_service import load_app_settings
from app.services.audit_service import AuditService
from app.services.browser_service import BrowserService, get_browser_service


router = APIRouter(prefix="/browser", tags=["browser"])


class CreateFolderPayload(BaseModel):
    prefix: str


class ProxyUploadResponse(BaseModel):
    message: str
    key: str


class EnsureCorsPayload(BaseModel):
    origin: str


@router.get("/settings", response_model=BrowserSettings)
def get_browser_settings(_: User = Depends(get_current_account_user)) -> BrowserSettings:
    return load_app_settings().browser


@router.get("/buckets", response_model=list[BrowserBucket])
def list_buckets(
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_user),
) -> list[BrowserBucket]:
    try:
        return service.list_buckets(account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/objects", response_model=ListBrowserObjectsResponse)
def list_objects(
    bucket_name: str,
    prefix: str = "",
    continuation_token: Optional[str] = None,
    max_keys: int = Query(default=1000, ge=1, le=1000),
    query: Optional[str] = None,
    item_type: Optional[str] = None,
    storage_class: Optional[str] = None,
    recursive: bool = Query(default=False),
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_user),
) -> ListBrowserObjectsResponse:
    try:
        return service.list_objects(
            bucket_name,
            account,
            prefix=prefix,
            continuation_token=continuation_token,
            max_keys=max_keys,
            query=query,
            item_type=item_type,
            storage_class=storage_class,
            recursive=recursive,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/cors", response_model=BucketCorsStatus)
def get_bucket_cors(
    bucket_name: str,
    origin: Optional[str] = None,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_user),
) -> BucketCorsStatus:
    return service.get_bucket_cors_status(bucket_name, account, origin=origin)


@router.post("/buckets/{bucket_name}/cors/ensure", response_model=BucketCorsStatus)
def ensure_bucket_cors(
    bucket_name: str,
    payload: EnsureCorsPayload,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketCorsStatus:
    if not payload.origin:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing origin")
    try:
        status_result = service.ensure_bucket_cors(bucket_name, account, payload.origin)
        audit_service.record_action(
            user=current_user,
            scope="browser",
            action="ensure_bucket_cors",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={"origin": payload.origin},
        )
        return status_result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/sts", response_model=StsStatus)
def get_sts_status(
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_user),
) -> StsStatus:
    return service.check_sts(account)


@router.get("/sts/credentials", response_model=BrowserStsCredentials)
def get_sts_credentials(
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_user),
) -> BrowserStsCredentials:
    try:
        return service.get_sts_credentials(account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/versions", response_model=ListObjectVersionsResponse)
def list_versions(
    bucket_name: str,
    prefix: str = "",
    key: Optional[str] = None,
    key_marker: Optional[str] = None,
    version_id_marker: Optional[str] = None,
    max_keys: int = Query(default=1000, ge=1, le=1000),
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_user),
) -> ListObjectVersionsResponse:
    try:
        return service.list_object_versions(
            bucket_name,
            account,
            prefix=prefix,
            key=key,
            key_marker=key_marker,
            version_id_marker=version_id_marker,
            max_keys=max_keys,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/object-meta", response_model=ObjectMetadata)
def head_object(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_user),
) -> ObjectMetadata:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        return service.head_object(bucket_name, account, key, version_id=version_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/buckets/{bucket_name}/object-meta", response_model=ObjectMetadata)
def update_object_metadata(
    bucket_name: str,
    payload: ObjectMetadataUpdate,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ObjectMetadata:
    try:
        result = service.update_object_metadata(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="browser",
            action="update_object_metadata",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.key}",
            account=account,
            metadata={"version_id": payload.version_id},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/object-tags", response_model=ObjectTags)
def get_object_tags(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_user),
) -> ObjectTags:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        return service.get_object_tags(bucket_name, account, key, version_id=version_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/buckets/{bucket_name}/object-tags", response_model=ObjectTags)
def put_object_tags(
    bucket_name: str,
    payload: ObjectTags,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ObjectTags:
    try:
        result = service.put_object_tags(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="browser",
            action="put_object_tags",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.key}",
            account=account,
            metadata={"version_id": payload.version_id},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/object-acl", response_model=ObjectAcl)
def get_object_acl(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_user),
) -> ObjectAcl:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        return service.get_object_acl(bucket_name, account, key, version_id=version_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/buckets/{bucket_name}/object-acl", response_model=ObjectAcl)
def put_object_acl(
    bucket_name: str,
    payload: ObjectAcl,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ObjectAcl:
    try:
        result = service.put_object_acl(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="browser",
            action="put_object_acl",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.key}",
            account=account,
            metadata={"version_id": payload.version_id},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/object-legal-hold", response_model=ObjectLegalHold)
def get_object_legal_hold(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_user),
) -> ObjectLegalHold:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        return service.get_object_legal_hold(bucket_name, account, key, version_id=version_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/buckets/{bucket_name}/object-legal-hold", response_model=ObjectLegalHold)
def put_object_legal_hold(
    bucket_name: str,
    payload: ObjectLegalHold,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ObjectLegalHold:
    try:
        result = service.put_object_legal_hold(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="browser",
            action="put_object_legal_hold",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.key}",
            account=account,
            metadata={"version_id": payload.version_id},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/object-retention", response_model=ObjectRetention)
def get_object_retention(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_user),
) -> ObjectRetention:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        return service.get_object_retention(bucket_name, account, key, version_id=version_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/buckets/{bucket_name}/object-retention", response_model=ObjectRetention)
def put_object_retention(
    bucket_name: str,
    payload: ObjectRetention,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ObjectRetention:
    try:
        result = service.put_object_retention(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="browser",
            action="put_object_retention",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.key}",
            account=account,
            metadata={"version_id": payload.version_id},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/objects/delete", response_model=dict)
def delete_objects(
    bucket_name: str,
    payload: DeleteObjectsPayload,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict:
    try:
        result = service.delete_objects(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="browser",
            action="delete_objects",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={"count": len(payload.keys)},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/objects/copy", response_model=dict)
def copy_object(
    bucket_name: str,
    payload: CopyObjectPayload,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict:
    try:
        result = service.copy_object(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="browser",
            action="copy_object",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.source_key}",
            account=account,
            metadata={"dest_key": payload.dest_key},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/folder", response_model=dict)
def create_folder(
    bucket_name: str,
    payload: CreateFolderPayload,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict:
    if not payload.prefix:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing prefix")
    try:
        result = service.create_folder(bucket_name, account, payload.prefix)
        audit_service.record_action(
            user=current_user,
            scope="browser",
            action="create_folder",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={"prefix": payload.prefix},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/upload/proxy", response_model=ProxyUploadResponse)
def upload_via_proxy(
    bucket_name: str,
    file: UploadFile = File(...),
    key: str = Form(...),
    content_type: Optional[str] = Form(default=None),
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ProxyUploadResponse:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        service.upload_via_proxy(bucket_name, account, file, key=key, content_type=content_type)
        audit_service.record_action(
            user=current_user,
            scope="browser",
            action="upload_via_proxy",
            entity_type="object",
            entity_id=f"{bucket_name}/{key}",
            account=account,
        )
        return ProxyUploadResponse(message="Upload completed", key=key)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/download")
def download_object(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_user),
) -> StreamingResponse:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        stream, content_type, filename = service.download_object(bucket_name, account, key, version_id=version_id)
        headers = {}
        if filename:
            headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        return StreamingResponse(stream, media_type=content_type or "application/octet-stream", headers=headers)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/presign", response_model=PresignedUrl)
def presign(
    bucket_name: str,
    payload: PresignRequest,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_user),
) -> PresignedUrl:
    try:
        return service.presign(bucket_name, account, payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/multipart/init", response_model=MultipartUploadInitResponse)
def multipart_init(
    bucket_name: str,
    payload: MultipartUploadInitRequest,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> MultipartUploadInitResponse:
    try:
        result = service.multipart_init(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="browser",
            action="multipart_init",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.key}",
            account=account,
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/multipart/uploads", response_model=ListMultipartUploadsResponse)
def list_multipart_uploads(
    bucket_name: str,
    prefix: Optional[str] = None,
    key_marker: Optional[str] = None,
    upload_id_marker: Optional[str] = None,
    max_uploads: int = Query(default=1000, ge=1, le=1000),
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_user),
) -> ListMultipartUploadsResponse:
    try:
        return service.list_multipart_uploads(
            bucket_name,
            account,
            prefix=prefix,
            key_marker=key_marker,
            upload_id_marker=upload_id_marker,
            max_uploads=max_uploads,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/multipart/parts", response_model=ListPartsResponse)
def list_parts(
    bucket_name: str,
    key: str,
    upload_id: str,
    part_number_marker: Optional[int] = None,
    max_parts: int = Query(default=1000, ge=1, le=1000),
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_user),
) -> ListPartsResponse:
    try:
        return service.list_parts(
            bucket_name,
            account,
            key=key,
            upload_id=upload_id,
            part_number_marker=part_number_marker,
            max_parts=max_parts,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/multipart/presign", response_model=PresignPartResponse)
def presign_part(
    bucket_name: str,
    payload: PresignPartRequest,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_user),
) -> PresignPartResponse:
    try:
        return service.presign_part(bucket_name, account, payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/multipart/complete", response_model=dict)
def multipart_complete(
    bucket_name: str,
    payload: CompleteMultipartUploadRequest,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict:
    try:
        result = service.multipart_complete(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="browser",
            action="multipart_complete",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.key}",
            account=account,
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/object-restore", response_model=dict)
def restore_object(
    bucket_name: str,
    payload: ObjectRestoreRequest,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict:
    try:
        result = service.restore_object(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="browser",
            action="restore_object",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.key}",
            account=account,
            metadata={"days": payload.days, "tier": payload.tier, "version_id": payload.version_id},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/cleanup", response_model=CleanupObjectVersionsResponse)
def cleanup_object_versions(
    bucket_name: str,
    payload: CleanupObjectVersionsPayload,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> CleanupObjectVersionsResponse:
    try:
        result = service.cleanup_object_versions(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="browser",
            action="cleanup_object_versions",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
