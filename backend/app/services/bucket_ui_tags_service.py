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
    BucketUiTagVisibility,
)
from app.services.tags_service import TagsService
from app.utils.tagging import (
    DEFAULT_TAG_SCOPE,
    TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
    TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
    TAG_SCOPE_STANDARD,
    build_tag_label_key,
    tag_definition_sort_key,
)


_BucketUiTagDomain = Literal["bucket_ui_ceph_admin", "bucket_ui_storage_ops"]
_ASSIGNMENT_TARGET_BATCH_SIZE = 200


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


@dataclass(frozen=True)
class _BucketUiTagMutationPlan:
    additions_by_id: dict[int, TagDefinition]
    ids_to_remove: set[int]


@dataclass(frozen=True)
class BucketUiTagDefinitionUpdate:
    definition: BucketUiTagDefinitionSummary
    previous_visibility: BucketUiTagVisibility
    changed_fields: frozenset[str]

    @property
    def involves_shared(self) -> bool:
        return (
            self.previous_visibility == "shared"
            or self.definition.visibility == "shared"
        )


class BucketUiTagDefinitionNotFoundError(LookupError):
    pass


class BucketUiTagNameConflictError(RuntimeError):
    pass


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
    def _validate_domain(domain_kind: str) -> _BucketUiTagDomain:
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
        domain_kind: _BucketUiTagDomain,
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
        domain_kind: _BucketUiTagDomain,
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
        for start in range(0, len(targets), _ASSIGNMENT_TARGET_BATCH_SIZE):
            yield list(targets[start : start + _ASSIGNMENT_TARGET_BATCH_SIZE])

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
        domain_kind: _BucketUiTagDomain,
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

    def _resolve_created_definitions(
        self,
        *,
        domain_kind: _BucketUiTagDomain,
        actor_user_id: int,
        create_tags: Sequence[tuple[str, str, BucketUiTagVisibility]],
    ) -> list[TagDefinition]:
        if domain_kind == TAG_DOMAIN_BUCKET_UI_STORAGE_OPS and any(
            visibility != "private" for _, _, visibility in create_tags
        ):
            raise ValueError("Storage Ops UI tags are always private.")
        definitions: list[TagDefinition] = []
        for label, color_key, visibility in create_tags:
            owner_user_id = None if visibility == "shared" else actor_user_id
            if domain_kind == TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN:
                existing = self.db.query(TagDefinition).filter(
                    TagDefinition.domain_kind == domain_kind,
                    TagDefinition.label_key == build_tag_label_key(label),
                ).first()
                if existing is not None:
                    if existing.owner_user_id != owner_user_id:
                        raise BucketUiTagNameConflictError(
                            "A Ceph Admin UI tag already reserves this name."
                        )
                    definitions.append(existing)
                    continue
            definitions.append(
                self.tags.resolve_definition(
                    domain_kind=domain_kind,
                    owner_user_id=owner_user_id,
                    label=label,
                    color_key=color_key,
                    scope=DEFAULT_TAG_SCOPE,
                    update_existing=False,
                )
            )
        return definitions

    def update_definition(
        self,
        *,
        domain_kind: str,
        actor_user_id: int,
        tag_id: int,
        color_key: str | None = None,
        visibility: BucketUiTagVisibility | None = None,
    ) -> BucketUiTagDefinitionUpdate:
        domain = self._validate_domain(domain_kind)
        definition = self._visible_definition_query(
            domain_kind=domain,
            actor_user_id=actor_user_id,
        ).filter(TagDefinition.id == int(tag_id)).first()
        if definition is None:
            raise BucketUiTagDefinitionNotFoundError(
                "Bucket UI tag definition was not found."
            )
        if domain == TAG_DOMAIN_BUCKET_UI_STORAGE_OPS and visibility is not None:
            raise ValueError("Storage Ops UI tags are always private.")

        previous_visibility: BucketUiTagVisibility = (
            "shared" if definition.owner_user_id is None else "private"
        )
        changed_fields: set[str] = set()
        if color_key is not None and definition.color_key != color_key:
            definition.color_key = color_key
            changed_fields.add("color_key")
        if visibility is not None and visibility != previous_visibility:
            definition.owner_user_id = (
                None if visibility == "shared" else int(actor_user_id)
            )
            changed_fields.add("visibility")
        if changed_fields:
            self.db.add(definition)
            self.db.flush()
        return BucketUiTagDefinitionUpdate(
            definition=self._to_definition(definition),
            previous_visibility=previous_visibility,
            changed_fields=frozenset(changed_fields),
        )

    def _resolve_mutation_plan(
        self,
        *,
        domain_kind: _BucketUiTagDomain,
        actor_user_id: int,
        add_tag_ids: Sequence[int],
        create_tags: Sequence[tuple[str, str, BucketUiTagVisibility]],
        remove_tag_ids: Sequence[int],
        remove_all: bool,
    ) -> _BucketUiTagMutationPlan:
        additions = self._resolve_visible_ids(
            domain_kind=domain_kind,
            actor_user_id=actor_user_id,
            tag_ids=add_tag_ids,
        )
        removals = self._resolve_visible_ids(
            domain_kind=domain_kind,
            actor_user_id=actor_user_id,
            tag_ids=remove_tag_ids,
        )
        additions.extend(
            self._resolve_created_definitions(
                domain_kind=domain_kind,
                actor_user_id=actor_user_id,
                create_tags=create_tags,
            )
        )
        ids_to_remove = {int(row.id) for row in removals}
        if remove_all:
            ids_to_remove = {
                int(row.id)
                for row in self.visible_definitions(
                    domain_kind=domain_kind,
                    actor_user_id=actor_user_id,
                )
            }
        return _BucketUiTagMutationPlan(
            additions_by_id={int(row.id): row for row in additions},
            ids_to_remove=ids_to_remove,
        )

    def _apply_mutation_to_target(
        self,
        *,
        target: PhysicalBucketTarget,
        links: Sequence[BucketUiTagAssignment],
        plan: _BucketUiTagMutationPlan,
    ) -> None:
        existing_by_id = {int(link.tag_definition_id): link for link in links}
        for identifier in plan.ids_to_remove:
            link = existing_by_id.pop(identifier, None)
            if link is not None:
                self.db.delete(link)
        next_position = max(
            (int(link.position or 0) for link in existing_by_id.values()),
            default=-1,
        ) + 1
        for identifier, definition in plan.additions_by_id.items():
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

    def mutate(
        self,
        *,
        domain_kind: str,
        actor_user_id: int,
        targets: Sequence[PhysicalBucketTarget],
        add_tag_ids: Sequence[int],
        create_tags: Sequence[tuple[str, str, BucketUiTagVisibility]],
        remove_tag_ids: Sequence[int],
        remove_all: bool = False,
    ) -> None:
        domain = self._validate_domain(domain_kind)
        unique_targets = list(dict.fromkeys(targets))
        if not unique_targets or len(unique_targets) > _ASSIGNMENT_TARGET_BATCH_SIZE:
            raise ValueError("A bucket UI tag mutation requires 1 to 200 targets.")
        plan = self._resolve_mutation_plan(
            domain_kind=domain,
            actor_user_id=actor_user_id,
            add_tag_ids=add_tag_ids,
            create_tags=create_tags,
            remove_tag_ids=remove_tag_ids,
            remove_all=remove_all,
        )
        links_by_target = self._links_for_targets(unique_targets)
        for target in unique_targets:
            self._apply_mutation_to_target(
                target=target,
                links=links_by_target[target],
                plan=plan,
            )
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
