# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Protocol

from sqlalchemy.exc import IntegrityError

from app.models.bucket_ui_tags import (
    BucketUiTagCatalogResponse,
    BucketUiTagDefinitionSummary,
    CephAdminBucketUiTagDefinitionPatch,
    CephAdminBucketUiTagPatchRequest,
)
from app.services.bucket_ui_tags_service import (
    BucketUiTagDefinitionNotFoundError,
    BucketUiTagDefinitionUpdate,
    BucketUiTagNameConflictError,
    BucketUiTagsService,
    PhysicalBucketTarget,
)
from app.services.rgw_admin import RGWAdminError
from app.utils.tagging import TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN


class CephAdminBucketInfoReader(Protocol):
    def get_bucket_info(
        self,
        bucket: str,
        *,
        tenant: str | None,
        stats: bool,
        allow_not_found: bool,
    ) -> object: ...


class CephAdminBucketUiTagConflictError(RuntimeError):
    pass


class CephAdminBucketUiTagNotFoundError(LookupError):
    pass


class CephAdminBucketUiTagUpstreamError(RuntimeError):
    pass


class CephAdminBucketUiTagsWorkflow:
    """Validate Ceph bucket targets and persist their private or shared UI tags."""

    def __init__(
        self,
        *,
        tags: BucketUiTagsService,
        actor_user_id: int,
        endpoint_id: int,
        bucket_info: CephAdminBucketInfoReader,
        record_shared_mutation: Callable[[int], None],
        record_shared_definition_mutation: Callable[
            [BucketUiTagDefinitionUpdate], None
        ],
    ) -> None:
        self.tags = tags
        self.actor_user_id = int(actor_user_id)
        self.endpoint_id = int(endpoint_id)
        self.bucket_info = bucket_info
        self.record_shared_mutation = record_shared_mutation
        self.record_shared_definition_mutation = record_shared_definition_mutation

    def catalog(self) -> BucketUiTagCatalogResponse:
        return self.tags.catalog(
            domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
            actor_user_id=self.actor_user_id,
        )

    def _targets(
        self,
        payload: CephAdminBucketUiTagPatchRequest,
    ) -> list[PhysicalBucketTarget]:
        return [
            PhysicalBucketTarget.create(
                self.endpoint_id,
                target.tenant,
                target.name,
            )
            for target in payload.targets
        ]

    def _bucket_exists(self, target: PhysicalBucketTarget) -> bool:
        try:
            payload = self.bucket_info.get_bucket_info(
                target.name,
                tenant=target.tenant or None,
                stats=False,
                allow_not_found=True,
            )
        except RGWAdminError as exc:
            raise CephAdminBucketUiTagUpstreamError(str(exc)) from exc
        return isinstance(payload, dict) and bool(payload) and not payload.get("not_found")

    def _validate_targets(
        self,
        payload: CephAdminBucketUiTagPatchRequest,
        targets: Sequence[PhysicalBucketTarget],
    ) -> None:
        has_additions = bool(payload.add_tag_ids or payload.create_tags)
        for target in targets:
            exists = self._bucket_exists(target)
            if has_additions and not exists:
                raise CephAdminBucketUiTagConflictError("Bucket not found.")

    def _has_shared_mutation(
        self,
        payload: CephAdminBucketUiTagPatchRequest,
        targets: Sequence[PhysicalBucketTarget],
    ) -> bool:
        visible_by_id = {
            int(row.id): row
            for row in self.tags.visible_definitions(
                domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
                actor_user_id=self.actor_user_id,
            )
        }
        requested_ids = set(payload.add_tag_ids) | set(payload.remove_tag_ids)
        if any(
            identifier in visible_by_id
            and visible_by_id[identifier].owner_user_id is None
            for identifier in requested_ids
        ) or any(item.visibility == "shared" for item in payload.create_tags):
            return True
        if not payload.remove_all:
            return False
        current = self.tags.get_tags_for_targets(
            domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
            actor_user_id=self.actor_user_id,
            targets=targets,
        )
        return any(
            tag.visibility == "shared"
            for target_tags in current.values()
            for tag in target_tags
        )

    def mutate(
        self,
        payload: CephAdminBucketUiTagPatchRequest,
    ) -> BucketUiTagCatalogResponse:
        targets = self._targets(payload)
        self._validate_targets(payload, targets)
        shared_mutation = self._has_shared_mutation(payload, targets)
        try:
            with self.tags.transaction():
                self.tags.mutate(
                    domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
                    actor_user_id=self.actor_user_id,
                    targets=targets,
                    add_tag_ids=payload.add_tag_ids,
                    create_tags=[
                        (item.label, item.color_key, item.visibility)
                        for item in payload.create_tags
                    ],
                    remove_tag_ids=payload.remove_tag_ids,
                    remove_all=payload.remove_all,
                )
            # Persist before the best-effort audit callback, which can roll back
            # its request session if audit persistence itself fails.
            if shared_mutation:
                self.record_shared_mutation(len(set(targets)))
        except BucketUiTagNameConflictError as exc:
            raise CephAdminBucketUiTagConflictError(str(exc)) from exc
        except IntegrityError as exc:
            raise CephAdminBucketUiTagConflictError(
                "A Ceph Admin UI tag already reserves this name."
            ) from exc
        return self.catalog()

    def update_definition(
        self,
        tag_id: int,
        payload: CephAdminBucketUiTagDefinitionPatch,
    ) -> BucketUiTagDefinitionSummary:
        try:
            with self.tags.transaction():
                result = self.tags.update_definition(
                    domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
                    actor_user_id=self.actor_user_id,
                    tag_id=tag_id,
                    color_key=payload.color_key,
                    visibility=payload.visibility,
                )
        except BucketUiTagDefinitionNotFoundError as exc:
            raise CephAdminBucketUiTagNotFoundError(str(exc)) from exc
        except IntegrityError as exc:
            raise CephAdminBucketUiTagConflictError(
                "A Ceph Admin UI tag already reserves this name."
            ) from exc
        if result.changed_fields and result.involves_shared:
            self.record_shared_definition_mutation(result)
        return result.definition
