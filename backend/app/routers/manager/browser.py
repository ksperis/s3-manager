# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.db_models import S3Account, User
from app.models.browser import (
    CompleteMultipartUploadRequest,
    CopyObjectPayload,
    DeleteObjectsPayload,
    ListBrowserObjectsResponse,
    ListMultipartUploadsResponse,
    ListObjectVersionsResponse,
    ListPartsResponse,
    MultipartUploadInitRequest,
    MultipartUploadInitResponse,
    ObjectMetadata,
    ObjectMetadataUpdate,
    ObjectAcl,
    ObjectLegalHold,
    ObjectRetention,
    ObjectRestoreRequest,
    ObjectTags,
    PresignPartRequest,
    PresignPartResponse,
    PresignRequest,
    PresignedUrl,
    BucketCorsStatus,
    StsStatus,
    BrowserStsCredentials,
)
from app.models.browser import BrowserBucket
from app.services.audit_service import AuditService
from app.services.browser_service import BrowserService, get_browser_service
from app.services.app_settings_service import load_app_settings
from app.models.app_settings import BrowserSettings
from app.routers.dependencies import get_account_context, get_audit_logger, get_current_account_admin

router = APIRouter(prefix="/manager/browser", tags=["manager-browser"])


class CreateFolderPayload(BaseModel):
    prefix: str


class ProxyUploadResponse(BaseModel):
    message: str
    key: str


class EnsureCorsPayload(BaseModel):
    origin: str


@router.get("/settings", response_model=BrowserSettings)
def get_browser_settings(
    _: User = Depends(get_current_account_admin),
) -> BrowserSettings:
    return load_app_settings().browser


@router.get("/buckets", response_model=list[BrowserBucket])
def list_buckets(
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_admin),
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
    _: User = Depends(get_current_account_admin),
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
    _: User = Depends(get_current_account_admin),
) -> BucketCorsStatus:
    return service.get_bucket_cors_status(bucket_name, account, origin=origin)


