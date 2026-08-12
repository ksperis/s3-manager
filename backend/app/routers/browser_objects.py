# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models.access_context import ManagerActor
from app.models.browser import (
    CleanupObjectVersionsPayload,
    CleanupObjectVersionsResponse,
    CopyObjectPayload,
    DeleteObjectsPayload,
    ListObjectVersionsResponse,
    ObjectAcl,
    ObjectLegalHold,
    ObjectMetadata,
    ObjectMetadataUpdate,
    ObjectRestoreRequest,
    ObjectRetention,
    ObjectTags,
    SseCustomerContext,
)
from app.routers.browser_common import CreateFolderPayload, require_sse_feature
from app.routers.dependencies import (
    get_account_context,
    get_current_account_admin,
    get_optional_sse_customer_context,
)
from app.services.browser_service import BrowserService, get_browser_service
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.http_errors import raise_bad_gateway_from_runtime

router = APIRouter()


@router.get("/buckets/{bucket_name}/versions", response_model=ListObjectVersionsResponse)
def list_versions(
    bucket_name: str,
    prefix: str = "",
    delimiter: Optional[str] = None,
    key: Optional[str] = None,
    key_marker: Optional[str] = None,
    version_id_marker: Optional[str] = None,
    max_keys: int = Query(default=1000, ge=1, le=1000),
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ListObjectVersionsResponse:
    try:
        return service.list_object_versions(
            bucket_name,
            account,
            prefix=prefix,
            delimiter=delimiter,
            key=key,
            key_marker=key_marker,
            version_id_marker=version_id_marker,
            max_keys=max_keys,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/object-meta", response_model=ObjectMetadata)
def head_object(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    sse_customer: Optional[SseCustomerContext] = Depends(get_optional_sse_customer_context),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectMetadata:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    if sse_customer:
        require_sse_feature(account)
    try:
        return service.head_object(
            bucket_name,
            account,
            key,
            version_id=version_id,
            sse_customer=sse_customer,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.put("/buckets/{bucket_name}/object-meta", response_model=ObjectMetadata)
def update_object_metadata(
    bucket_name: str,
    payload: ObjectMetadataUpdate,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectMetadata:
    try:
        return service.update_object_metadata(bucket_name, account, payload)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/object-tags", response_model=ObjectTags)
def get_object_tags(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectTags:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        return service.get_object_tags(bucket_name, account, key, version_id=version_id)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.put("/buckets/{bucket_name}/object-tags", response_model=ObjectTags)
def put_object_tags(
    bucket_name: str,
    payload: ObjectTags,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectTags:
    if not payload.key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        return service.put_object_tags(
            bucket_name,
            account,
            payload.key,
            payload.tags,
            version_id=payload.version_id,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/object-acl", response_model=ObjectAcl)
def get_object_acl(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectAcl:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        return service.get_object_acl(bucket_name, account, key, version_id=version_id)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.put("/buckets/{bucket_name}/object-acl", response_model=ObjectAcl)
def put_object_acl(
    bucket_name: str,
    payload: ObjectAcl,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectAcl:
    try:
        return service.put_object_acl(bucket_name, account, payload)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/object-legal-hold", response_model=ObjectLegalHold)
def get_object_legal_hold(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectLegalHold:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        return service.get_object_legal_hold(bucket_name, account, key, version_id=version_id)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.put("/buckets/{bucket_name}/object-legal-hold", response_model=ObjectLegalHold)
def put_object_legal_hold(
    bucket_name: str,
    payload: ObjectLegalHold,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectLegalHold:
    try:
        return service.put_object_legal_hold(bucket_name, account, payload)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/object-retention", response_model=ObjectRetention)
def get_object_retention(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectRetention:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        return service.get_object_retention(bucket_name, account, key, version_id=version_id)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.put("/buckets/{bucket_name}/object-retention", response_model=ObjectRetention)
def put_object_retention(
    bucket_name: str,
    payload: ObjectRetention,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectRetention:
    try:
        return service.put_object_retention(bucket_name, account, payload)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/delete", response_model=dict)
def delete_objects(
    bucket_name: str,
    payload: DeleteObjectsPayload,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> dict:
    if not payload.objects:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing objects")
    try:
        deleted = service.delete_objects(bucket_name, account, payload)
        return {"deleted": deleted}
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/copy", response_model=dict)
def copy_object(
    bucket_name: str,
    payload: CopyObjectPayload,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> dict:
    if not payload.source_key or not payload.destination_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing source or destination key",
        )
    try:
        service.copy_object(bucket_name, account, payload)
        return {"message": "ok"}
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/folders", response_model=dict)
def create_folder(
    bucket_name: str,
    payload: CreateFolderPayload,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> dict:
    if not payload.prefix:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing prefix")
    try:
        service.create_folder(bucket_name, account, payload.prefix)
        return {"message": "created", "prefix": payload.prefix}
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/object-restore", response_model=dict)
def restore_object(
    bucket_name: str,
    payload: ObjectRestoreRequest,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> dict:
    try:
        return service.restore_object(bucket_name, account, payload)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/versions/cleanup", response_model=CleanupObjectVersionsResponse)
def cleanup_object_versions(
    bucket_name: str,
    payload: CleanupObjectVersionsPayload,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> CleanupObjectVersionsResponse:
    try:
        return service.cleanup_object_versions(bucket_name, account, payload)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)
