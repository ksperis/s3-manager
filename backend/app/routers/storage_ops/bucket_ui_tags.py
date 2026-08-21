# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.sensitive_data import sanitize_error_detail
from app.db import User
from app.models.bucket_ui_tags import BucketUiTagCatalogResponse, StorageOpsBucketUiTagPatchRequest
from app.routers.dependencies import get_current_storage_ops_admin
from app.routers.storage_ops.buckets import _collect_context_refs, _resolve_context_account
from app.services.bucket_ui_tags_service import BucketUiTagsService, PhysicalBucketTarget
from app.services.buckets_service import BucketsService, get_buckets_service
from app.services.s3_execution_context import S3ExecutionContext
from app.services.storage_ops_bucket_listing_service import (
    StorageOpsContextRef,
    resolve_storage_ops_context_tenant,
)
from app.utils.tagging import TAG_DOMAIN_BUCKET_UI_STORAGE_OPS


router = APIRouter(prefix="/storage-ops/bucket-ui-tags", tags=["storage-ops-bucket-ui-tags"])


def _authorized_physical_scopes(
    *,
    request: Request,
    user: User,
    db: Session,
    refs_by_id: dict[str, StorageOpsContextRef] | None = None,
    resolved: dict[str, tuple[S3ExecutionContext, set[str]]] | None = None,
) -> set[tuple[int, str]]:
    refs = (
        refs_by_id
        if refs_by_id is not None
        else {ref.context_id: ref for ref in _collect_context_refs(user, db)}
    )
    accounts = resolved if resolved is not None else {}
    scopes: set[tuple[int, str]] = set()
    for context_id, ref in refs.items():
        cached = accounts.get(context_id)
        account = cached[0] if cached is not None else _resolve_context_account(
            ref,
            request=request,
            db=db,
            user=user,
        )
        endpoint_id = int(getattr(account, "storage_endpoint_id", 0) or 0) if account is not None else 0
        if account is not None and endpoint_id > 0:
            scopes.add((endpoint_id, resolve_storage_ops_context_tenant(account)))
    return scopes


@router.get("", response_model=BucketUiTagCatalogResponse)
def get_bucket_ui_tags(
    request: Request,
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
) -> BucketUiTagCatalogResponse:
    return BucketUiTagsService(db).catalog(
        domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
        actor_user_id=int(user.id),
        allowed_scopes=_authorized_physical_scopes(request=request, user=user, db=db),
    )


@router.patch("", response_model=BucketUiTagCatalogResponse)
def patch_bucket_ui_tags(
    payload: StorageOpsBucketUiTagPatchRequest,
    request: Request,
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
    buckets: BucketsService = Depends(get_buckets_service),
) -> BucketUiTagCatalogResponse:
    refs_by_id = {ref.context_id: ref for ref in _collect_context_refs(user, db)}
    resolved: dict[str, tuple[S3ExecutionContext, set[str]]] = {}
    targets: list[PhysicalBucketTarget] = []
    has_additions = bool(payload.add_tag_ids or payload.create_tags)

    def resolve_ref(context_id: str) -> tuple[S3ExecutionContext, set[str]]:
        cached = resolved.get(context_id)
        if cached is not None:
            return cached
        ref = refs_by_id.get(context_id)
        if ref is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage Ops context is not available.")
        account = _resolve_context_account(ref, request=request, db=db, user=user)
        endpoint_id = int(getattr(account, "storage_endpoint_id", 0) or 0) if account is not None else 0
        if account is None or endpoint_id <= 0:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage Ops context is not available.")
        # Mutations must validate against the storage system itself. Reusing the
        # shared listing cache here could accept a deleted bucket or, more
        # importantly, remove tags from a bucket that was recreated after an
        # earlier empty listing was cached.
        try:
            listed = buckets.list_buckets(account, include=None, with_stats=False)
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=sanitize_error_detail(str(exc)),
            ) from exc
        cached = (account, {str(bucket.name) for bucket in listed})
        resolved[context_id] = cached
        return cached

    for item in payload.targets:
        if item.context_id:
            account, bucket_names = resolve_ref(item.context_id)
            endpoint_id = int(account.storage_endpoint_id or 0)
            tenant = resolve_storage_ops_context_tenant(account)
            exists = item.name in bucket_names
        else:
            if not payload.require_absent or has_additions or item.endpoint_id is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Physical Storage Ops targets are only valid for orphan cleanup.",
                )
            endpoint_id = int(item.endpoint_id)
            tenant = item.tenant
            matching_contexts = 0
            exists = False
            for context_id in refs_by_id:
                account, bucket_names = resolve_ref(context_id)
                if int(account.storage_endpoint_id or 0) != endpoint_id:
                    continue
                if resolve_storage_ops_context_tenant(account) != tenant:
                    continue
                matching_contexts += 1
                exists = exists or item.name in bucket_names
            if matching_contexts == 0:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="No authorized Storage Ops context can verify this bucket.",
                )
        if (has_additions and not exists) or (payload.require_absent and exists):
            detail = (
                "Bucket reappeared; its UI tags were not removed."
                if payload.require_absent
                else "Bucket not found in this Storage Ops context."
            )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)
        targets.append(
            PhysicalBucketTarget.create(
                endpoint_id,
                tenant,
                item.name,
            )
        )

    service = BucketUiTagsService(db)
    try:
        service.mutate(
            domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
            actor_user_id=int(user.id),
            targets=targets,
            add_tag_ids=payload.add_tag_ids,
            create_tags=[
                (item.label, item.color_key, "private")
                for item in payload.create_tags
            ],
            remove_tag_ids=payload.remove_tag_ids,
            remove_all=payload.remove_all,
        )
        service.commit()
    except ValueError as exc:
        service.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    return service.catalog(
        domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
        actor_user_id=int(user.id),
        allowed_scopes=_authorized_physical_scopes(
            request=request,
            user=user,
            db=db,
            refs_by_id=refs_by_id,
            resolved=resolved,
        ),
    )
