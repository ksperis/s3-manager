# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Normalize UI tags into shared tag definitions and explicit object links."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0034_normalized_tag_definitions"
down_revision = "0033_object_tags_metadata"
branch_labels = None
depends_on = None


DEFAULT_TAG_COLOR_KEY = "neutral"
TAG_DOMAIN_ENDPOINT = "endpoint"
TAG_DOMAIN_ADMIN_MANAGED = "admin_managed"
TAG_DOMAIN_PRIVATE_CONNECTION_USER = "private_connection_user"


tag_definitions = sa.table(
    "tag_definitions",
    sa.column("id", sa.Integer()),
    sa.column("domain_kind", sa.String()),
    sa.column("owner_user_id", sa.Integer()),
    sa.column("label", sa.String()),
    sa.column("label_key", sa.String()),
    sa.column("color_key", sa.String()),
    sa.column("created_at", sa.DateTime()),
    sa.column("updated_at", sa.DateTime()),
)

storage_endpoints = sa.table(
    "storage_endpoints",
    sa.column("id", sa.Integer()),
    sa.column("tags_json", sa.Text()),
)

s3_accounts = sa.table(
    "s3_accounts",
    sa.column("id", sa.Integer()),
    sa.column("tags_json", sa.Text()),
)

s3_users = sa.table(
    "s3_users",
    sa.column("id", sa.Integer()),
    sa.column("tags_json", sa.Text()),
)

s3_connections = sa.table(
    "s3_connections",
    sa.column("id", sa.Integer()),
    sa.column("created_by_user_id", sa.Integer()),
    sa.column("is_shared", sa.Boolean()),
    sa.column("tags_json", sa.Text()),
)

storage_endpoint_tags = sa.table(
    "storage_endpoint_tags",
    sa.column("storage_endpoint_id", sa.Integer()),
    sa.column("tag_definition_id", sa.Integer()),
    sa.column("position", sa.Integer()),
    sa.column("created_at", sa.DateTime()),
    sa.column("updated_at", sa.DateTime()),
)

s3_account_tags = sa.table(
    "s3_account_tags",
    sa.column("account_id", sa.Integer()),
    sa.column("tag_definition_id", sa.Integer()),
    sa.column("position", sa.Integer()),
    sa.column("created_at", sa.DateTime()),
    sa.column("updated_at", sa.DateTime()),
)

s3_user_tags = sa.table(
    "s3_user_tags",
    sa.column("s3_user_id", sa.Integer()),
    sa.column("tag_definition_id", sa.Integer()),
    sa.column("position", sa.Integer()),
    sa.column("created_at", sa.DateTime()),
    sa.column("updated_at", sa.DateTime()),
)

s3_connection_tags = sa.table(
    "s3_connection_tags",
    sa.column("s3_connection_id", sa.Integer()),
    sa.column("tag_definition_id", sa.Integer()),
    sa.column("position", sa.Integer()),
    sa.column("created_at", sa.DateTime()),
    sa.column("updated_at", sa.DateTime()),
)


