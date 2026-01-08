# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.browser import (
    BrowserBucket,
    BrowserStsCredentials,
    DeleteObjectsPayload,
    ListBrowserObjectsResponse,
    PresignRequest,
    PresignedUrl,
    StsStatus,
)
from app.routers.dependencies import get_audit_logger
from app.routers.portal.dependencies import PortalContext, require_portal_permission
from app.services.audit_service import AuditService
from app.services.portal_browser_service import PortalBrowserService, get_portal_browser_service


router = APIRouter(prefix="/browser", tags=["portal-browser"])


@router.get("/buckets", response_model=list[BrowserBucket])
def list_buckets(
    ctx: PortalContext = Depends(require_portal_permission("portal.browser.view")),
    service: PortalBrowserService = Depends(lambda db=Depends(get_db): get_portal_browser_service(db)),
) -> list[BrowserBucket]:
    try:
        return service.list_buckets(ctx)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/objects", response_model=ListBrowserObjectsResponse)
def list_objects(
    bucket_name: str,
    prefix: str = "",
    continuation_token: Optional[str] = None,
    max_keys: int = Query(default=1000, ge=1, le=1000),
    ctx: PortalContext = Depends(require_portal_permission("portal.objects.list")),
    service: PortalBrowserService = Depends(lambda db=Depends(get_db): get_portal_browser_service(db)),
) -> ListBrowserObjectsResponse:
    try:
        return service.list_objects(
            ctx,
            bucket_name,
            prefix=prefix,
            continuation_token=continuation_token,
            max_keys=max_keys,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/presign", response_model=PresignedUrl)
def presign_object(
    bucket_name: str,
    payload: PresignRequest,
    ctx: PortalContext = Depends(require_portal_permission("portal.browser.view")),
    service: PortalBrowserService = Depends(lambda db=Depends(get_db): get_portal_browser_service(db)),
    audit: AuditService = Depends(get_audit_logger),
) -> PresignedUrl:
    if not payload.key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    if payload.operation == "get_object" and not ctx.can("portal.objects.get"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    if payload.operation == "put_object" and not ctx.can("portal.objects.put"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    try:
        url = service.presign(ctx, bucket_name, payload)
        if payload.operation == "put_object":
            audit.record_action(
                user=ctx.actor,
                scope="portal",
                action="presign_put_object",
                surface="portal",
                workflow="browser.put_object",
                entity_type="object",
                entity_id=payload.key,
                account=ctx.account,
                executor_type="presign",
                executor_principal="portal-browser",
                delta={"bucket": bucket_name, "key": payload.key, "content_type": payload.content_type},
            )
        return url
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_objects(
    bucket_name: str,
    payload: DeleteObjectsPayload,
    ctx: PortalContext = Depends(require_portal_permission("portal.objects.delete")),
    service: PortalBrowserService = Depends(lambda db=Depends(get_db): get_portal_browser_service(db)),
    audit: AuditService = Depends(get_audit_logger),
) -> None:
    try:
        service.delete_objects(ctx, bucket_name, payload)
        audit.record_action(
            user=ctx.actor,
            scope="portal",
            action="delete_objects",
            surface="portal",
            workflow="browser.delete_objects",
            entity_type="bucket",
            entity_id=bucket_name,
            account=ctx.account,
            executor_type="portal_api",
            executor_principal="portal-browser",
            delta={"bucket": bucket_name, "objects": [o.key for o in payload.objects]},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/sts", response_model=StsStatus)
def get_sts_status(
    ctx: PortalContext = Depends(require_portal_permission("portal.browser.view")),
    service: PortalBrowserService = Depends(lambda db=Depends(get_db): get_portal_browser_service(db)),
) -> StsStatus:
    return service.check_sts(ctx)


@router.get("/sts/credentials", response_model=BrowserStsCredentials)
def get_sts_credentials(
    ctx: PortalContext = Depends(require_portal_permission("portal.browser.view")),
    service: PortalBrowserService = Depends(lambda db=Depends(get_db): get_portal_browser_service(db)),
) -> BrowserStsCredentials:
    try:
        return service.get_sts_credentials(ctx)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/buckets/{bucket_name}/proxy-upload", status_code=status.HTTP_204_NO_CONTENT)
def proxy_upload(
    bucket_name: str,
    key: str = Form(...),
    file: UploadFile = File(...),
    ctx: PortalContext = Depends(require_portal_permission("portal.objects.put")),
    service: PortalBrowserService = Depends(lambda db=Depends(get_db): get_portal_browser_service(db)),
    audit: AuditService = Depends(get_audit_logger),
) -> None:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        service.proxy_upload(ctx, bucket_name, key, file.file, file.content_type)
        audit.record_action(
            user=ctx.actor,
            scope="portal",
            action="proxy_upload",
            surface="portal",
            workflow="browser.proxy_upload",
            entity_type="object",
            entity_id=key,
            account=ctx.account,
            executor_type="portal_api",
            executor_principal="portal-browser",
            delta={"bucket": bucket_name, "key": key, "content_type": file.content_type},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/proxy-download")
def proxy_download(
    bucket_name: str,
    key: str,
    ctx: PortalContext = Depends(require_portal_permission("portal.objects.get")),
    service: PortalBrowserService = Depends(lambda db=Depends(get_db): get_portal_browser_service(db)),
    audit: AuditService = Depends(get_audit_logger),
):
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        resp = service.proxy_download(ctx, bucket_name, key)
        body = resp.get("Body")
        if not body:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Empty response body")
        content_type = resp.get("ContentType") or "application/octet-stream"
        filename = os.path.basename(key) or "download"
        headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
        content_length = resp.get("ContentLength")
        if content_length is not None:
            headers["Content-Length"] = str(content_length)
        audit.record_action(
            user=ctx.actor,
            scope="portal",
            action="proxy_download",
            surface="portal",
            workflow="browser.proxy_download",
            entity_type="object",
            entity_id=key,
            account=ctx.account,
            executor_type="portal_api",
            executor_principal="portal-browser",
            delta={"bucket": bucket_name, "key": key},
        )
        return StreamingResponse(body.iter_chunks(chunk_size=1024 * 1024), media_type=content_type, headers=headers)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

