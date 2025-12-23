# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app.db_models import S3Account, User
from app.models.object import ListObjectsResponse
from app.routers.dependencies import get_account_context, get_audit_logger, get_current_account_admin
from app.services.audit_service import AuditService
from app.services.objects_service import ObjectsService, get_objects_service

router = APIRouter(prefix="/manager/buckets/{bucket_name}/objects", tags=["manager-objects"])


class CreateFolderPayload(BaseModel):
    prefix: str = Field(..., description="Folder prefix, trailing slash optional")


class DeleteObjectsPayload(BaseModel):
    keys: list[str]


class UploadResponse(BaseModel):
    key: str
    message: str


class DownloadResponse(BaseModel):
    url: str
    expires_in: int


@router.get("", response_model=ListObjectsResponse)
def list_objects(
    bucket_name: str,
    prefix: str = "",
    continuation_token: Optional[str] = None,
    account: S3Account = Depends(get_account_context),
    service: ObjectsService = Depends(get_objects_service),
    _: dict = Depends(get_current_account_admin),
):
    try:
        return service.list_objects(bucket_name, account, prefix=prefix, continuation_token=continuation_token)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_object(
    bucket_name: str,
    file: UploadFile = File(...),
    prefix: str = Form(""),
    key: Optional[str] = Form(None),
    account: S3Account = Depends(get_account_context),
    service: ObjectsService = Depends(get_objects_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing filename")

    target_key = key.strip() if key else ""
    if not target_key:
        normalized_prefix = prefix or ""
        if normalized_prefix and not normalized_prefix.endswith("/"):
            normalized_prefix = f"{normalized_prefix}/"
        target_key = f"{normalized_prefix}{file.filename}"

    try:
        contents = await file.read()
        service.upload_object(bucket_name, account, target_key, file_obj=contents, content_type=file.content_type)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="upload_object",
            entity_type="object",
            entity_id=target_key,
            account=account,
            metadata={
                "bucket": bucket_name,
                "content_type": file.content_type,
                "size_bytes": len(contents),
            },
        )
        return UploadResponse(key=target_key, message="Uploaded")
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/folders", status_code=status.HTTP_201_CREATED)
def create_folder(
    bucket_name: str,
    payload: CreateFolderPayload,
    account: S3Account = Depends(get_account_context),
    service: ObjectsService = Depends(get_objects_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    try:
        service.create_folder(bucket_name, account, folder_prefix=payload.prefix)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="create_folder",
            entity_type="object_prefix",
            entity_id=payload.prefix,
            account=account,
            metadata={"bucket": bucket_name},
        )
        return {"message": "Folder created", "prefix": payload.prefix}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/delete")
def delete_objects(
    bucket_name: str,
    payload: DeleteObjectsPayload,
    account: S3Account = Depends(get_account_context),
    service: ObjectsService = Depends(get_objects_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    if not payload.keys:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No keys provided")
    try:
        service.delete_objects(bucket_name, account, payload.keys)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_objects",
            entity_type="object",
            entity_id=None,
            account=account,
            metadata={
                "bucket": bucket_name,
                "count": len(payload.keys),
                "keys_sample": payload.keys[:5],
            },
        )
        return {"message": f"Deleted {len(payload.keys)} object(s)"}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/download", response_model=DownloadResponse)
def get_download_url(
    bucket_name: str,
    key: str,
    expires_in: int = 300,
    account: S3Account = Depends(get_account_context),
    service: ObjectsService = Depends(get_objects_service),
    _: dict = Depends(get_current_account_admin),
):
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        url = service.generate_download_url(bucket_name, account, key, expires_in=expires_in)
        return DownloadResponse(url=url, expires_in=expires_in)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
