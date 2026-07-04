"""Add operational foreign key indexes.

Revision ID: 0061_operational_foreign_key_indexes
Revises: 0060_multi_backend_coordination
Create Date: 2026-07-03 00:00:00.000000
"""

from alembic import op


revision = "0061_operational_foreign_key_indexes"
down_revision = "0060_multi_backend_coordination"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_s3_accounts_storage_endpoint", "s3_accounts", ["storage_endpoint_id"], unique=False)
    op.create_index("ix_s3_users_storage_endpoint", "s3_users", ["storage_endpoint_id"], unique=False)
    op.create_index("ix_account_iam_users_account_user", "account_iam_users", ["account_id", "user_id"], unique=False)
    op.create_index("ix_audit_logs_user_id_id", "audit_logs", ["user_id", "id"], unique=False)
    op.create_index(
        "ix_storage_endpoint_tags_definition",
        "storage_endpoint_tags",
        ["tag_definition_id"],
        unique=False,
    )
    op.create_index("ix_s3_account_tags_definition", "s3_account_tags", ["tag_definition_id"], unique=False)
    op.create_index("ix_s3_user_tags_definition", "s3_user_tags", ["tag_definition_id"], unique=False)
    op.create_index("ix_s3_connection_tags_definition", "s3_connection_tags", ["tag_definition_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_s3_connection_tags_definition", table_name="s3_connection_tags")
    op.drop_index("ix_s3_user_tags_definition", table_name="s3_user_tags")
    op.drop_index("ix_s3_account_tags_definition", table_name="s3_account_tags")
    op.drop_index("ix_storage_endpoint_tags_definition", table_name="storage_endpoint_tags")
    op.drop_index("ix_audit_logs_user_id_id", table_name="audit_logs")
    op.drop_index("ix_account_iam_users_account_user", table_name="account_iam_users")
    op.drop_index("ix_s3_users_storage_endpoint", table_name="s3_users")
    op.drop_index("ix_s3_accounts_storage_endpoint", table_name="s3_accounts")
