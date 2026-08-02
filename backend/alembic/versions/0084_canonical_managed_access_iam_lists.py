# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize managed private access IAM resource lists.

Revision ID: 0084_canonical_managed_access_iam_lists
Revises: 0083_canonical_oidc_provider_scopes
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0084_canonical_managed_access_iam_lists"
down_revision = "0083_canonical_oidc_provider_scopes"
branch_labels = None
depends_on = None


IAM_LIST_COLUMNS = (
    "iam_groups_json",
    "iam_managed_policies_json",
    "iam_inline_policy_names_json",
)


def _normalize_string_list(raw: object) -> str:
    try:
        payload = json.loads(raw) if isinstance(raw, str) else []
    except (TypeError, ValueError):
        payload = []
    normalized: list[str] = []
    if isinstance(payload, list):
        for item in payload:
            if not isinstance(item, str):
                continue
            item = item.strip()
            if item and item not in normalized:
                normalized.append(item)
    return json.dumps(normalized, separators=(",", ":"))


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, iam_groups_json, iam_managed_policies_json, "
            "iam_inline_policy_names_json FROM managed_private_accesses"
        )
    ).mappings()
    for row in rows:
        values = {
            column: _normalize_string_list(row[column])
            for column in IAM_LIST_COLUMNS
        }
        bind.execute(
            sa.text(
                "UPDATE managed_private_accesses "
                "SET iam_groups_json = :iam_groups_json, "
                "iam_managed_policies_json = :iam_managed_policies_json, "
                "iam_inline_policy_names_json = :iam_inline_policy_names_json "
                "WHERE id = :id"
            ),
            {"id": row["id"], **values},
        )


def downgrade() -> None:
    pass
