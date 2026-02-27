# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add precheck status/report fields to bucket migrations."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0020_bucket_migrations_precheck"
down_revision = "0019_bucket_migrations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migrations", schema=None) as batch_op:
        batch_op.add_column(sa.Column("precheck_status", sa.String(), nullable=False, server_default="pending"))
        batch_op.add_column(sa.Column("precheck_report_json", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("precheck_checked_at", sa.DateTime(), nullable=True))
        batch_op.create_index(batch_op.f("ix_bucket_migrations_precheck_status"), ["precheck_status"], unique=False)



def downgrade() -> None:
    with op.batch_alter_table("bucket_migrations", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_bucket_migrations_precheck_status"))
        batch_op.drop_column("precheck_checked_at")
        batch_op.drop_column("precheck_report_json")
        batch_op.drop_column("precheck_status")
