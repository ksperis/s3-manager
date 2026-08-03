# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app.db import User
from app.services.s3_execution_context import S3ExecutionContext
from app.models.object import ListObjectsResponse
from app.routers.dependencies import get_account_context, get_current_account_admin
from app.services.objects_service import ObjectsService, get_objects_service
from app.utils.http_errors import sanitize_error_detail

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
    account: S3ExecutionContext = Depends(get_account_context),
    service: ObjectsService = Depends(get_objects_service),
    _: User = Depends(get_current_account_admin),
):
    try:
        return service.list_objects(bucket_name, account, prefix=prefix, continuation_token=continuation_token)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=sanitize_error_detail(str(exc))) from exc


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_object(
    bucket_name: str,
    file: UploadFile = File(...),
    prefix: str = Form(""),
    key: Optional[str] = Form(None),
    account: S3ExecutionContext = Depends(get_account_context),
    service: ObjectsService = Depends(get_objects_service),
    _: User = Depends(get_current_account_admin),
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
        return UploadResponse(key=target_key, message="Uploaded")
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=sanitize_error_detail(str(exc))) from exc


@router.post("/folders", status_code=status.HTTP_201_CREATED)
def create_folder(
    bucket_name: str,
    payload: CreateFolderPayload,
    account: S3ExecutionContext = Depends(get_account_context),
    service: ObjectsService = Depends(get_objects_service),
    _: User = Depends(get_current_account_admin),
):
    try:
        service.create_folder(bucket_name, account, folder_prefix=payload.prefix)
        return {"message": "Folder created", "prefix": payload.prefix}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=sanitize_error_detail(str(exc))) from exc


@router.post("/delete")
def delete_objects(
    bucket_name: str,
    payload: DeleteObjectsPayload,
    account: S3ExecutionContext = Depends(get_account_context),
    service: ObjectsService = Depends(get_objects_service),
    _: dict = Depends(get_current_account_admin),
):
    if not payload.keys:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No keys provided")
    try:
        service.delete_objects(bucket_name, account, payload.keys)
        return {"message": f"Deleted {len(payload.keys)} object(s)"}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=sanitize_error_detail(str(exc))) from exc


@router.get("/download", response_model=DownloadResponse)
def get_download_url(
    bucket_name: str,
    key: str,
    expires_in: int = 300,
    account: S3ExecutionContext = Depends(get_account_context),
    service: ObjectsService = Depends(get_objects_service),
    _: dict = Depends(get_current_account_admin),
):
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        url = service.generate_download_url(bucket_name, account, key, expires_in=expires_in)
        return DownloadResponse(url=url, expires_in=expires_in)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=sanitize_error_detail(str(exc))) from exc
