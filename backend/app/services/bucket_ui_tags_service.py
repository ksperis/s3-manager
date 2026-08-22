# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal, Sequence

from sqlalchemy import or_, tuple_
from sqlalchemy.orm import Session

from app.db import BucketUiTagAssignment, TagDefinition
from app.models.bucket_ui_tags import (
    BucketUiTagCatalogResponse,
    BucketUiTagDefinitionSummary,
    BucketUiTagOrphanSummary,
    BucketUiTagOrphansResponse,
    BucketUiTagPhysicalTarget,
)
from app.services.tags_service import TagsService
from app.utils.tagging import (
    DEFAULT_TAG_SCOPE,
    TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
    TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
    TAG_SCOPE_STANDARD,
    tag_definition_sort_key,
)


BucketUiTagDomain = Literal["bucket_ui_ceph_admin", "bucket_ui_storage_ops"]
ASSIGNMENT_TARGET_BATCH_SIZE = 200


@dataclass(frozen=True, order=True)
class PhysicalBucketTarget:
    endpoint_id: int
    tenant: str
    name: str

    @classmethod
    def create(cls, endpoint_id: int, tenant: object, name: object) -> "PhysicalBucketTarget":
        return cls(
            endpoint_id=int(endpoint_id),
            tenant=str(tenant or "").strip(),
            name=str(name or "").strip(),
        )