@router.post("/buckets/{bucket_name}/cors/ensure", response_model=BucketCorsStatus)
def ensure_bucket_cors(
    bucket_name: str,
    payload: EnsureCorsPayload,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketCorsStatus:
    if not payload.origin:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing origin")
    try:
        status_result = service.ensure_bucket_cors(bucket_name, account, payload.origin)
        audit_service.record_action(
            user=current_user,
            scope="manager",
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
    _: User = Depends(get_current_account_admin),
) -> StsStatus:
    return service.check_sts(account)


@router.get("/sts/credentials", response_model=BrowserStsCredentials)
def get_sts_credentials(
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_admin),
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
    _: User = Depends(get_current_account_admin),
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
    _: User = Depends(get_current_account_admin),
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
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ObjectMetadata:
    if not payload.key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        updated = service.update_object_metadata(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_object_metadata",
            entity_type="object",
            entity_id=payload.key,
            account=account,
            metadata={"version_id": payload.version_id, "bucket": bucket_name},
        )
        return updated
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/object-tags", response_model=ObjectTags)
def get_object_tags(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_admin),
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
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ObjectTags:
    if not payload.key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        result = service.put_object_tags(bucket_name, account, payload.key, payload.tags, version_id=payload.version_id)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="put_object_tags",
            entity_type="object",
            entity_id=payload.key,
            account=account,
            metadata={"count": len(payload.tags or []), "version_id": payload.version_id},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/buckets/{bucket_name}/object-acl", response_model=ObjectAcl)
def put_object_acl(
    bucket_name: str,
    payload: ObjectAcl,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ObjectAcl:
    if not payload.key or not payload.acl:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key or acl")
    try:
        result = service.put_object_acl(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="put_object_acl",
            entity_type="object",
            entity_id=payload.key,
            account=account,
            metadata={"acl": payload.acl, "version_id": payload.version_id},
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
    _: User = Depends(get_current_account_admin),
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
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ObjectLegalHold:
    if not payload.key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        result = service.put_object_legal_hold(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="put_object_legal_hold",
            entity_type="object",
            entity_id=payload.key,
            account=account,
            metadata={"status": payload.status, "version_id": payload.version_id},
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
    _: User = Depends(get_current_account_admin),
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
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ObjectRetention:
    if not payload.key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        result = service.put_object_retention(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="put_object_retention",
            entity_type="object",
            entity_id=payload.key,
            account=account,
            metadata={"mode": payload.mode, "version_id": payload.version_id},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/object-restore")
def restore_object(
    bucket_name: str,
    payload: ObjectRestoreRequest,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    if not payload.key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        service.restore_object(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="restore_object",
            entity_type="object",
            entity_id=payload.key,
            account=account,
            metadata={"days": payload.days, "tier": payload.tier, "version_id": payload.version_id},
        )
        return {"message": "restoring"}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/presign", response_model=PresignedUrl)
def presign_object(
    bucket_name: str,
    payload: PresignRequest,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_admin),
) -> PresignedUrl:
    if not payload.key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        return service.presign(bucket_name, account, payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/proxy-upload", response_model=ProxyUploadResponse)
def proxy_upload(
    bucket_name: str,
    key: str = Form(...),
    file: UploadFile = File(...),
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ProxyUploadResponse:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    if not load_app_settings().browser.allow_proxy_transfers:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Proxy transfers are disabled")
    try:
        service.proxy_upload(bucket_name, account, key, file.file, file.content_type)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="proxy_upload",
            entity_type="object",
            entity_id=key,
            account=account,
            metadata={"bucket": bucket_name, "content_type": file.content_type},
        )
        return ProxyUploadResponse(message="uploaded", key=key)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/proxy-download")
def proxy_download(
    bucket_name: str,
    key: str,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    if not load_app_settings().browser.allow_proxy_transfers:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Proxy transfers are disabled")
    try:
        resp = service.proxy_download(bucket_name, account, key)
        body = resp.get("Body")
        if not body:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Empty response body")
        content_type = resp.get("ContentType") or "application/octet-stream"
        filename = os.path.basename(key) or "download"
        headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
        content_length = resp.get("ContentLength")
        if content_length is not None:
            headers["Content-Length"] = str(content_length)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="proxy_download",
            entity_type="object",
            entity_id=key,
            account=account,
            metadata={"bucket": bucket_name},
        )
        return StreamingResponse(body.iter_chunks(chunk_size=1024 * 1024), media_type=content_type, headers=headers)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/copy")
def copy_object(
    bucket_name: str,
    payload: CopyObjectPayload,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    if not payload.source_key or not payload.destination_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing source or destination key")
    try:
        service.copy_object(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="move_object" if payload.move else "copy_object",
            entity_type="object",
            entity_id=payload.destination_key,
            account=account,
            metadata={
                "source": payload.source_key,
                "source_bucket": payload.source_bucket or bucket_name,
                "destination_bucket": bucket_name,
                "destination": payload.destination_key,
                "move": payload.move,
                "version_id": payload.source_version_id,
            },
        )
        return {"message": "ok"}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/delete")
def delete_objects(
    bucket_name: str,
    payload: DeleteObjectsPayload,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    if not payload.objects:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No objects provided")
    try:
        deleted = service.delete_objects(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_objects",
            entity_type="object",
            entity_id=None,
            account=account,
            metadata={"count": deleted, "bucket": bucket_name},
        )
        return {"deleted": deleted}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/folders", status_code=status.HTTP_201_CREATED)
def create_folder(
    bucket_name: str,
    payload: CreateFolderPayload,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    if not payload.prefix:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing prefix")
    try:
        service.create_folder(bucket_name, account, payload.prefix)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="create_folder",
            entity_type="object_prefix",
            entity_id=payload.prefix,
            account=account,
            metadata={"bucket": bucket_name},
        )
        return {"message": "created", "prefix": payload.prefix}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/multipart/initiate", response_model=MultipartUploadInitResponse)
def initiate_multipart_upload(
    bucket_name: str,
    payload: MultipartUploadInitRequest,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> MultipartUploadInitResponse:
    if not payload.key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        result = service.initiate_multipart_upload(bucket_name, account, payload)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="initiate_multipart_upload",
            entity_type="object",
            entity_id=payload.key,
            account=account,
            metadata={"content_type": payload.content_type},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/multipart", response_model=ListMultipartUploadsResponse)
def list_multipart_uploads(
    bucket_name: str,
    prefix: Optional[str] = None,
    key_marker: Optional[str] = None,
    upload_id_marker: Optional[str] = None,
    max_uploads: int = Query(default=50, ge=1, le=1000),
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_admin),
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


@router.get("/buckets/{bucket_name}/multipart/{upload_id}/parts", response_model=ListPartsResponse)
def list_parts(
    bucket_name: str,
    upload_id: str,
    key: str,
    part_number_marker: Optional[int] = None,
    max_parts: int = Query(default=1000, ge=1, le=1000),
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_admin),
) -> ListPartsResponse:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        return service.list_parts(
            bucket_name,
            account,
            key,
            upload_id,
            part_number_marker=part_number_marker,
            max_parts=max_parts,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/multipart/{upload_id}/presign", response_model=PresignPartResponse)
def presign_part(
    bucket_name: str,
    upload_id: str,
    payload: PresignPartRequest,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: User = Depends(get_current_account_admin),
) -> PresignPartResponse:
    if not payload.key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    payload.upload_id = upload_id
    try:
        return service.presign_part(bucket_name, account, payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/multipart/{upload_id}/complete")
def complete_multipart_upload(
    bucket_name: str,
    upload_id: str,
    key: str,
    payload: CompleteMultipartUploadRequest,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        service.complete_multipart_upload(bucket_name, account, key, upload_id, payload)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="complete_multipart_upload",
            entity_type="object",
            entity_id=key,
            account=account,
            metadata={"parts": len(payload.parts or [])},
        )
        return {"message": "completed"}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/buckets/{bucket_name}/multipart/{upload_id}", status_code=status.HTTP_204_NO_CONTENT)
def abort_multipart_upload(
    bucket_name: str,
    upload_id: str,
    key: str,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        service.abort_multipart_upload(bucket_name, account, key, upload_id)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="abort_multipart_upload",
            entity_type="object",
            entity_id=key,
            account=account,
            metadata={"upload_id": upload_id},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
