# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.sensitive_data import sanitize_error_detail
from app.models.bucket_ui_tags import (
    BucketUiTagCatalogResponse,
    BucketUiTagDefinitionSummary,
    BucketUiTagOrphansResponse,
    CephAdminBucketUiTagDefinitionPatch,
    CephAdminBucketUiTagPatchRequest,
)
from app.routers.ceph_admin.audit import record_ceph_admin_action
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.services.bucket_ui_tags_service import BucketUiTagsService
from app.services.ceph_admin_bucket_listing_service import (
    get_cached_ceph_admin_bucket_targets,
)
from app.services.ceph_admin_bucket_ui_tags_service import (
    CephAdminBucketUiTagConflictError,
    CephAdminBucketUiTagNotFoundError,
    CephAdminBucketUiTagUpstreamError,
    CephAdminBucketUiTagsWorkflow,
)


router = APIRouter(
    prefix="/ceph-admin/endpoints/{endpoint_id}/bucket-ui-tags",
    tags=["ceph-admin-bucket-ui-tags"],
)


def get_ceph_admin_bucket_ui_tags_workflow(
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    db: Session = Depends(get_db),
) -> CephAdminBucketUiTagsWorkflow:
    assert ctx.actor is not None
    return CephAdminBucketUiTagsWorkflow(
        tags=BucketUiTagsService(db),
        actor_user_id=int(ctx.actor.id),
        endpoint_id=int(ctx.endpoint.id),
        bucket_info=ctx.rgw_admin,
        bucket_inventory=lambda: get_cached_ceph_admin_bucket_targets(ctx),
        record_shared_mutation=lambda target_count: record_ceph_admin_action(
            ctx,
            action="bucket_ui_tags.update_shared",
            entity_type="bucket_ui_tag_batch",
            entity_id=str(ctx.endpoint.id),
            metadata={"target_count": target_count},
        ),
        record_shared_definition_mutation=lambda mutation: record_ceph_admin_action(
            ctx,
            action="bucket_ui_tags.update_definition",
            entity_type="bucket_ui_tag_definition",
            entity_id=str(mutation.definition.id),
            metadata={
                "changed_fields": sorted(mutation.changed_fields),
                "previous_visibility": mutation.previous_visibility,
                "visibility": mutation.definition.visibility,
            },
        ),
    )


@router.get("", response_model=BucketUiTagCatalogResponse)
def get_bucket_ui_tags(
    workflow: CephAdminBucketUiTagsWorkflow = Depends(
        get_ceph_admin_bucket_ui_tags_workflow
    ),
) -> BucketUiTagCatalogResponse:
    return workflow.catalog()


@router.get("/orphans", response_model=BucketUiTagOrphansResponse)
def get_bucket_ui_tag_orphans(
    workflow: CephAdminBucketUiTagsWorkflow = Depends(
        get_ceph_admin_bucket_ui_tags_workflow
    ),
) -> BucketUiTagOrphansResponse:
    try:
        return workflow.orphans()
    except CephAdminBucketUiTagUpstreamError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=sanitize_error_detail(str(exc)),
        ) from exc


@router.patch("", response_model=BucketUiTagCatalogResponse)
def patch_bucket_ui_tags(
    payload: CephAdminBucketUiTagPatchRequest,
    workflow: CephAdminBucketUiTagsWorkflow = Depends(
        get_ceph_admin_bucket_ui_tags_workflow
    ),
) -> BucketUiTagCatalogResponse:
    try:
        return workflow.mutate(payload)
    except CephAdminBucketUiTagConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    except CephAdminBucketUiTagUpstreamError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_detail(str(exc)),
        ) from exc


@router.patch("/{tag_id}", response_model=BucketUiTagDefinitionSummary)
def patch_bucket_ui_tag_definition(
    tag_id: int,
    payload: CephAdminBucketUiTagDefinitionPatch,
    workflow: CephAdminBucketUiTagsWorkflow = Depends(
        get_ceph_admin_bucket_ui_tags_workflow
    ),
) -> BucketUiTagDefinitionSummary:
    try:
        return workflow.update_definition(tag_id, payload)
    except CephAdminBucketUiTagNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    except CephAdminBucketUiTagConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
