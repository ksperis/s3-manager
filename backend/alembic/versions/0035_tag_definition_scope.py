# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add scope metadata to shared tag definitions."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0035_tag_definition_scope"
down_revision = "0034_normalized_tag_definitions"
branch_labels = None
depends_on = None


DEFAULT_TAG_SCOPE = "standard"


def _has_column(bind, table_name: str, column_name: str) -> bool:
    return any(column.get("name") == column_name for column in sa.inspect(bind).get_columns(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    if not _has_column(bind, "tag_definitions", "scope"):
        op.add_column(
            "tag_definitions",
            sa.Column("scope", sa.String(), nullable=False, server_default=DEFAULT_TAG_SCOPE),
        )
    bind.execute(
        sa.text("UPDATE tag_definitions SET scope = :scope WHERE scope IS NULL OR TRIM(scope) = ''"),
        {"scope": DEFAULT_TAG_SCOPE},
    )


def downgrade() -> None:
    raise RuntimeError("Downgrade is not supported for revision 0035_tag_definition_scope")
