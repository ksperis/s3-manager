# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add temporary S3 connection metadata."""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0004_temporary_s3_connections"
down_revision = "0003_endpoint_healthchecks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.add_column(sa.Column("is_temporary", sa.Boolean(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("temp_user_uid", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("temp_access_key_id", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.drop_column("temp_access_key_id")
        batch_op.drop_column("temp_user_uid")
        batch_op.drop_column("is_temporary")
