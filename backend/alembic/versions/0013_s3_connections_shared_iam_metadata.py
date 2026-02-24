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

    op.execute(
        sa.text(
            """
            UPDATE s3_connections
            SET is_shared = 1
            WHERE is_public = 0
              AND id IN (SELECT DISTINCT s3_connection_id FROM user_s3_connections)
            """
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.drop_column("credential_owner_identifier")
        batch_op.drop_column("credential_owner_type")
        batch_op.drop_column("iam_capable")
        batch_op.drop_column("is_shared")
