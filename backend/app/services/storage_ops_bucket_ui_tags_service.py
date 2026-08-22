# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable, Sequence

from app.models.bucket_ui_tags import (
    BucketUiTagCatalogResponse,
    BucketUiTagOrphansResponse,
    StorageOpsBucketUiTagPatchRequest,
)
from app.services.bucket_listing_cache import get_cached_bucket_listing_for_account
from app.services.bucket_ui_tags_service import BucketUiTagsService, PhysicalBucketTarget
from app.services.buckets_service import BucketsService
from app.services.s3_execution_context import S3ExecutionContext
from app.services.storage_ops_bucket_listing_service import (
    StorageOpsContextRef,
    resolve_storage_ops_context_tenant,
)
from app.utils.tagging import TAG_DOMAIN_BUCKET_UI_STORAGE_OPS


class StorageOpsBucketUiTagAuthorizationError(RuntimeError):
    pass


class StorageOpsBucketUiTagTargetError(RuntimeError):
    pass


class StorageOpsBucketUiTagConflictError(RuntimeError):
    pass


class StorageOpsBucketUiTagUpstreamError(RuntimeError):
    pass


class StorageOpsBucketUiTagsWorkflow:
    """Authorize physical Storage Ops targets and persist their private UI tags."""

    def __init__(
        self,
        *,
        tags: BucketUiTagsService,
        actor_user_id: int,
        context_refs: Sequence[StorageOpsContextRef],
        resolve_account: Callable[[StorageOpsContextRef], S3ExecutionContext | None],
    ) -> None:
        self.tags = tags
        self.actor_user_id = int(actor_user_id)
        self.refs_by_id = {ref.context_id: ref for ref in context_refs}
        self.resolve_account = resolve_account
        self.resolved: dict[str, tuple[S3ExecutionContext, set[str]]] = {}

    def _account_for_ref(self, ref: StorageOpsContextRef) -> S3ExecutionContext | None:
        cached = self.resolved.get(ref.context_id)
        return cached[0] if cached is not None else self.resolve_account(ref)

    def _bucket_inventory(
        self,
        context_id: str,
        buckets: BucketsService,
    ) -> tuple[S3ExecutionContext, set[str]]:
        cached = self.resolved.get(context_id)
        if cached is not None:
            return cached
        ref = self.refs_by_id.get(context_id)
        if ref is None:
            raise StorageOpsBucketUiTagAuthorizationError(
                "Storage Ops context is not available."
            )
        account = self.resolve_account(ref)
        endpoint_id = (
            int(getattr(account, "storage_endpoint_id", 0) or 0)
            if account is not None
            else 0
        )
        if account is None or endpoint_id <= 0:
            raise StorageOpsBucketUiTagAuthorizationError(
                "Storage Ops context is not available."
            )
        # Mutations intentionally bypass the shared listing cache. Otherwise a
        # deleted or recreated bucket could be accepted from stale inventory.
        try:
            listed = buckets.list_buckets(account, include=None, with_stats=False)
        except RuntimeError as exc:
            raise StorageOpsBucketUiTagUpstreamError(str(exc)) from exc
        inventory = (account, {str(bucket.name) for bucket in listed})
        self.resolved[context_id] = inventory
        return inventory

    def _direct_target(
        self,
        context_id: str,
        bucket_name: str,
        buckets: BucketsService,
    ) -> tuple[PhysicalBucketTarget, bool]:
        account, bucket_names = self._bucket_inventory(context_id, buckets)
        return (
            PhysicalBucketTarget.create(
                int(account.storage_endpoint_id or 0),
                resolve_storage_ops_context_tenant(account),
                bucket_name,
            ),
            bucket_name in bucket_names,
        )

    def _orphan_target(
        self,
        *,
        endpoint_id: int,
        tenant: str,
        bucket_name: str,
        buckets: BucketsService,
    ) -> tuple[PhysicalBucketTarget, bool]:
        matching_contexts = 0
        exists = False
        for context_id in self.refs_by_id:
            account, bucket_names = self._bucket_inventory(context_id, buckets)
            if int(account.storage_endpoint_id or 0) != endpoint_id:
                continue
            if resolve_storage_ops_context_tenant(account) != tenant:
                continue
            matching_contexts += 1
            exists = exists or bucket_name in bucket_names
        if matching_contexts == 0:
            raise StorageOpsBucketUiTagAuthorizationError(
                "No authorized Storage Ops context can verify this bucket."
            )
        return PhysicalBucketTarget.create(endpoint_id, tenant, bucket_name), exists

    def _targets(
        self,
        payload: StorageOpsBucketUiTagPatchRequest,
        buckets: BucketsService,
    ) -> list[PhysicalBucketTarget]:
        targets: list[PhysicalBucketTarget] = []
        has_additions = bool(payload.add_tag_ids or payload.create_tags)
        for item in payload.targets:
            if item.context_id:
                target, exists = self._direct_target(
                    item.context_id,
                    item.name,
                    buckets,
                )
            else:
                if not payload.require_absent or has_additions or item.endpoint_id is None:
                    raise StorageOpsBucketUiTagTargetError(
                        "Physical Storage Ops targets are only valid for orphan cleanup."
                    )
                target, exists = self._orphan_target(
                    endpoint_id=int(item.endpoint_id),
                    tenant=item.tenant,
                    bucket_name=item.name,
                    buckets=buckets,
                )
            if (has_additions and not exists) or (payload.require_absent and exists):
                detail = (
                    "Bucket reappeared; its UI tags were not removed."
                    if payload.require_absent
                    else "Bucket not found in this Storage Ops context."
                )
                raise StorageOpsBucketUiTagConflictError(detail)
            targets.append(target)
        return targets

    def allowed_scopes(self) -> set[tuple[int, str]]:
        scopes: set[tuple[int, str]] = set()
        for ref in self.refs_by_id.values():
            account = self._account_for_ref(ref)
            endpoint_id = (
                int(getattr(account, "storage_endpoint_id", 0) or 0)
                if account is not None
                else 0
            )
            if account is not None and endpoint_id > 0:
                scopes.add(
                    (endpoint_id, resolve_storage_ops_context_tenant(account))
                )
        return scopes

    def catalog(self) -> BucketUiTagCatalogResponse:
        return self.tags.catalog(
            domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
            actor_user_id=self.actor_user_id,
        )

    def orphans(self, buckets: BucketsService) -> BucketUiTagOrphansResponse:
        existing_targets: set[PhysicalBucketTarget] = set()
        allowed_scopes: set[tuple[int, str]] = set()
        for ref in self.refs_by_id.values():
            account = self._account_for_ref(ref)
            endpoint_id = (
                int(getattr(account, "storage_endpoint_id", 0) or 0)
                if account is not None
                else 0
            )
            if account is None or endpoint_id <= 0:
                continue
            tenant = resolve_storage_ops_context_tenant(account)
            allowed_scopes.add((endpoint_id, tenant))
            try:
                listed = get_cached_bucket_listing_for_account(
                    account=account,
                    include=set(),
                    with_stats=False,
                    builder=lambda account=account: buckets.list_buckets(
                        account,
                        include=None,
                        with_stats=False,
                    ),
                )
            except RuntimeError as exc:
                raise StorageOpsBucketUiTagUpstreamError(str(exc)) from exc
            existing_targets.update(
                PhysicalBucketTarget.create(endpoint_id, tenant, bucket.name)
                for bucket in listed
            )
        return self.tags.orphans(
            domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
            actor_user_id=self.actor_user_id,
            allowed_scopes=allowed_scopes,
            existing_targets=existing_targets,
        )

    def mutate(
        self,
        payload: StorageOpsBucketUiTagPatchRequest,
        buckets: BucketsService,
    ) -> BucketUiTagCatalogResponse:
        try:
            self.tags.mutate(
                domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
                actor_user_id=self.actor_user_id,
                targets=self._targets(payload, buckets),
                add_tag_ids=payload.add_tag_ids,
                create_tags=[
                    (item.label, item.color_key, "private")
                    for item in payload.create_tags
                ],
                remove_tag_ids=payload.remove_tag_ids,
                remove_all=payload.remove_all,
            )
            self.tags.commit()
        except ValueError:
            self.tags.rollback()
            raise
        return self.catalog()
