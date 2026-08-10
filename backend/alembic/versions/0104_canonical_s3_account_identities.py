# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Require canonical RGW identities for every persisted S3 account.

Revision ID: 0104_canonical_s3_account_identities
Revises: 0103_manager_browser_data_access
Create Date: 2026-08-10
"""

from alembic import op
import sqlalchemy as sa


revision = "0104_canonical_s3_account_identities"
down_revision = "0103_manager_browser_data_access"
branch_labels = None
depends_on = None


_s3_accounts = sa.table(
    "s3_accounts",
    sa.column("id", sa.Integer()),
    sa.column("name", sa.String()),
    sa.column("rgw_account_id", sa.String()),
    sa.column("rgw_user_uid", sa.String()),
)


def upgrade() -> None:
    bind = op.get_bind()
    incomplete_rows = bind.execute(
        sa.select(
            _s3_accounts.c.id,
            _s3_accounts.c.name,
        )
        .where(
            sa.or_(
                _s3_accounts.c.rgw_account_id.is_(None),
                sa.func.trim(_s3_accounts.c.rgw_account_id) == "",
                _s3_accounts.c.rgw_user_uid.is_(None),
                sa.func.trim(_s3_accounts.c.rgw_user_uid) == "",
            )
        )
        .order_by(_s3_accounts.c.id.asc())
    ).all()
    if incomplete_rows:
        accounts = ", ".join(
            f"{int(row.id)} ({row.name or 'unnamed'})"
            for row in incomplete_rows[:10]
        )
        suffix = " ..." if len(incomplete_rows) > 10 else ""
        raise RuntimeError(
            "Cannot migrate S3 accounts with incomplete RGW identities: "
            f"{accounts}{suffix}. Repair rgw_account_id and rgw_user_uid before upgrading."
        )

    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.alter_column(
            "rgw_account_id",
            existing_type=sa.String(),
            nullable=False,
        )
        batch_op.alter_column(
            "rgw_user_uid",
            existing_type=sa.String(),
            nullable=False,
        )
        batch_op.create_check_constraint(
            "ck_s3_accounts_rgw_account_id_nonempty",
            "TRIM(rgw_account_id) <> ''",
        )
        batch_op.create_check_constraint(
            "ck_s3_accounts_rgw_user_uid_nonempty",
            "TRIM(rgw_user_uid) <> ''",
        )


def downgrade() -> None:
    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.drop_constraint(
            "ck_s3_accounts_rgw_user_uid_nonempty",
            type_="check",
        )
        batch_op.drop_constraint(
            "ck_s3_accounts_rgw_account_id_nonempty",
            type_="check",
        )
        batch_op.alter_column(
            "rgw_user_uid",
            existing_type=sa.String(),
            nullable=True,
        )
        batch_op.alter_column(
            "rgw_account_id",
            existing_type=sa.String(),
            nullable=True,
        )
