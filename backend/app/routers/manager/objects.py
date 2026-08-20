# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.sensitive_data import sanitize_error_detail
from app.models.access_context import ManagerActor
from app.models.object import ListObjectsResponse
from app.routers.dependencies import get_account_context, get_current_account_admin
from app.services.objects_service import ObjectsService, get_objects_service
from app.services.s3_execution_context import S3ExecutionContext

router = APIRouter(prefix="/manager/buckets/{bucket_name}/objects", tags=["manager-objects"])


@router.get("", response_model=ListObjectsResponse)
def list_objects(
    bucket_name: str,
    prefix: str = "",
    continuation_token: Optional[str] = None,
    account: S3ExecutionContext = Depends(get_account_context),
    service: ObjectsService = Depends(get_objects_service),
    _: ManagerActor = Depends(get_current_account_admin),
):
    try:
        return service.list_objects(bucket_name, account, prefix=prefix, continuation_token=continuation_token)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=sanitize_error_detail(str(exc))) from exc
