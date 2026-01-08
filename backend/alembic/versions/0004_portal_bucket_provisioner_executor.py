"""Portal bucket provisioner executor credentials

Revision ID: 0004_portal_bucket_provisioner_executor
Revises: 0003_portal_refactor_schema
Create Date: 2026-01-08 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.core.security import EncryptedString

revision = "0004_portal_bucket_provisioner_executor"
down_revision = "0003_portal_refactor_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("s3_accounts", sa.Column("bucket_provisioner_iam_username", sa.String(), nullable=True))
    op.add_column("s3_accounts", sa.Column("bucket_provisioner_access_key", sa.String(), nullable=True))
    op.add_column("s3_accounts", sa.Column("bucket_provisioner_secret_key", EncryptedString(), nullable=True))


def downgrade() -> None:
    op.drop_column("s3_accounts", "bucket_provisioner_secret_key")
    op.drop_column("s3_accounts", "bucket_provisioner_access_key")
    op.drop_column("s3_accounts", "bucket_provisioner_iam_username")

