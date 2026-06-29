# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add DB-backed Portal Storage Space grants."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0056_portal_storage_space_grants"
down_revision = "0055_ldap_providers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "portal_storage_space_grants",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("storage_space_metadata_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "role IN ('Viewer', 'Editor', 'Owner')",
            name="ck_portal_storage_space_grants_role",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["storage_space_metadata_id"],
            ["portal_storage_space_metadata.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "storage_space_metadata_id",
            "user_id",
            name="uq_portal_storage_space_grants_space_user",
        ),
    )
    op.create_index(op.f("ix_portal_storage_space_grants_id"), "portal_storage_space_grants", ["id"], unique=False)
    op.create_index(
        "ix_portal_storage_space_grants_space",
        "portal_storage_space_grants",
        ["storage_space_metadata_id"],
        unique=False,
    )
    op.create_index(
        "ix_portal_storage_space_grants_user",
        "portal_storage_space_grants",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_portal_storage_space_grants_user", table_name="portal_storage_space_grants")
    op.drop_index("ix_portal_storage_space_grants_space", table_name="portal_storage_space_grants")
    op.drop_index(op.f("ix_portal_storage_space_grants_id"), table_name="portal_storage_space_grants")
    op.drop_table("portal_storage_space_grants")
