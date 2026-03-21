# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Refactor S3 connections visibility to binary shared/private and creator field."""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0032_s3_connections_binary_visibility"
down_revision = "0031_remove_portal_feature"
branch_labels = None
depends_on = None


def _scalar_int(bind, query: str) -> int:
    value = bind.execute(sa.text(query)).scalar()
    return int(value or 0)


def upgrade() -> None:
    bind = op.get_bind()

    # Defensive cleanup for interrupted SQLite batch migrations.
    op.execute(sa.text("DROP TABLE IF EXISTS _alembic_tmp_s3_connections"))

    public_count = _scalar_int(bind, "SELECT COUNT(1) FROM s3_connections WHERE is_public = 1")
    if public_count > 0:
        raise RuntimeError(
            "Migration blocked: s3_connections still contains public rows; clean data before applying revision 0032"
        )

    missing_creator = _scalar_int(bind, "SELECT COUNT(1) FROM s3_connections WHERE owner_user_id IS NULL")
    if missing_creator > 0:
        raise RuntimeError(
            "Migration blocked: s3_connections has rows without owner_user_id; clean data before applying revision 0032"
        )

    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.drop_index("ix_s3_connections_owner_user_id")
        batch_op.drop_constraint("uq_s3_connections_owner_name", type_="unique")
        batch_op.alter_column(
            "owner_user_id",
            new_column_name="created_by_user_id",
            existing_type=sa.Integer(),
            existing_nullable=True,
            nullable=False,
        )
        batch_op.drop_column("is_public")

    op.create_index("ix_s3_connections_created_by_user_id", "s3_connections", ["created_by_user_id"], unique=False)

    op.create_index(
        "uq_s3_connections_private_creator_name",
        "s3_connections",
        ["created_by_user_id", "name"],
        unique=True,
        sqlite_where=sa.text("is_shared = 0"),
        postgresql_where=sa.text("is_shared = false"),
    )
    op.create_index(
        "uq_s3_connections_shared_name",
        "s3_connections",
        ["name"],
        unique=True,
        sqlite_where=sa.text("is_shared = 1"),
        postgresql_where=sa.text("is_shared = true"),
    )


def downgrade() -> None:
    raise RuntimeError("Downgrade is not supported for revision 0032_s3_connections_binary_visibility")
