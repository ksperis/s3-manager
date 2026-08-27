# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add manager/browser access flags to S3 connections."""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0015_s3_connection_access_flags"
down_revision = "0014_pre_release_schema_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.add_column(sa.Column("access_manager", sa.Boolean(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("access_browser", sa.Boolean(), nullable=False, server_default="1"))

    # Preserve historical behavior:
    # - Browser was available for existing connections
    # - Manager required IAM-compatible credentials
    connections = sa.table(
        "s3_connections",
        sa.column("iam_capable", sa.Boolean()),
        sa.column("access_browser", sa.Boolean()),
        sa.column("access_manager", sa.Boolean()),
    )
    op.execute(
        sa.update(connections).values(
            access_browser=True,
            access_manager=sa.case(
                (connections.c.iam_capable.is_(True), True),
                else_=False,
            ),
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.drop_column("access_browser")
        batch_op.drop_column("access_manager")
