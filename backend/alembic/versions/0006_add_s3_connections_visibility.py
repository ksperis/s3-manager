"""Add public/private visibility to S3 connections.

Revision ID: 0006_add_s3_connections_visibility
Revises: 0005_add_s3_connections_storage_endpoint
Create Date: 2026-02-12
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0006_add_s3_connections_visibility"
down_revision = "0005_add_s3_connections_storage_endpoint"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("s3_connections") as batch_op:
        batch_op.add_column(sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.text("0")))
        batch_op.alter_column("owner_user_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("s3_connections") as batch_op:
        batch_op.alter_column("owner_user_id", existing_type=sa.Integer(), nullable=False)
        batch_op.drop_column("is_public")
