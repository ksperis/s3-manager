# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Backfill backend legacy compatibility before runtime fallback removal."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from alembic import op
import sqlalchemy as sa
import yaml


revision = "0059_backend_legacy_compat_backfill"
down_revision = "0058_portal_storage_space_share_scope"
branch_labels = None
depends_on = None


DEFAULT_TAG_COLOR_KEY = "neutral"
DEFAULT_TAG_SCOPE = "standard"
TAG_DOMAIN_ENDPOINT = "endpoint"
TAG_DOMAIN_ADMIN_MANAGED = "admin_managed"
TAG_DOMAIN_PRIVATE_CONNECTION_USER = "private_connection_user"
FEATURE_KEYS = (
    "admin",
    "account",
    "sts",
    "usage",
    "metrics",
    "static_website",
    "iam",
    "sns",
    "sse",
    "replication",
    "healthcheck",
)


tag_definitions = sa.table(
    "tag_definitions",
    sa.column("id", sa.Integer()),
    sa.column("domain_kind", sa.String()),
    sa.column("owner_user_id", sa.Integer()),
    sa.column("label", sa.String()),
    sa.column("label_key", sa.String()),
    sa.column("color_key", sa.String()),
    sa.column("scope", sa.String()),
    sa.column("created_at", sa.DateTime()),
    sa.column("updated_at", sa.DateTime()),
)

