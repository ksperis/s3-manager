# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.sensitive_data import sanitize_error_detail
from app.models.bucket_ui_tags import (
    BucketUiTagCatalogResponse,
    CephAdminBucketUiTagPatchRequest,
)
from app.routers.ceph_admin.audit import record_ceph_admin_action
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.services.bucket_ui_tags_service import BucketUiTagsService
from app.services.ceph_admin_bucket_ui_tags_service import (
    CephAdminBucketUiTagConflictError,
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
        record_shared_mutation=lambda target_count: record_ceph_admin_action(
            ctx,
            action="bucket_ui_tags.update_shared",
            entity_type="bucket_ui_tag_batch",
            entity_id=str(ctx.endpoint.id),
            metadata={"target_count": target_count},
        ),
    )


@router.get("", response_model=BucketUiTagCatalogResponse)
def get_bucket_ui_tags(
    workflow: CephAdminBucketUiTagsWorkflow = Depends(
        get_ceph_admin_bucket_ui_tags_workflow
    ),
) -> BucketUiTagCatalogResponse:
    return workflow.catalog()


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
