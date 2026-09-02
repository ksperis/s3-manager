# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable, Sequence

from sqlalchemy.exc import IntegrityError

from app.core.sensitive_data import sanitized_error_log_detail
from app.models.bucket_ui_tags import (
    BucketUiTagCatalogResponse,
    BucketUiTagDefinitionSummary,
    StorageOpsBucketUiTagDefinitionPatch,
    StorageOpsBucketUiTagPatchRequest,
)
from app.services.bucket_ui_tags_service import (
    BucketUiTagDefinitionNotFoundError,
    BucketUiTagsService,
    PhysicalBucketTarget,
)
from app.services.buckets_service import BucketsService
from app.services.s3_execution_context import S3ExecutionContext
from app.services.storage_ops_bucket_listing_service import (
    StorageOpsContextRef,
    resolve_storage_ops_context_tenant,
)
from app.utils.tagging import TAG_DOMAIN_BUCKET_UI_STORAGE_OPS


class StorageOpsBucketUiTagAuthorizationError(RuntimeError):
    pass


class StorageOpsBucketUiTagConflictError(RuntimeError):
    pass


class StorageOpsBucketUiTagNotFoundError(LookupError):
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
            raise StorageOpsBucketUiTagUpstreamError(sanitized_error_log_detail(exc)) from exc
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

    def _targets(
        self,
        payload: StorageOpsBucketUiTagPatchRequest,
        buckets: BucketsService,
    ) -> list[PhysicalBucketTarget]:
        targets: list[PhysicalBucketTarget] = []
        has_additions = bool(payload.add_tag_ids or payload.create_tags)
        for item in payload.targets:
            target, exists = self._direct_target(
                item.context_id,
                item.name,
                buckets,
            )
            if has_additions and not exists:
                raise StorageOpsBucketUiTagConflictError(
                    "Bucket not found in this Storage Ops context."
                )
            targets.append(target)
        return targets

    def catalog(self) -> BucketUiTagCatalogResponse:
        return self.tags.catalog(
            domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
            actor_user_id=self.actor_user_id,
        )

    def mutate(
        self,
        payload: StorageOpsBucketUiTagPatchRequest,
        buckets: BucketsService,
    ) -> BucketUiTagCatalogResponse:
        try:
            with self.tags.transaction():
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
        except IntegrityError as exc:
            raise StorageOpsBucketUiTagConflictError(
                "A Storage Ops UI tag already reserves this name."
            ) from exc
        return self.catalog()

    def update_definition(
        self,
        tag_id: int,
        payload: StorageOpsBucketUiTagDefinitionPatch,
    ) -> BucketUiTagDefinitionSummary:
        try:
            with self.tags.transaction():
                result = self.tags.update_definition(
                    domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
                    actor_user_id=self.actor_user_id,
                    tag_id=tag_id,
                    color_key=payload.color_key,
                )
        except BucketUiTagDefinitionNotFoundError as exc:
            raise StorageOpsBucketUiTagNotFoundError(sanitized_error_log_detail(exc)) from exc
        return result.definition
