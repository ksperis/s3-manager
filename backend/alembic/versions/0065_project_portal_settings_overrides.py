"""Move portal settings overrides to projects.

Revision ID: 0065_project_portal_settings_overrides
Revises: 0064_drop_legacy_account_portal_roles
Create Date: 2026-07-05 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0065_project_portal_settings_overrides"
down_revision = "0064_drop_legacy_account_portal_roles"
branch_labels = None
depends_on = None


def _has_column(connection, table_name: str, column_name: str) -> bool:  # noqa: ANN001
    inspector = sa.inspect(connection)
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    connection = op.get_bind()
    if not _has_column(connection, "projects", "portal_settings_override"):
        with op.batch_alter_table("projects") as batch_op:
            batch_op.add_column(sa.Column("portal_settings_override", sa.Text(), nullable=True))

    if _has_column(connection, "s3_accounts", "portal_settings_override"):
        with op.batch_alter_table("s3_accounts") as batch_op:
            batch_op.drop_column("portal_settings_override")


def downgrade() -> None:
    connection = op.get_bind()
    if not _has_column(connection, "s3_accounts", "portal_settings_override"):
        with op.batch_alter_table("s3_accounts") as batch_op:
            batch_op.add_column(sa.Column("portal_settings_override", sa.Text(), nullable=True))

    if _has_column(connection, "projects", "portal_settings_override"):
        with op.batch_alter_table("projects") as batch_op:
            batch_op.drop_column("portal_settings_override")
