"""Add Portal external access credentials.

Revision ID: 0062_portal_external_access_credentials
Revises: 0061_operational_foreign_key_indexes
Create Date: 2026-07-08 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0062_portal_external_access_credentials"
down_revision = "0061_operational_foreign_key_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "portal_external_access_credentials",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("storage_space_metadata_id", sa.Integer(), nullable=False),
        sa.Column("bucket_name", sa.String(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("external_email", sa.String(), nullable=False),
        sa.Column("permission", sa.String(), nullable=False),
        sa.Column("iam_user_id", sa.String(), nullable=True),
        sa.Column("iam_username", sa.String(), nullable=False),
        sa.Column("access_key_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="Active", nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "permission IN ('read_only', 'read_write')",
            name="ck_portal_external_access_credentials_permission",
        ),
        sa.CheckConstraint(
            "status IN ('Active', 'Inactive')",
            name="ck_portal_external_access_credentials_status",
        ),
        sa.ForeignKeyConstraint(["account_id"], ["s3_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["storage_space_metadata_id"],
            ["portal_storage_space_metadata.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("access_key_id", name="uq_portal_external_access_credentials_access_key"),
        sa.UniqueConstraint("iam_username", name="uq_portal_external_access_credentials_iam_username"),
    )
    op.create_index(
        op.f("ix_portal_external_access_credentials_id"),
        "portal_external_access_credentials",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_portal_external_access_credentials_account",
        "portal_external_access_credentials",
        ["account_id"],
        unique=False,
    )
    op.create_index(
        "ix_portal_external_access_credentials_creator",
        "portal_external_access_credentials",
        ["created_by_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_portal_external_access_credentials_revoked",
        "portal_external_access_credentials",
        ["revoked_at"],
        unique=False,
    )
    op.create_index(
        "ix_portal_external_access_credentials_space",
        "portal_external_access_credentials",
        ["storage_space_metadata_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_portal_external_access_credentials_space", table_name="portal_external_access_credentials")
    op.drop_index("ix_portal_external_access_credentials_revoked", table_name="portal_external_access_credentials")
    op.drop_index("ix_portal_external_access_credentials_creator", table_name="portal_external_access_credentials")
    op.drop_index("ix_portal_external_access_credentials_account", table_name="portal_external_access_credentials")
    op.drop_index(op.f("ix_portal_external_access_credentials_id"), table_name="portal_external_access_credentials")
    op.drop_table("portal_external_access_credentials")
