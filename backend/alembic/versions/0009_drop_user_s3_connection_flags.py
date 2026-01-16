"""Drop unused S3 connection user flags.

Revision ID: 0009_drop_user_s3_connection_flags
Revises: 0008_drop_s3_connection_redundant_columns
Create Date: 2026-02-12
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0009_drop_user_s3_connection_flags"
down_revision = "0008_drop_s3_connection_redundant_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("user_s3_connections") as batch_op:
        batch_op.drop_column("can_browser")
        batch_op.drop_column("can_manager")


def downgrade() -> None:
    with op.batch_alter_table("user_s3_connections") as batch_op:
        batch_op.add_column(sa.Column("can_browser", sa.Boolean(), nullable=False, server_default=sa.text("1")))
        batch_op.add_column(sa.Column("can_manager", sa.Boolean(), nullable=False, server_default=sa.text("1")))
