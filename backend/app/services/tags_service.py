# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional, Sequence

from sqlalchemy import exists
from sqlalchemy.orm import Session

from app.db import S3Account, S3AccountTag, S3Connection, S3ConnectionTag, S3User, S3UserTag, StorageEndpoint, StorageEndpointTag, TagDefinition
from app.models.tagging import TagDefinitionSummary
from app.utils.normalize import dump_string_list_json, parse_string_list_json
from app.utils.tagging import (
    DEFAULT_TAG_COLOR_KEY,
    DEFAULT_TAG_SCOPE,
    TAG_DOMAIN_ADMIN_MANAGED,
    TAG_DOMAIN_ENDPOINT,
    TAG_DOMAIN_PRIVATE_CONNECTION_USER,
    TAG_SCOPE_STANDARD,
    build_tag_label_key,
    normalize_tag_items_input,
    tag_definition_sort_key,
)


class TagsService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_definitions(self, *, domain_kind: str, owner_user_id: Optional[int] = None) -> list[TagDefinitionSummary]:
        query = self.db.query(TagDefinition).filter(TagDefinition.domain_kind == domain_kind)
        if owner_user_id is None:
            query = query.filter(TagDefinition.owner_user_id.is_(None))
        else:
            query = query.filter(TagDefinition.owner_user_id == owner_user_id)
        rows = query.all()
        rows.sort(key=tag_definition_sort_key)
        return [self._to_summary(row) for row in rows]

    @staticmethod
    def filter_selector_visible(items: Sequence[TagDefinitionSummary] | None) -> list[TagDefinitionSummary]:
        return [item for item in (items or []) if item.scope == TAG_SCOPE_STANDARD]

    def resolve_connection_domain(self, connection: S3Connection) -> tuple[str, Optional[int]]:
        if bool(connection.is_shared):
            return (TAG_DOMAIN_ADMIN_MANAGED, None)
        return (TAG_DOMAIN_PRIVATE_CONNECTION_USER, int(connection.created_by_user_id))

    def get_storage_endpoint_tags(self, endpoint: StorageEndpoint) -> list[TagDefinitionSummary]:
        return self._serialize_for_parent(
            endpoint,
            link_cls=StorageEndpointTag,
            domain_kind=TAG_DOMAIN_ENDPOINT,
            owner_user_id=None,
        )

    def get_account_tags(self, account: S3Account) -> list[TagDefinitionSummary]:
        return self._serialize_for_parent(
            account,
            link_cls=S3AccountTag,
            domain_kind=TAG_DOMAIN_ADMIN_MANAGED,
            owner_user_id=None,
        )

    def get_s3_user_tags(self, s3_user: S3User) -> list[TagDefinitionSummary]:
        return self._serialize_for_parent(
            s3_user,
            link_cls=S3UserTag,
            domain_kind=TAG_DOMAIN_ADMIN_MANAGED,
            owner_user_id=None,
        )

    def get_connection_tags(self, connection: S3Connection) -> list[TagDefinitionSummary]:
        domain_kind, owner_user_id = self.resolve_connection_domain(connection)
        return self._serialize_for_parent(
            connection,
            link_cls=S3ConnectionTag,
            domain_kind=domain_kind,
            owner_user_id=owner_user_id,
        )

    def replace_storage_endpoint_tags(self, endpoint: StorageEndpoint, tags: object) -> list[TagDefinitionSummary]:
        return self._replace_for_parent(
            endpoint,
            link_cls=StorageEndpointTag,
            domain_kind=TAG_DOMAIN_ENDPOINT,
            owner_user_id=None,
            tags=tags,
        )

    def replace_account_tags(self, account: S3Account, tags: object) -> list[TagDefinitionSummary]:
        return self._replace_for_parent(
            account,
            link_cls=S3AccountTag,
            domain_kind=TAG_DOMAIN_ADMIN_MANAGED,
            owner_user_id=None,
            tags=tags,
        )

    def replace_s3_user_tags(self, s3_user: S3User, tags: object) -> list[TagDefinitionSummary]:
        return self._replace_for_parent(
            s3_user,
            link_cls=S3UserTag,
            domain_kind=TAG_DOMAIN_ADMIN_MANAGED,
            owner_user_id=None,
            tags=tags,
        )

    def replace_connection_tags(self, connection: S3Connection, tags: object) -> list[TagDefinitionSummary]:
        domain_kind, owner_user_id = self.resolve_connection_domain(connection)
        return self._replace_for_parent(
            connection,
            link_cls=S3ConnectionTag,
            domain_kind=domain_kind,
            owner_user_id=owner_user_id,
            tags=tags,
        )

    def cleanup_orphan_definitions(self) -> None:
        orphan_rows = (
            self.db.query(TagDefinition)
            .filter(
                ~exists().where(StorageEndpointTag.tag_definition_id == TagDefinition.id),
                ~exists().where(S3AccountTag.tag_definition_id == TagDefinition.id),
                ~exists().where(S3UserTag.tag_definition_id == TagDefinition.id),
                ~exists().where(S3ConnectionTag.tag_definition_id == TagDefinition.id),
            )
            .all()
        )
        for row in orphan_rows:
            self.db.delete(row)

    def _serialize_for_parent(
        self,
        parent: object,
        *,
        link_cls: type[object],
        domain_kind: str,
        owner_user_id: Optional[int],
    ) -> list[TagDefinitionSummary]:
        if getattr(parent, "tag_links", None) is None:
            return self._legacy_summaries_from_json(getattr(parent, "tags_json", None))
        self._ensure_links_from_legacy_tags(
            parent,
            link_cls=link_cls,
            domain_kind=domain_kind,
            owner_user_id=owner_user_id,
        )
        links = sorted(
            list(getattr(parent, "tag_links", []) or []),
            key=lambda item: (int(getattr(item, "position", 0) or 0), int(getattr(item, "id", 0) or 0)),
        )
        return [self._to_summary(link.tag_definition) for link in links if getattr(link, "tag_definition", None) is not None]

    def _replace_for_parent(
        self,
        parent: object,
        *,
        link_cls: type[object],
        domain_kind: str,
        owner_user_id: Optional[int],
        tags: object,
    ) -> list[TagDefinitionSummary]:
        normalized = normalize_tag_items_input(tags, allow_none=False) or []
        definitions = [
            self._resolve_definition(
                domain_kind=domain_kind,
                owner_user_id=owner_user_id,
                label=item["label"],
                color_key=item["color_key"],
                scope=item["scope"],
            )
            for item in normalized
        ]
        existing_links = list(getattr(parent, "tag_links", []) or [])
        existing_by_tag_id = {
            int(link.tag_definition_id or getattr(getattr(link, "tag_definition", None), "id", 0)): link
            for link in existing_links
            if (link.tag_definition_id or getattr(getattr(link, "tag_definition", None), "id", None)) is not None
        }
        next_links: list[object] = []
        for position, definition in enumerate(definitions):
            link = existing_by_tag_id.get(definition.id)
            if link is None:
                link = link_cls(tag_definition_id=definition.id, position=position)
            link.tag_definition = definition
            link.position = position
            next_links.append(link)
        setattr(parent, "tag_links", next_links)
        parent.tags_json = dump_string_list_json([item["label"] for item in normalized])
        self.db.add(parent)
        self.db.flush()
        self.cleanup_orphan_definitions()
        return [self._to_summary(definition) for definition in definitions]

    def _ensure_links_from_legacy_tags(
        self,
        parent: object,
        *,
        link_cls: type[object],
        domain_kind: str,
        owner_user_id: Optional[int],
    ) -> None:
        if getattr(parent, "tag_links", None) is None:
            return
        if list(getattr(parent, "tag_links", []) or []):
            return
        legacy_labels = parse_string_list_json(getattr(parent, "tags_json", None))
        if not legacy_labels:
            return
        definitions = [
            self._resolve_definition(
                domain_kind=domain_kind,
                owner_user_id=owner_user_id,
                label=label,
                color_key=DEFAULT_TAG_COLOR_KEY,
                scope=DEFAULT_TAG_SCOPE,
            )
            for label in legacy_labels
        ]
        next_links = []
        for position, definition in enumerate(definitions):
            link = link_cls(tag_definition_id=definition.id, position=position)
            link.tag_definition = definition
            next_links.append(link)
        setattr(parent, "tag_links", next_links)
        self.db.add(parent)
        self.db.flush()

    @staticmethod
    def _legacy_summaries_from_json(raw_tags_json: object) -> list[TagDefinitionSummary]:
        legacy_labels = parse_string_list_json(raw_tags_json)
        return [
            TagDefinitionSummary(
                id=-(position + 1),
                label=label,
                color_key=DEFAULT_TAG_COLOR_KEY,
                scope=DEFAULT_TAG_SCOPE,
            )
            for position, label in enumerate(legacy_labels)
        ]

    def _resolve_definition(
        self,
        *,
        domain_kind: str,
        owner_user_id: Optional[int],
        label: str,
        color_key: str,
        scope: str,
    ) -> TagDefinition:
        label_key = build_tag_label_key(label)
        query = (
            self.db.query(TagDefinition)
            .filter(
                TagDefinition.domain_kind == domain_kind,
                TagDefinition.label_key == label_key,
            )
        )
        if owner_user_id is None:
            query = query.filter(TagDefinition.owner_user_id.is_(None))
        else:
            query = query.filter(TagDefinition.owner_user_id == owner_user_id)
        definition = query.first()
        if definition is None:
            definition = TagDefinition(
                domain_kind=domain_kind,
                owner_user_id=owner_user_id,
                label=label,
                label_key=label_key,
                color_key=color_key,
                scope=scope,
            )
            self.db.add(definition)
            self.db.flush()
            return definition
        definition.label = label
        definition.color_key = color_key
        definition.scope = scope
        self.db.add(definition)
        self.db.flush()
        return definition

    @staticmethod
    def _to_summary(definition: TagDefinition) -> TagDefinitionSummary:
        return TagDefinitionSummary(
            id=definition.id,
            label=definition.label,
            color_key=definition.color_key,
            scope=getattr(definition, "scope", DEFAULT_TAG_SCOPE) or DEFAULT_TAG_SCOPE,
        )


def serialize_tag_summaries(items: Optional[Sequence[TagDefinitionSummary]]) -> list[dict[str, object]]:
    return [item.model_dump() for item in (items or [])]
