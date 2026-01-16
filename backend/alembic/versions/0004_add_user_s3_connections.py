"""Add user_s3_connections link table.

Revision ID: 0004_add_user_s3_connections
Revises: 0003_add_s3_connections
Create Date: 2026-01-16
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0004_add_user_s3_connections"
down_revision = "0003_add_s3_connections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_s3_connections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("s3_connection_id", sa.Integer(), sa.ForeignKey("s3_connections.id"), nullable=False),
        sa.Column("can_browser", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("can_manager", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "s3_connection_id", name="uq_user_s3_connection"),
    )
    op.create_index("ix_user_s3_connections_user_id", "user_s3_connections", ["user_id"], unique=False)
    op.create_index(
        "ix_user_s3_connections_s3_connection_id",
        "user_s3_connections",
        ["s3_connection_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_user_s3_connections_s3_connection_id", table_name="user_s3_connections")
    op.drop_index("ix_user_s3_connections_user_id", table_name="user_s3_connections")
    op.drop_table("user_s3_connections")
