"""Merge refresh sessions + drop user RGW credentials.

Revision ID: 0011_merge_refresh_and_drop_user_rgw
Revises: 0004_add_refresh_sessions, 0010_drop_user_rgw_credentials
Create Date: 2026-01-27
"""

from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "0011_merge_refresh_and_drop_user_rgw"
down_revision = ("0004_add_refresh_sessions", "0010_drop_user_rgw_credentials")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
