# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add UI tag metadata columns to endpoints, accounts, users, and connections."""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0033_object_tags_metadata"
down_revision = "0032_s3_connections_binary_visibility"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.add_column(sa.Column("tags_json", sa.Text(), nullable=False, server_default="[]"))

    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.add_column(sa.Column("tags_json", sa.Text(), nullable=False, server_default="[]"))

    with op.batch_alter_table("s3_users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("tags_json", sa.Text(), nullable=False, server_default="[]"))

    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.add_column(sa.Column("tags_json", sa.Text(), nullable=False, server_default="[]"))


def downgrade() -> None:
    raise RuntimeError("Downgrade is not supported for revision 0033_object_tags_metadata")
