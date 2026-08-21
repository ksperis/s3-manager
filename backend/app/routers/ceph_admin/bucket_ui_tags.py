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
from app.services.bucket_ui_tags_service import BucketUiTagsService, PhysicalBucketTarget
from app.services.rgw_admin import RGWAdminError
from app.utils.tagging import TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN


router = APIRouter(
    prefix="/ceph-admin/endpoints/{endpoint_id}/bucket-ui-tags",
    tags=["ceph-admin-bucket-ui-tags"],
)


def _bucket_exists(ctx: CephAdminContext, target: PhysicalBucketTarget) -> bool:
    try:
        payload = ctx.rgw_admin.get_bucket_info(
            target.name,
            tenant=target.tenant or None,
            stats=False,
            allow_not_found=True,
        )
    except RGWAdminError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    return isinstance(payload, dict) and bool(payload) and not payload.get("not_found")


@router.get("", response_model=BucketUiTagCatalogResponse)
def get_bucket_ui_tags(
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    db: Session = Depends(get_db),
) -> BucketUiTagCatalogResponse:
    assert ctx.actor is not None
    return BucketUiTagsService(db).catalog(
        domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
        actor_user_id=int(ctx.actor.id),
        endpoint_id=int(ctx.endpoint.id),
    )


@router.patch("", response_model=BucketUiTagCatalogResponse)
def patch_bucket_ui_tags(
    payload: CephAdminBucketUiTagPatchRequest,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    db: Session = Depends(get_db),
) -> BucketUiTagCatalogResponse:
    assert ctx.actor is not None
    targets = [
        PhysicalBucketTarget.create(ctx.endpoint.id, target.tenant, target.name)
        for target in payload.targets
    ]
    has_additions = bool(payload.add_tag_ids or payload.create_tags)
    for target in targets:
        exists = _bucket_exists(ctx, target)
        if (has_additions and not exists) or (payload.require_absent and exists):
            detail = (
                "Bucket reappeared; its UI tags were not removed."
                if payload.require_absent
                else "Bucket not found."
            )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)

    service = BucketUiTagsService(db)
    visible_by_id = {
        int(row.id): row
        for row in service.visible_definitions(
            domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
            actor_user_id=int(ctx.actor.id),
        )
    }
    requested_ids = set(payload.add_tag_ids) | set(payload.remove_tag_ids)
    shared_mutation = any(
        identifier in visible_by_id and visible_by_id[identifier].owner_user_id is None
        for identifier in requested_ids
    ) or any(item.visibility == "shared" for item in payload.create_tags)
    if payload.remove_all and not shared_mutation:
        current = service.get_tags_for_targets(
            domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
            actor_user_id=int(ctx.actor.id),
            targets=targets,
        )
        shared_mutation = any(
            tag.visibility == "shared"
            for tags in current.values()
            for tag in tags
        )
    try:
        service.mutate(
            domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
            actor_user_id=int(ctx.actor.id),
            targets=targets,
            add_tag_ids=payload.add_tag_ids,
            create_tags=[
                (item.label, item.color_key, item.visibility)
                for item in payload.create_tags
            ],
            remove_tag_ids=payload.remove_tag_ids,
            remove_all=payload.remove_all,
        )
        # Persist the feature mutation before writing the best-effort audit
        # record. AuditService commits (and rolls back on persistence failure)
        # on the same request session, so recording first could silently roll
        # back the UI-tag mutation while the route still returned success.
        service.commit()
        if shared_mutation:
            record_ceph_admin_action(
                ctx,
                action="bucket_ui_tags.update_shared",
                entity_type="bucket_ui_tag_batch",
                entity_id=str(ctx.endpoint.id),
                metadata={"target_count": len(set(targets))},
            )
    except ValueError as exc:
        service.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    return service.catalog(
        domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
        actor_user_id=int(ctx.actor.id),
        endpoint_id=int(ctx.endpoint.id),
    )
