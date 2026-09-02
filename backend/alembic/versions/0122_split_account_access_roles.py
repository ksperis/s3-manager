# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Split Manager and Portal account roles and remove UI root flags.

Revision ID: 0122_split_account_access_roles
Revises: 0121_identity_security_policies
Create Date: 2026-09-01
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0122_split_account_access_roles"
down_revision = "0121_identity_security_policies"
branch_labels = None
depends_on = None


def _column_names(table_name: str) -> set[str]:
    return {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns(table_name)
    }


def _check_constraint_names(table_name: str) -> set[str]:
    return {
        constraint["name"]
        for constraint in sa.inspect(op.get_bind()).get_check_constraints(table_name)
        if constraint["name"] is not None
    }


def _split_role_constraints(table_name: str) -> dict[str, str]:
    return {
        f"ck_{table_name}_manager_role": (
            "manager_role IS NULL OR manager_role = 'account_administrator'"
        ),
        f"ck_{table_name}_portal_role": (
            "portal_role IS NULL OR portal_role IN ('portal_user', 'portal_manager')"
        ),
        f"ck_{table_name}_has_role": (
            "manager_role IS NOT NULL OR portal_role IS NOT NULL"
        ),
        f"ck_{table_name}_manager_browser_role": (
            "allow_manager_browser_data_access IS FALSE "
            "OR manager_role = 'account_administrator'"
        ),
    }


def _finalize_split_roles(table_name: str, *, has_root_flag: bool) -> None:
    columns = _column_names(table_name)
    checks = _check_constraint_names(table_name)
    constraints = _split_role_constraints(table_name)
    needs_batch = (
        "role" in columns
        or (has_root_flag and "is_root" in columns)
        or f"ck_{table_name}_role" in checks
        or any(name not in checks for name in constraints)
    )
    if not needs_batch:
        return

    with op.batch_alter_table(table_name, schema=None) as batch_op:
        legacy_constraint = f"ck_{table_name}_role"
        if legacy_constraint in checks:
            batch_op.drop_constraint(legacy_constraint, type_="check")
        for name, sqltext in constraints.items():
            if name not in checks:
                batch_op.create_check_constraint(name, sqltext)
        if "role" in columns:
            batch_op.drop_column("role")
        if has_root_flag and "is_root" in columns:
            batch_op.drop_column("is_root")


def _add_split_roles(table_name: str, *, has_root_flag: bool) -> None:
    # SQLite DDL is non-transactional: a failed startup can leave one or both
    # split columns behind while Alembic still records revision 0121.
    columns = _column_names(table_name)
    split_columns = {"manager_role", "portal_role"}
    if "role" not in columns:
        missing_columns = split_columns - columns
        if missing_columns:
            missing = ", ".join(sorted(missing_columns))
            raise RuntimeError(
                f"Cannot resume migration for {table_name}: legacy role is absent "
                f"and split columns are missing ({missing})."
            )
        _finalize_split_roles(table_name, has_root_flag=has_root_flag)
        return

    missing_columns = split_columns - columns
    if missing_columns:
        with op.batch_alter_table(table_name, schema=None) as batch_op:
            if "manager_role" in missing_columns:
                batch_op.add_column(sa.Column("manager_role", sa.String(), nullable=True))
            if "portal_role" in missing_columns:
                batch_op.add_column(sa.Column("portal_role", sa.String(), nullable=True))

    root_clause = "is_root IS TRUE OR " if has_root_flag else ""
    op.execute(
        sa.text(
            f"UPDATE {table_name} SET manager_role = 'account_administrator' "
            f"WHERE {root_clause}role = 'account_administrator'"
        )
    )
    non_root_clause = " AND is_root IS NOT TRUE" if has_root_flag else ""
    op.execute(
        sa.text(
            f"UPDATE {table_name} SET portal_role = role "
            "WHERE role IN ('portal_user', 'portal_manager')"
            f"{non_root_clause}"
        )
    )
    op.execute(
        sa.text(
            f"UPDATE {table_name} SET allow_manager_browser_data_access = FALSE "
            "WHERE manager_role IS NULL"
        )
    )
    _finalize_split_roles(table_name, has_root_flag=has_root_flag)


def upgrade() -> None:
    _add_split_roles("user_s3_accounts", has_root_flag=True)
    _add_split_roles("ui_group_s3_accounts", has_root_flag=False)
    if "is_root" in _column_names("users"):
        if op.get_bind().dialect.name == "sqlite":
            # Recreating this parent table fails when application connections
            # enforce foreign keys and any child row references a user.
            op.drop_column("users", "is_root")
        else:
            with op.batch_alter_table("users", schema=None) as batch_op:
                batch_op.drop_column("is_root")


def _assert_no_combined_roles(table_name: str) -> None:
    combined = op.get_bind().execute(
        sa.text(
            f"SELECT 1 FROM {table_name} "
            "WHERE manager_role IS NOT NULL AND portal_role IS NOT NULL LIMIT 1"
        )
    ).first()
    if combined is not None:
        raise RuntimeError(
            "Cannot downgrade split account roles while an association has both "
            f"Manager and Portal access ({table_name})."
        )


def _restore_canonical_role(table_name: str, *, restore_root_flag: bool) -> None:
    with op.batch_alter_table(table_name, schema=None) as batch_op:
        batch_op.add_column(sa.Column("role", sa.String(), nullable=True))
        if restore_root_flag:
            batch_op.add_column(
                sa.Column(
                    "is_root",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )

    op.execute(
        sa.text(
            f"UPDATE {table_name} SET role = 'account_administrator' "
            "WHERE manager_role = 'account_administrator'"
        )
    )
    op.execute(
        sa.text(
            f"UPDATE {table_name} SET role = portal_role "
            "WHERE role IS NULL AND portal_role IS NOT NULL"
        )
    )

    with op.batch_alter_table(table_name, schema=None) as batch_op:
        batch_op.drop_constraint(f"ck_{table_name}_manager_browser_role", type_="check")
        batch_op.drop_constraint(f"ck_{table_name}_has_role", type_="check")
        batch_op.drop_constraint(f"ck_{table_name}_portal_role", type_="check")
        batch_op.drop_constraint(f"ck_{table_name}_manager_role", type_="check")
        batch_op.alter_column("role", existing_type=sa.String(), nullable=False)
        batch_op.create_check_constraint(
            f"ck_{table_name}_role",
            "role IN ('portal_user', 'portal_manager', 'account_administrator')",
        )
        batch_op.drop_column("portal_role")
        batch_op.drop_column("manager_role")


def downgrade() -> None:
    _assert_no_combined_roles("user_s3_accounts")
    _assert_no_combined_roles("ui_group_s3_accounts")
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_root",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
    _restore_canonical_role("ui_group_s3_accounts", restore_root_flag=False)
    _restore_canonical_role("user_s3_accounts", restore_root_flag=True)
