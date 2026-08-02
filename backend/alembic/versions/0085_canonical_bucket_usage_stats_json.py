# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize bucket usage statistics JSON lists.

Revision ID: 0085_canonical_bucket_usage_stats_json
Revises: 0084_canonical_managed_access_iam_lists
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0085_canonical_bucket_usage_stats_json"
down_revision = "0084_canonical_managed_access_iam_lists"
branch_labels = None
depends_on = None


DISTRIBUTION_COLUMNS = (
    "data_type_distribution_json",
    "storage_class_distribution_json",
    "size_distribution_json",
    "age_distribution_json",
    "current_noncurrent_distribution_json",
)


def _normalize_distributions(raw: object) -> str:
    try:
        payload = json.loads(raw) if isinstance(raw, str) else []
    except (TypeError, ValueError):
        payload = []
    if not isinstance(payload, list):
        payload = []
    return json.dumps(
        [entry for entry in payload if isinstance(entry, dict)],
        separators=(",", ":"),
        sort_keys=True,
    )


def _normalize_warnings(raw: object) -> str:
    try:
        payload = json.loads(raw) if isinstance(raw, str) else []
    except (TypeError, ValueError):
        payload = []
    if not isinstance(payload, list):
        payload = []
    return json.dumps(
        [entry for entry in payload if isinstance(entry, str)],
        separators=(",", ":"),
    )


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, data_type_distribution_json, "
            "storage_class_distribution_json, size_distribution_json, "
            "age_distribution_json, current_noncurrent_distribution_json, "
            "warnings_json FROM bucket_usage_stats_snapshots"
        )
    ).mappings()
    for row in rows:
        values = {
            column: _normalize_distributions(row[column])
            for column in DISTRIBUTION_COLUMNS
        }
        values["warnings_json"] = (
            _normalize_warnings(row["warnings_json"])
            if row["warnings_json"] is not None
            else None
        )
        bind.execute(
            sa.text(
                "UPDATE bucket_usage_stats_snapshots SET "
                "data_type_distribution_json = :data_type_distribution_json, "
                "storage_class_distribution_json = :storage_class_distribution_json, "
                "size_distribution_json = :size_distribution_json, "
                "age_distribution_json = :age_distribution_json, "
                "current_noncurrent_distribution_json = :current_noncurrent_distribution_json, "
                "warnings_json = :warnings_json WHERE id = :id"
            ),
            {"id": row["id"], **values},
        )


def downgrade() -> None:
    pass
