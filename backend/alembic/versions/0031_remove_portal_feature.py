# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove Portal feature schema and account roles."""

from alembic import op
import sqlalchemy as sa

from app.core.security import EncryptedString


# revision identifiers, used by Alembic.
revision = "0031_remove_portal_feature"
down_revision = "0030_s3_connection_active_flag"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM user_s3_accounts WHERE account_admin = 0")

    with op.batch_alter_table("user_s3_accounts", schema=None) as batch_op:
        batch_op.drop_column("account_role")

    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.drop_column("portal_settings_override")

    op.drop_table("account_iam_users")


def downgrade() -> None:
    op.create_table(
        "account_iam_users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("iam_user_id", sa.String(), nullable=False),
        sa.Column("iam_username", sa.String(), nullable=True),
        sa.Column("active_access_key", sa.String(), nullable=True),
        sa.Column("active_secret_key", EncryptedString(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["s3_accounts.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("iam_user_id", name="uq_account_iam_user_id"),
        sa.UniqueConstraint("user_id", "account_id", name="uq_account_iam_user"),
    )
    with op.batch_alter_table("account_iam_users", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_account_iam_users_id"), ["id"], unique=False)

    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.add_column(sa.Column("portal_settings_override", sa.Text(), nullable=True))

    with op.batch_alter_table("user_s3_accounts", schema=None) as batch_op:
        batch_op.add_column(sa.Column("account_role", sa.String(), nullable=True, server_default="portal_none"))

    op.execute("UPDATE user_s3_accounts SET account_role = 'portal_none' WHERE account_role IS NULL")

    with op.batch_alter_table("user_s3_accounts", schema=None) as batch_op:
        batch_op.alter_column("account_role", nullable=False, server_default=None)
