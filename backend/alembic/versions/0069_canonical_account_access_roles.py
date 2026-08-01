# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize account roles and quarantine unusable shared connections.

Revision ID: 0069_canonical_account_access_roles
Revises: 0068_ldap_legacy_tls_compatibility
Create Date: 2026-08-01 00:00:00.000000
"""

from alembic import op
import os
import sqlalchemy as sa


revision = "0069_canonical_account_access_roles"
down_revision = "0068_ldap_legacy_tls_compatibility"
branch_labels = None
depends_on = None


def _backup_is_verified() -> bool:
    value = str(os.getenv("S3_MANAGER_DB_BACKUP_VERIFIED") or "").strip().lower()
    return value in {"1", "true", "yes"}


def _assert_backup_before_irreversible_cleanup() -> None:
    if not _backup_is_verified():
        raise RuntimeError(
            "Migration 0069 will irreversibly delete account associations without rights. "
            "Verify a restorable database backup, then set S3_MANAGER_DB_BACKUP_VERIFIED=true."
        )


def _migrate_account_links(table_name: str, *, root_capable: bool) -> None:
    op.add_column(table_name, sa.Column("role", sa.String(), nullable=True))
    root_clause = "is_root IS TRUE OR " if root_capable else ""
    op.execute(
        sa.text(
            f"UPDATE {table_name} SET role = 'account_administrator' "
            f"WHERE {root_clause}account_admin IS TRUE"
        )
    )
    op.execute(
        sa.text(
            f"UPDATE {table_name} SET role = 'portal_manager' "
            "WHERE role IS NULL AND account_admin IS FALSE "
            "AND account_role = 'portal_manager'"
        )
    )
    op.execute(
        sa.text(
            f"UPDATE {table_name} SET role = 'portal_user' "
            "WHERE role IS NULL AND account_admin IS FALSE "
            "AND account_role = 'portal_user'"
        )
    )
    # Explicitly irreversible by product decision: no-right links are deleted
    # without a remediation or rollback record.
    op.execute(sa.text(f"DELETE FROM {table_name} WHERE role IS NULL"))
    with op.batch_alter_table(table_name, schema=None) as batch_op:
        batch_op.alter_column("role", existing_type=sa.String(), nullable=False)
        batch_op.create_check_constraint(
            f"ck_{table_name}_role",
            "role IN ('portal_user', 'portal_manager', 'account_administrator')",
        )
        batch_op.drop_column("account_admin")
        batch_op.drop_column("account_role")


def upgrade() -> None:
    _assert_backup_before_irreversible_cleanup()
    _migrate_account_links("user_s3_accounts", root_capable=True)
    _migrate_account_links("ui_group_s3_accounts", root_capable=False)

    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "remediation_required",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.add_column(sa.Column("remediation_reason", sa.String(), nullable=True))

    op.execute(
        sa.text(
            "UPDATE s3_connections SET access_browser = FALSE "
            "WHERE is_shared IS TRUE"
        )
    )
    op.execute(
        sa.text(
            "UPDATE s3_connections "
            "SET remediation_required = TRUE, "
            "remediation_reason = 'shared_connection_manager_access_disabled' "
            "WHERE is_shared IS TRUE AND access_manager IS FALSE"
        )
    )


def _restore_legacy_account_links(table_name: str) -> None:
    with op.batch_alter_table(table_name, schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "account_admin",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.add_column(
            sa.Column("account_role", sa.String(), nullable=False, server_default="portal_none")
        )
    op.execute(
        sa.text(
            f"UPDATE {table_name} SET account_admin = TRUE, "
            "account_role = 'portal_manager' "
            "WHERE role = 'account_administrator'"
        )
    )
    op.execute(
        sa.text(
            f"UPDATE {table_name} SET account_role = role "
            "WHERE role IN ('portal_user', 'portal_manager')"
        )
    )
    with op.batch_alter_table(table_name, schema=None) as batch_op:
        batch_op.drop_constraint(f"ck_{table_name}_role", type_="check")
        batch_op.drop_column("role")


def downgrade() -> None:
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.drop_column("remediation_reason")
        batch_op.drop_column("remediation_required")
    _restore_legacy_account_links("ui_group_s3_accounts")
    _restore_legacy_account_links("user_s3_accounts")
