# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove tag JSON mirrors superseded by normalized tag links.

Revision ID: 0078_remove_legacy_tags_json
Revises: 0077_canonical_s3_connection_capabilities
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0078_remove_legacy_tags_json"
down_revision = "0077_canonical_s3_connection_capabilities"
branch_labels = None
depends_on = None


TAG_PARENTS = (
    ("storage_endpoints", "storage_endpoint_tags", "storage_endpoint_id"),
    ("s3_accounts", "s3_account_tags", "account_id"),
    ("s3_users", "s3_user_tags", "s3_user_id"),
    ("s3_connections", "s3_connection_tags", "s3_connection_id"),
)


def upgrade() -> None:
    for parent_table, _, _ in TAG_PARENTS:
        with op.batch_alter_table(parent_table, schema=None) as batch_op:
            batch_op.drop_column("tags_json")


def downgrade() -> None:
    for parent_table, _, _ in TAG_PARENTS:
        with op.batch_alter_table(parent_table, schema=None) as batch_op:
            batch_op.add_column(
                sa.Column(
                    "tags_json",
                    sa.Text(),
                    nullable=False,
                    server_default="[]",
                )
            )

    bind = op.get_bind()
    for parent_table, link_table, parent_column in TAG_PARENTS:
        rows = bind.execute(
            sa.text(
                f"""
                SELECT links.{parent_column} AS parent_id, definitions.label AS label
                FROM {link_table} AS links
                JOIN tag_definitions AS definitions
                  ON definitions.id = links.tag_definition_id
                ORDER BY links.{parent_column}, links.position, links.id
                """
            )
        ).mappings()
        labels_by_parent: dict[int, list[str]] = {}
        for row in rows:
            labels_by_parent.setdefault(int(row["parent_id"]), []).append(
                str(row["label"])
            )
        for parent_id, labels in labels_by_parent.items():
            bind.execute(
                sa.text(
                    f"UPDATE {parent_table} "
                    "SET tags_json = :tags_json WHERE id = :parent_id"
                ),
                {
                    "parent_id": parent_id,
                    "tags_json": json.dumps(labels, separators=(",", ":")),
                },
            )