def _parse_legacy_tags(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if not isinstance(parsed, list):
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for entry in parsed:
        label = None
        if isinstance(entry, str):
            label = entry
        elif isinstance(entry, dict):
            candidate = entry.get("label")
            if isinstance(candidate, str):
                label = candidate
        if not isinstance(label, str):
            continue
        cleaned = label.strip()
        label_key = cleaned.casefold()
        if not cleaned or label_key in seen:
            continue
        seen.add(label_key)
        normalized.append(cleaned)
    return normalized


def _insert_tag_definition(bind, *, domain_kind: str, owner_user_id: Optional[int], label: str, cache: dict[tuple[str, Optional[int], str], int]) -> int:
    label_key = label.casefold()
    cache_key = (domain_kind, owner_user_id, label_key)
    existing_id = cache.get(cache_key)
    if existing_id is not None:
        return existing_id
    query = sa.select(tag_definitions.c.id).where(
        tag_definitions.c.domain_kind == domain_kind,
        tag_definitions.c.label_key == label_key,
    )
    if owner_user_id is None:
        query = query.where(tag_definitions.c.owner_user_id.is_(None))
    else:
        query = query.where(tag_definitions.c.owner_user_id == owner_user_id)
    found = bind.execute(query).scalar()
    if found is not None:
        cache[cache_key] = int(found)
        return int(found)
    now = datetime.utcnow()
    result = bind.execute(
        tag_definitions.insert().values(
            domain_kind=domain_kind,
            owner_user_id=owner_user_id,
            label=label,
            label_key=label_key,
            color_key=DEFAULT_TAG_COLOR_KEY,
            created_at=now,
            updated_at=now,
        )
    )
    inserted_primary_key = tuple(getattr(result, "inserted_primary_key", ()) or ())
    inserted_id: Optional[int] = None
    if inserted_primary_key and inserted_primary_key[0] is not None:
        inserted_id = int(inserted_primary_key[0])
    else:
        lastrowid = getattr(result, "lastrowid", None)
        if lastrowid is not None:
            inserted_id = int(lastrowid)
        else:
            inserted_id = bind.execute(query).scalar()
            if inserted_id is not None:
                inserted_id = int(inserted_id)
    if inserted_id is None:
        raise RuntimeError(f"Failed to resolve inserted tag_definition id for {domain_kind}:{label_key}")
    cache[cache_key] = inserted_id
    return inserted_id


def _has_table(bind, table_name: str) -> bool:
    return table_name in set(sa.inspect(bind).get_table_names())


def _has_index(bind, table_name: str, index_name: str) -> bool:
    return any(index.get("name") == index_name for index in sa.inspect(bind).get_indexes(table_name))


def _ensure_tag_definitions_schema(bind) -> None:
    if not _has_table(bind, "tag_definitions"):
        op.create_table(
            "tag_definitions",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("domain_kind", sa.String(), nullable=False),
            sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("label", sa.String(), nullable=False),
            sa.Column("label_key", sa.String(), nullable=False),
            sa.Column("color_key", sa.String(), nullable=False, server_default=DEFAULT_TAG_COLOR_KEY),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
    if not _has_index(bind, "tag_definitions", "ix_tag_definitions_domain_owner"):
        op.create_index("ix_tag_definitions_domain_owner", "tag_definitions", ["domain_kind", "owner_user_id"], unique=False)
    if not _has_index(bind, "tag_definitions", "uq_tag_definitions_domain_global_label"):
        op.create_index(
            "uq_tag_definitions_domain_global_label",
            "tag_definitions",
            ["domain_kind", "label_key"],
            unique=True,
            sqlite_where=sa.text("owner_user_id IS NULL"),
            postgresql_where=sa.text("owner_user_id IS NULL"),
        )
    if not _has_index(bind, "tag_definitions", "uq_tag_definitions_domain_owner_label"):
        op.create_index(
            "uq_tag_definitions_domain_owner_label",
            "tag_definitions",
            ["domain_kind", "owner_user_id", "label_key"],
            unique=True,
            sqlite_where=sa.text("owner_user_id IS NOT NULL"),
            postgresql_where=sa.text("owner_user_id IS NOT NULL"),
        )


def _ensure_link_table_schema(
    bind,
    *,
    table_name: str,
    table_factory,
    index_name: str,
    index_columns: list[str],
) -> None:
    if not _has_table(bind, table_name):
        table_factory()
    if not _has_index(bind, table_name, index_name):
        op.create_index(index_name, table_name, index_columns, unique=False)


def upgrade() -> None:
    bind = op.get_bind()
    _ensure_tag_definitions_schema(bind)
    _ensure_link_table_schema(
        bind,
        table_name="storage_endpoint_tags",
        table_factory=lambda: op.create_table(
            "storage_endpoint_tags",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("storage_endpoint_id", sa.Integer(), sa.ForeignKey("storage_endpoints.id", ondelete="CASCADE"), nullable=False),
            sa.Column("tag_definition_id", sa.Integer(), sa.ForeignKey("tag_definitions.id", ondelete="CASCADE"), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("storage_endpoint_id", "tag_definition_id", name="uq_storage_endpoint_tag"),
        ),
        index_name="ix_storage_endpoint_tags_endpoint_position",
        index_columns=["storage_endpoint_id", "position"],
    )
    _ensure_link_table_schema(
        bind,
        table_name="s3_account_tags",
        table_factory=lambda: op.create_table(
            "s3_account_tags",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("account_id", sa.Integer(), sa.ForeignKey("s3_accounts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("tag_definition_id", sa.Integer(), sa.ForeignKey("tag_definitions.id", ondelete="CASCADE"), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("account_id", "tag_definition_id", name="uq_s3_account_tag"),
        ),
        index_name="ix_s3_account_tags_account_position",
        index_columns=["account_id", "position"],
    )
    _ensure_link_table_schema(
        bind,
        table_name="s3_user_tags",
        table_factory=lambda: op.create_table(
            "s3_user_tags",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("s3_user_id", sa.Integer(), sa.ForeignKey("s3_users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("tag_definition_id", sa.Integer(), sa.ForeignKey("tag_definitions.id", ondelete="CASCADE"), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("s3_user_id", "tag_definition_id", name="uq_s3_user_tag"),
        ),
        index_name="ix_s3_user_tags_user_position",
        index_columns=["s3_user_id", "position"],
    )
    _ensure_link_table_schema(
        bind,
        table_name="s3_connection_tags",
        table_factory=lambda: op.create_table(
            "s3_connection_tags",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("s3_connection_id", sa.Integer(), sa.ForeignKey("s3_connections.id", ondelete="CASCADE"), nullable=False),
            sa.Column("tag_definition_id", sa.Integer(), sa.ForeignKey("tag_definitions.id", ondelete="CASCADE"), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("s3_connection_id", "tag_definition_id", name="uq_s3_connection_tag"),
        ),
        index_name="ix_s3_connection_tags_connection_position",
        index_columns=["s3_connection_id", "position"],
    )

    definition_cache: dict[tuple[str, Optional[int], str], int] = {}
    existing_storage_endpoint_links = {
        (int(row.storage_endpoint_id), int(row.tag_definition_id))
        for row in bind.execute(sa.select(storage_endpoint_tags.c.storage_endpoint_id, storage_endpoint_tags.c.tag_definition_id))
    }
    existing_account_links = {
        (int(row.account_id), int(row.tag_definition_id))
        for row in bind.execute(sa.select(s3_account_tags.c.account_id, s3_account_tags.c.tag_definition_id))
    }
    existing_user_links = {
        (int(row.s3_user_id), int(row.tag_definition_id))
        for row in bind.execute(sa.select(s3_user_tags.c.s3_user_id, s3_user_tags.c.tag_definition_id))
    }
    existing_connection_links = {
        (int(row.s3_connection_id), int(row.tag_definition_id))
        for row in bind.execute(sa.select(s3_connection_tags.c.s3_connection_id, s3_connection_tags.c.tag_definition_id))
    }

    for row in bind.execute(sa.select(storage_endpoints.c.id, storage_endpoints.c.tags_json)):
        labels = _parse_legacy_tags(row.tags_json)
        for position, label in enumerate(labels):
            tag_definition_id = _insert_tag_definition(
                bind,
                domain_kind=TAG_DOMAIN_ENDPOINT,
                owner_user_id=None,
                label=label,
                cache=definition_cache,
            )
            link_key = (int(row.id), int(tag_definition_id))
            if link_key in existing_storage_endpoint_links:
                continue
            now = datetime.utcnow()
            bind.execute(
                storage_endpoint_tags.insert().values(
                    storage_endpoint_id=row.id,
                    tag_definition_id=tag_definition_id,
                    position=position,
                    created_at=now,
                    updated_at=now,
                )
            )
            existing_storage_endpoint_links.add(link_key)

    for row in bind.execute(sa.select(s3_accounts.c.id, s3_accounts.c.tags_json)):
        labels = _parse_legacy_tags(row.tags_json)
        for position, label in enumerate(labels):
            tag_definition_id = _insert_tag_definition(
                bind,
                domain_kind=TAG_DOMAIN_ADMIN_MANAGED,
                owner_user_id=None,
                label=label,
                cache=definition_cache,
            )
            link_key = (int(row.id), int(tag_definition_id))
            if link_key in existing_account_links:
                continue
            now = datetime.utcnow()
            bind.execute(
                s3_account_tags.insert().values(
                    account_id=row.id,
                    tag_definition_id=tag_definition_id,
                    position=position,
                    created_at=now,
                    updated_at=now,
                )
            )
            existing_account_links.add(link_key)

    for row in bind.execute(sa.select(s3_users.c.id, s3_users.c.tags_json)):
        labels = _parse_legacy_tags(row.tags_json)
        for position, label in enumerate(labels):
            tag_definition_id = _insert_tag_definition(
                bind,
                domain_kind=TAG_DOMAIN_ADMIN_MANAGED,
                owner_user_id=None,
                label=label,
                cache=definition_cache,
            )
            link_key = (int(row.id), int(tag_definition_id))
            if link_key in existing_user_links:
                continue
            now = datetime.utcnow()
            bind.execute(
                s3_user_tags.insert().values(
                    s3_user_id=row.id,
                    tag_definition_id=tag_definition_id,
                    position=position,
                    created_at=now,
                    updated_at=now,
                )
            )
            existing_user_links.add(link_key)

    for row in bind.execute(sa.select(s3_connections.c.id, s3_connections.c.created_by_user_id, s3_connections.c.is_shared, s3_connections.c.tags_json)):
        labels = _parse_legacy_tags(row.tags_json)
        domain_kind = TAG_DOMAIN_ADMIN_MANAGED if bool(row.is_shared) else TAG_DOMAIN_PRIVATE_CONNECTION_USER
        owner_user_id = None if bool(row.is_shared) else int(row.created_by_user_id)
        for position, label in enumerate(labels):
            tag_definition_id = _insert_tag_definition(
                bind,
                domain_kind=domain_kind,
                owner_user_id=owner_user_id,
                label=label,
                cache=definition_cache,
            )
            link_key = (int(row.id), int(tag_definition_id))
            if link_key in existing_connection_links:
                continue
            now = datetime.utcnow()
            bind.execute(
                s3_connection_tags.insert().values(
                    s3_connection_id=row.id,
                    tag_definition_id=tag_definition_id,
                    position=position,
                    created_at=now,
                    updated_at=now,
                )
            )
            existing_connection_links.add(link_key)


def downgrade() -> None:
    raise RuntimeError("Downgrade is not supported for revision 0034_normalized_tag_definitions")