class BucketUiTagsService:
    """Persistent UI-only bucket tags, deliberately separate from S3 object tags."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.tags = TagsService(db)

    def commit(self) -> None:
        """Commit UI-tag persistence at the service boundary."""

        self.db.commit()

    def rollback(self) -> None:
        """Roll back a failed UI-tag mutation at the service boundary."""

        self.db.rollback()

    @staticmethod
    def _validate_domain(domain_kind: str) -> BucketUiTagDomain:
        if domain_kind not in {
            TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
            TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
        }:
            raise ValueError("Unsupported bucket UI tag domain.")
        return domain_kind  # type: ignore[return-value]

    @staticmethod
    def _to_definition(definition: TagDefinition) -> BucketUiTagDefinitionSummary:
        return BucketUiTagDefinitionSummary(
            id=int(definition.id),
            label=definition.label,
            color_key=definition.color_key,
            scope=TAG_SCOPE_STANDARD,
            visibility="shared" if definition.owner_user_id is None else "private",
        )

    def _visible_definition_query(
        self,
        *,
        domain_kind: BucketUiTagDomain,
        actor_user_id: int,
    ):
        query = self.db.query(TagDefinition).filter(TagDefinition.domain_kind == domain_kind)
        if domain_kind == TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN:
            return query.filter(
                or_(
                    TagDefinition.owner_user_id.is_(None),
                    TagDefinition.owner_user_id == actor_user_id,
                )
            )
        return query.filter(TagDefinition.owner_user_id == actor_user_id)

    def _visible_assignment_query(
        self,
        *,
        domain_kind: BucketUiTagDomain,
        actor_user_id: int,
    ):
        query = self.db.query(BucketUiTagAssignment, TagDefinition).join(
            TagDefinition,
            TagDefinition.id == BucketUiTagAssignment.tag_definition_id,
        ).filter(TagDefinition.domain_kind == domain_kind)
        if domain_kind == TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN:
            return query.filter(
                or_(
                    TagDefinition.owner_user_id.is_(None),
                    TagDefinition.owner_user_id == actor_user_id,
                )
            )
        return query.filter(TagDefinition.owner_user_id == actor_user_id)

    @staticmethod
    def _target_batches(
        targets: Sequence[PhysicalBucketTarget],
    ) -> Iterable[list[PhysicalBucketTarget]]:
        for start in range(0, len(targets), ASSIGNMENT_TARGET_BATCH_SIZE):
            yield list(targets[start : start + ASSIGNMENT_TARGET_BATCH_SIZE])

    @staticmethod
    def _target_filter(batch: Sequence[PhysicalBucketTarget]):
        return tuple_(
            BucketUiTagAssignment.storage_endpoint_id,
            BucketUiTagAssignment.tenant_key,
            BucketUiTagAssignment.bucket_name,
        ).in_([(item.endpoint_id, item.tenant, item.name) for item in batch])

    def visible_definitions(
        self,
        *,
        domain_kind: str,
        actor_user_id: int,
    ) -> list[TagDefinition]:
        domain = self._validate_domain(domain_kind)
        rows = self._visible_definition_query(
            domain_kind=domain,
            actor_user_id=actor_user_id,
        ).all()
        rows.sort(key=tag_definition_sort_key)
        return rows

    def catalog(
        self,
        *,
        domain_kind: str,
        actor_user_id: int,
    ) -> BucketUiTagCatalogResponse:
        definitions = self.visible_definitions(
            domain_kind=domain_kind,
            actor_user_id=actor_user_id,
        )
        return BucketUiTagCatalogResponse(
            definitions=[self._to_definition(row) for row in definitions]
        )

    def visible_assignments(
        self,
        *,
        domain_kind: str,
        actor_user_id: int,
        endpoint_id: int | None = None,
        allowed_scopes: set[tuple[int, str]] | None = None,
    ) -> dict[PhysicalBucketTarget, list[BucketUiTagDefinitionSummary]]:
        domain = self._validate_domain(domain_kind)
        if allowed_scopes is not None and not allowed_scopes:
            return {}
        query = self._visible_assignment_query(
            domain_kind=domain,
            actor_user_id=actor_user_id,
        )
        if endpoint_id is not None:
            query = query.filter(BucketUiTagAssignment.storage_endpoint_id == int(endpoint_id))
        if allowed_scopes is not None:
            query = query.filter(
                tuple_(
                    BucketUiTagAssignment.storage_endpoint_id,
                    BucketUiTagAssignment.tenant_key,
                ).in_(sorted(allowed_scopes))
            )
        rows = query.order_by(
            BucketUiTagAssignment.storage_endpoint_id.asc(),
            BucketUiTagAssignment.tenant_key.asc(),
            BucketUiTagAssignment.bucket_name.asc(),
            BucketUiTagAssignment.position.asc(),
            BucketUiTagAssignment.id.asc(),
        ).all()
        grouped: dict[PhysicalBucketTarget, list[BucketUiTagDefinitionSummary]] = {}
        for assignment, definition in rows:
            target = PhysicalBucketTarget.create(
                assignment.storage_endpoint_id,
                assignment.tenant_key,
                assignment.bucket_name,
            )
            grouped.setdefault(target, []).append(self._to_definition(definition))
        return grouped

    def orphans(
        self,
        *,
        domain_kind: str,
        actor_user_id: int,
        existing_targets: set[PhysicalBucketTarget],
        endpoint_id: int | None = None,
        allowed_scopes: set[tuple[int, str]] | None = None,
    ) -> BucketUiTagOrphansResponse:
        assignments = self.visible_assignments(
            domain_kind=domain_kind,
            actor_user_id=actor_user_id,
            endpoint_id=endpoint_id,
            allowed_scopes=allowed_scopes,
        )
        return BucketUiTagOrphansResponse(
            orphans=[
                BucketUiTagOrphanSummary(
                    target=BucketUiTagPhysicalTarget(
                        endpoint_id=target.endpoint_id,
                        tenant=target.tenant,
                        name=target.name,
                    ),
                    tags=tags,
                )
                for target, tags in assignments.items()
                if target not in existing_targets
            ],
        )

    def _links_for_targets(
        self,
        targets: Sequence[PhysicalBucketTarget],
    ) -> dict[PhysicalBucketTarget, list[BucketUiTagAssignment]]:
        grouped = {target: [] for target in targets}
        for batch in self._target_batches(targets):
            rows = self.db.query(BucketUiTagAssignment).filter(
                self._target_filter(batch)
            ).all()
            for row in rows:
                target = PhysicalBucketTarget.create(
                    row.storage_endpoint_id,
                    row.tenant_key,
                    row.bucket_name,
                )
                grouped[target].append(row)
        return grouped

    def _resolve_visible_ids(
        self,
        *,
        domain_kind: BucketUiTagDomain,
        actor_user_id: int,
        tag_ids: Iterable[int],
    ) -> list[TagDefinition]:
        requested = list(dict.fromkeys(int(item) for item in tag_ids))
        if not requested:
            return []
        rows = self._visible_definition_query(
            domain_kind=domain_kind,
            actor_user_id=actor_user_id,
        ).filter(TagDefinition.id.in_(requested)).all()
        by_id = {int(row.id): row for row in rows}
        if any(identifier not in by_id for identifier in requested):
            raise ValueError("One or more UI tag identifiers are not visible.")
        return [by_id[identifier] for identifier in requested]

    def mutate(
        self,
        *,
        domain_kind: str,
        actor_user_id: int,
        targets: Sequence[PhysicalBucketTarget],
        add_tag_ids: Sequence[int],
        create_tags: Sequence[tuple[str, str, Literal["private", "shared"]]],
        remove_tag_ids: Sequence[int],
        remove_all: bool = False,
    ) -> None:
        domain = self._validate_domain(domain_kind)
        unique_targets = list(dict.fromkeys(targets))
        if not unique_targets or len(unique_targets) > 200:
            raise ValueError("A bucket UI tag mutation requires 1 to 200 targets.")

        additions = self._resolve_visible_ids(
            domain_kind=domain,
            actor_user_id=actor_user_id,
            tag_ids=add_tag_ids,
        )
        removals = self._resolve_visible_ids(
            domain_kind=domain,
            actor_user_id=actor_user_id,
            tag_ids=remove_tag_ids,
        )
        if domain == TAG_DOMAIN_BUCKET_UI_STORAGE_OPS and any(
            visibility != "private" for _, _, visibility in create_tags
        ):
            raise ValueError("Storage Ops UI tags are always private.")
        for label, color_key, visibility in create_tags:
            owner_user_id = None if visibility == "shared" else actor_user_id
            definition = self.tags.resolve_definition(
                domain_kind=domain,
                owner_user_id=owner_user_id,
                label=label,
                color_key=color_key,
                scope=DEFAULT_TAG_SCOPE,
                update_existing=False,
            )
            additions.append(definition)

        add_by_id = {int(row.id): row for row in additions}
        remove_ids = {int(row.id) for row in removals}
        visible_ids = {
            int(row.id)
            for row in self.visible_definitions(
                domain_kind=domain,
                actor_user_id=actor_user_id,
            )
        }
        links_by_target = self._links_for_targets(unique_targets)
        for target in unique_targets:
            links = links_by_target[target]
            existing_by_id = {int(link.tag_definition_id): link for link in links}
            ids_to_remove = visible_ids if remove_all else remove_ids
            for identifier in ids_to_remove:
                link = existing_by_id.pop(identifier, None)
                if link is not None:
                    self.db.delete(link)
            next_position = max(
                (int(link.position or 0) for link in existing_by_id.values()),
                default=-1,
            ) + 1
            for identifier, definition in add_by_id.items():
                if identifier in existing_by_id:
                    continue
                self.db.add(
                    BucketUiTagAssignment(
                        storage_endpoint_id=target.endpoint_id,
                        tenant_key=target.tenant,
                        bucket_name=target.name,
                        tag_definition=definition,
                        position=next_position,
                    )
                )
                next_position += 1
        self.db.flush()
        self.tags.cleanup_orphan_definitions(domain_kinds=[domain])

    def get_tags_for_targets(
        self,
        *,
        domain_kind: str,
        actor_user_id: int,
        targets: Sequence[PhysicalBucketTarget],
    ) -> dict[PhysicalBucketTarget, list[BucketUiTagDefinitionSummary]]:
        unique_targets = list(dict.fromkeys(targets))
        result = {target: [] for target in unique_targets}
        if not unique_targets:
            return result
        domain = self._validate_domain(domain_kind)
        for batch in self._target_batches(unique_targets):
            rows = self._visible_assignment_query(
                domain_kind=domain,
                actor_user_id=actor_user_id,
            ).filter(self._target_filter(batch)).order_by(
                BucketUiTagAssignment.position.asc(),
                BucketUiTagAssignment.id.asc(),
            ).all()
            for assignment, definition in rows:
                target = PhysicalBucketTarget.create(
                    assignment.storage_endpoint_id,
                    assignment.tenant_key,
                    assignment.bucket_name,
                )
                result[target].append(self._to_definition(definition))
        return result

    def remove_all_namespaces_for_bucket(self, target: PhysicalBucketTarget) -> None:
        definition_ids = [
            row[0]
            for row in self.db.query(TagDefinition.id).filter(
                TagDefinition.domain_kind.in_(
                    [TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN, TAG_DOMAIN_BUCKET_UI_STORAGE_OPS]
                )
            ).all()
        ]
        if definition_ids:
            self.db.query(BucketUiTagAssignment).filter(
                BucketUiTagAssignment.storage_endpoint_id == target.endpoint_id,
                BucketUiTagAssignment.tenant_key == target.tenant,
                BucketUiTagAssignment.bucket_name == target.name,
                BucketUiTagAssignment.tag_definition_id.in_(definition_ids),
            ).delete(synchronize_session=False)
            self.tags.cleanup_orphan_definitions(
                domain_kinds=[
                    TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
                    TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
                ]
            )
