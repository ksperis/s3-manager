# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Use full_name as the canonical UI user name.

Revision ID: 0123_canonical_ui_user_full_name
Revises: 0122_split_account_access_roles
Create Date: 2026-09-02
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0123_canonical_ui_user_full_name"
down_revision = "0122_split_account_access_roles"
branch_labels = None
depends_on = None


def _column_names() -> set[str]:
    return {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("users")
    }


def upgrade() -> None:
    columns = _column_names()
    if "display_name" not in columns:
        return
    if "full_name" not in columns:
        raise RuntimeError(
            "Cannot canonicalize UI user names because users.full_name is missing."
        )

    op.execute(
        sa.text(
            "UPDATE users "
            "SET full_name = NULLIF(TRIM(display_name), '') "
            "WHERE (full_name IS NULL OR TRIM(full_name) = '') "
            "AND NULLIF(TRIM(display_name), '') IS NOT NULL"
        )
    )
    if op.get_bind().dialect.name == "sqlite":
        op.drop_column("users", "display_name")
    else:
        with op.batch_alter_table("users", schema=None) as batch_op:
            batch_op.drop_column("display_name")


def downgrade() -> None:
    if "display_name" in _column_names():
        return
    op.add_column("users", sa.Column("display_name", sa.String(), nullable=True))
    op.execute(
        sa.text(
            "UPDATE users SET display_name = full_name "
            "WHERE full_name IS NOT NULL"
        )
    )
