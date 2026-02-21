# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""add ui language preference on users

Revision ID: 0012_user_ui_language
Revises: 0011_drop_legacy_endpoint_health_daily
Create Date: 2026-02-21 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0012_user_ui_language"
down_revision = "0011_drop_legacy_endpoint_health_daily"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("ui_language", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("ui_language")