storage_endpoints = sa.table(
    "storage_endpoints",
    sa.column("id", sa.Integer()),
    sa.column("provider", sa.String()),
    sa.column("features_config", sa.Text()),
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

portal_storage_space_metadata = sa.table(
    "portal_storage_space_metadata",
    sa.column("origin", sa.String()),
)


def _has_table(bind, table_name: str) -> bool:
    return table_name in set(sa.inspect(bind).get_table_names())


def _has_column(bind, table_name: str, column_name: str) -> bool:
    if not _has_table(bind, table_name):
        return False
    return column_name in {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


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
        label = entry if isinstance(entry, str) else entry.get("label") if isinstance(entry, dict) else None
        if not isinstance(label, str):
            continue
        cleaned = label.strip()
        label_key = cleaned.casefold()
        if not cleaned or label_key in seen:
            continue
        seen.add(label_key)
        normalized.append(cleaned)
    return normalized


def _insert_tag_definition(
    bind,
    *,
    domain_kind: str,
    owner_user_id: Optional[int],
    label: str,
    cache: dict[tuple[str, Optional[int], str], int],
) -> int:
    label_key = label.casefold()
    cache_key = (domain_kind, owner_user_id, label_key)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
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
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    result = bind.execute(
        tag_definitions.insert().values(
            domain_kind=domain_kind,
            owner_user_id=owner_user_id,
            label=label,
            label_key=label_key,
            color_key=DEFAULT_TAG_COLOR_KEY,
            scope=DEFAULT_TAG_SCOPE,
            created_at=now,
            updated_at=now,
        )
    )
    primary_key = tuple(getattr(result, "inserted_primary_key", ()) or ())
    inserted_id = primary_key[0] if primary_key and primary_key[0] is not None else getattr(result, "lastrowid", None)
    if inserted_id is None:
        inserted_id = bind.execute(query).scalar()
    if inserted_id is None:
        raise RuntimeError(f"Failed to resolve inserted tag_definition id for {domain_kind}:{label_key}")
    cache[cache_key] = int(inserted_id)
    return int(inserted_id)


def _parent_has_links(bind, link_table, parent_column, parent_id: int) -> bool:
    return (
        bind.execute(
            sa.select(sa.literal(1))
            .select_from(link_table)
            .where(parent_column == parent_id)
            .limit(1)
        ).first()
        is not None
    )


def _insert_tag_link(bind, link_table, values: dict[str, Any]) -> None:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    bind.execute(link_table.insert().values(**values, created_at=now, updated_at=now))


def _backfill_tags_json_links(bind) -> None:
    if not _has_table(bind, "tag_definitions"):
        return
    cache: dict[tuple[str, Optional[int], str], int] = {}
    if _has_table(bind, "storage_endpoint_tags"):
        for row in bind.execute(sa.select(storage_endpoints.c.id, storage_endpoints.c.tags_json)):
            if _parent_has_links(bind, storage_endpoint_tags, storage_endpoint_tags.c.storage_endpoint_id, int(row.id)):
                continue
            for position, label in enumerate(_parse_legacy_tags(row.tags_json)):
                tag_definition_id = _insert_tag_definition(
                    bind,
                    domain_kind=TAG_DOMAIN_ENDPOINT,
                    owner_user_id=None,
                    label=label,
                    cache=cache,
                )
                _insert_tag_link(
                    bind,
                    storage_endpoint_tags,
                    {
                        "storage_endpoint_id": row.id,
                        "tag_definition_id": tag_definition_id,
                        "position": position,
                    },
                )
    if _has_table(bind, "s3_account_tags"):
        for row in bind.execute(sa.select(s3_accounts.c.id, s3_accounts.c.tags_json)):
            if _parent_has_links(bind, s3_account_tags, s3_account_tags.c.account_id, int(row.id)):
                continue
            for position, label in enumerate(_parse_legacy_tags(row.tags_json)):
                tag_definition_id = _insert_tag_definition(
                    bind,
                    domain_kind=TAG_DOMAIN_ADMIN_MANAGED,
                    owner_user_id=None,
                    label=label,
                    cache=cache,
                )
                _insert_tag_link(
                    bind,
                    s3_account_tags,
                    {"account_id": row.id, "tag_definition_id": tag_definition_id, "position": position},
                )
    if _has_table(bind, "s3_user_tags"):
        for row in bind.execute(sa.select(s3_users.c.id, s3_users.c.tags_json)):
            if _parent_has_links(bind, s3_user_tags, s3_user_tags.c.s3_user_id, int(row.id)):
                continue
            for position, label in enumerate(_parse_legacy_tags(row.tags_json)):
                tag_definition_id = _insert_tag_definition(
                    bind,
                    domain_kind=TAG_DOMAIN_ADMIN_MANAGED,
                    owner_user_id=None,
                    label=label,
                    cache=cache,
                )
                _insert_tag_link(
                    bind,
                    s3_user_tags,
                    {"s3_user_id": row.id, "tag_definition_id": tag_definition_id, "position": position},
                )
    if _has_table(bind, "s3_connection_tags"):
        for row in bind.execute(sa.select(s3_connections.c.id, s3_connections.c.created_by_user_id, s3_connections.c.is_shared, s3_connections.c.tags_json)):
            if _parent_has_links(bind, s3_connection_tags, s3_connection_tags.c.s3_connection_id, int(row.id)):
                continue
            is_shared = bool(row.is_shared)
            domain_kind = TAG_DOMAIN_ADMIN_MANAGED if is_shared else TAG_DOMAIN_PRIVATE_CONNECTION_USER
            owner_user_id = None if is_shared else int(row.created_by_user_id)
            for position, label in enumerate(_parse_legacy_tags(row.tags_json)):
                tag_definition_id = _insert_tag_definition(
                    bind,
                    domain_kind=domain_kind,
                    owner_user_id=owner_user_id,
                    label=label,
                    cache=cache,
                )
                _insert_tag_link(
                    bind,
                    s3_connection_tags,
                    {"s3_connection_id": row.id, "tag_definition_id": tag_definition_id, "position": position},
                )


def _parse_features_config(raw: Optional[str]) -> dict[str, Any]:
    if not raw or not raw.strip():
        return {}
    try:
        data = yaml.safe_load(raw)
    except yaml.YAMLError:
        return {}
    if not isinstance(data, dict):
        return {}
    features = data.get("features", data)
    return features if isinstance(features, dict) else {}


def _dump_features_config(features: dict[str, Any]) -> str:
    ordered = {key: features[key] for key in FEATURE_KEYS if key in features}
    for key, value in features.items():
        if key not in ordered:
            ordered[key] = value
    return yaml.safe_dump({"features": ordered}, sort_keys=False, default_flow_style=False).strip()


def _backfill_features_config_aliases(bind) -> None:
    if not _has_column(bind, "storage_endpoints", "features_config"):
        return
    for row in bind.execute(sa.select(storage_endpoints.c.id, storage_endpoints.c.provider, storage_endpoints.c.features_config)):
        features = _parse_features_config(row.features_config)
        if not features:
            continue
        changed = False
        provider = str(row.provider or "ceph").strip().lower()
        admin = features.get("admin")
        if provider == "ceph" and "account" not in features and isinstance(admin, dict) and isinstance(admin.get("enabled"), bool):
            features["account"] = {"enabled": bool(admin.get("enabled"))}
            changed = True
        healthcheck = features.get("healthcheck")
        if isinstance(healthcheck, dict) and "endpoint" in healthcheck and "url" not in healthcheck and "healthcheck_url" not in healthcheck:
            healthcheck["healthcheck_url"] = healthcheck.pop("endpoint")
            changed = True
        if changed:
            bind.execute(
                storage_endpoints.update()
                .where(storage_endpoints.c.id == row.id)
                .values(features_config=_dump_features_config(features))
            )


def _backfill_portal_origins(bind) -> None:
    if not _has_column(bind, "portal_storage_space_metadata", "origin"):
        return
    bind.execute(
        portal_storage_space_metadata.update()
        .where(
            sa.or_(
                portal_storage_space_metadata.c.origin.is_(None),
                portal_storage_space_metadata.c.origin == "",
                portal_storage_space_metadata.c.origin == "legacy",
            )
        )
        .values(origin="imported")
    )
    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.alter_column("origin", existing_type=sa.String(), server_default="imported")


def upgrade() -> None:
    bind = op.get_bind()
    _backfill_tags_json_links(bind)
    _backfill_features_config_aliases(bind)
    _backfill_portal_origins(bind)


def downgrade() -> None:
    if _has_column(op.get_bind(), "portal_storage_space_metadata", "origin"):
        with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
            batch_op.alter_column("origin", existing_type=sa.String(), server_default="legacy")
