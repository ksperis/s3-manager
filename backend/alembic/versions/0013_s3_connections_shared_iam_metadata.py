# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add shared visibility, IAM capability, and key owner metadata on S3 connections."""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0013_s3_connections_shared_iam_metadata"
down_revision = "0012_user_ui_language"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.add_column(sa.Column("is_shared", sa.Boolean(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("iam_capable", sa.Boolean(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("credential_owner_type", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("credential_owner_identifier", sa.String(), nullable=True))

    connections = sa.table(
        "s3_connections",
        sa.column("id", sa.Integer()),
        sa.column("is_public", sa.Boolean()),
        sa.column("is_shared", sa.Boolean()),
    )
    user_connections = sa.table(
        "user_s3_connections",
        sa.column("s3_connection_id", sa.Integer()),
    )
    op.execute(
        sa.update(connections)
        .where(
            connections.c.is_public.is_(False),
            connections.c.id.in_(sa.select(user_connections.c.s3_connection_id).distinct()),
        )
        .values(is_shared=True)
    )


def downgrade() -> None:
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.drop_column("credential_owner_identifier")
        batch_op.drop_column("credential_owner_type")
        batch_op.drop_column("iam_capable")
        batch_op.drop_column("is_shared")
