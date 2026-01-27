"""Drop UI user RGW credentials.

Revision ID: 0010_drop_user_rgw_credentials
Revises: 0009_drop_user_s3_connection_flags
Create Date: 2026-01-27
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.core.security import EncryptedString


# revision identifiers, used by Alembic.
revision = "0010_drop_user_rgw_credentials"
down_revision = "0009_drop_user_s3_connection_flags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("rgw_access_key")
        batch_op.drop_column("rgw_secret_key")


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("rgw_access_key", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("rgw_secret_key", EncryptedString(), nullable=True))
