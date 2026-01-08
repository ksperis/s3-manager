"""Drop legacy account_iam_users table

Revision ID: 0005_drop_account_iam_users
Revises: 0004_portal_bucket_provisioner_executor
Create Date: 2026-01-08 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0005_drop_account_iam_users"
down_revision = "0004_portal_bucket_provisioner_executor"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "account_iam_users" not in tables:
        return
    indexes = {idx["name"] for idx in inspector.get_indexes("account_iam_users")}
    if "ix_account_iam_users_id" in indexes:
        op.drop_index("ix_account_iam_users_id", table_name="account_iam_users")
    op.drop_table("account_iam_users")


def downgrade() -> None:
    # Legacy table intentionally not restored.
    pass

