"""Add project-scoped portal IAM users.

Revision ID: 0067_project_iam_users
Revises: 0066_add_ceph_bucket_replication_endpoint_metadata
Create Date: 2026-07-05 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "0067_project_iam_users"
down_revision = "0066_add_ceph_bucket_replication_endpoint_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_iam_users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("zonegroup_key", sa.String(), nullable=False),
        sa.Column("zonegroup_name", sa.String(), nullable=True),
        sa.Column("authority_account_id", sa.Integer(), nullable=True),
        sa.Column("iam_user_id", sa.String(), nullable=False),
        sa.Column("iam_username", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["authority_account_id"], ["s3_accounts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "project_id", "zonegroup_key", name="uq_project_iam_user_scope"),
    )
    op.create_index(op.f("ix_project_iam_users_id"), "project_iam_users", ["id"], unique=False)
    op.create_index(
        "ix_project_iam_users_project_user",
        "project_iam_users",
        ["project_id", "user_id"],
        unique=False,
    )
    op.create_index(
        "ix_project_iam_users_authority_account",
        "project_iam_users",
        ["authority_account_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_project_iam_users_authority_account", table_name="project_iam_users")
    op.drop_index("ix_project_iam_users_project_user", table_name="project_iam_users")
    op.drop_index(op.f("ix_project_iam_users_id"), table_name="project_iam_users")
    op.drop_table("project_iam_users")
