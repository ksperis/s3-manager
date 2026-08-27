# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.sensitive_data import sanitize_error_detail
from app.db import User
from app.models.bucket_ui_tags import (
    BucketUiTagCatalogResponse,
    BucketUiTagDefinitionSummary,
    BucketUiTagOrphansResponse,
    StorageOpsBucketUiTagDefinitionPatch,
    StorageOpsBucketUiTagPatchRequest,
)
from app.routers.dependencies import get_current_storage_ops_admin
from app.routers.storage_ops.buckets import _collect_context_refs, _resolve_context_account
from app.services.bucket_ui_tags_service import BucketUiTagsService
from app.services.buckets_service import BucketsService, get_buckets_service
from app.services.storage_ops_bucket_ui_tags_service import (
    StorageOpsBucketUiTagAuthorizationError,
    StorageOpsBucketUiTagConflictError,
    StorageOpsBucketUiTagNotFoundError,
    StorageOpsBucketUiTagTargetError,
    StorageOpsBucketUiTagUpstreamError,
    StorageOpsBucketUiTagsWorkflow,
)


router = APIRouter(prefix="/storage-ops/bucket-ui-tags", tags=["storage-ops-bucket-ui-tags"])


def _workflow(
    *,
    request: Request,
    user: User,
    db: Session,
) -> StorageOpsBucketUiTagsWorkflow:
    return StorageOpsBucketUiTagsWorkflow(
        tags=BucketUiTagsService(db),
        actor_user_id=int(user.id),
        context_refs=_collect_context_refs(user, db),
        resolve_account=lambda ref: _resolve_context_account(
            ref,
            request=request,
            db=db,
            user=user,
        ),
    )


@router.get("", response_model=BucketUiTagCatalogResponse)
def get_bucket_ui_tags(
    request: Request,
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
) -> BucketUiTagCatalogResponse:
    return _workflow(request=request, user=user, db=db).catalog()


@router.get("/orphans", response_model=BucketUiTagOrphansResponse)
def get_bucket_ui_tag_orphans(
    request: Request,
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
    buckets: BucketsService = Depends(get_buckets_service),
) -> BucketUiTagOrphansResponse:
    try:
        return _workflow(request=request, user=user, db=db).orphans(buckets)
    except StorageOpsBucketUiTagUpstreamError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=sanitize_error_detail(str(exc)),
        ) from exc


@router.patch("", response_model=BucketUiTagCatalogResponse)
def patch_bucket_ui_tags(
    payload: StorageOpsBucketUiTagPatchRequest,
    request: Request,
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
    buckets: BucketsService = Depends(get_buckets_service),
) -> BucketUiTagCatalogResponse:
    try:
        return _workflow(request=request, user=user, db=db).mutate(
            payload,
            buckets,
        )
    except StorageOpsBucketUiTagAuthorizationError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    except StorageOpsBucketUiTagConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    except StorageOpsBucketUiTagUpstreamError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    except (StorageOpsBucketUiTagTargetError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_detail(str(exc)),
        ) from exc


@router.patch("/{tag_id}", response_model=BucketUiTagDefinitionSummary)
def patch_bucket_ui_tag_definition(
    tag_id: int,
    payload: StorageOpsBucketUiTagDefinitionPatch,
    request: Request,
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
) -> BucketUiTagDefinitionSummary:
    try:
        return _workflow(request=request, user=user, db=db).update_definition(
            tag_id,
            payload,
        )
    except StorageOpsBucketUiTagNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
