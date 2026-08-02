"""Canonicalize UI user roles.

Revision ID: 0092_canonical_user_roles
Revises: 0091_purge_data_plane_audit_logs
Create Date: 2026-08-02
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0092_canonical_user_roles"
down_revision = "0091_purge_data_plane_audit_logs"
branch_labels = None
depends_on = None


CANONICAL_ROLES = (
    "ui_superadmin",
    "ui_admin",
    "ui_user",
    "ui_none",
)

ROLE_ALIASES = {
    "ui_superadmin": ("ui_superadmin", "super_admin", "superadmin"),
    "ui_admin": ("ui_admin", "account_admin", "admin"),
    "ui_user": ("ui_user", "account_user", "user"),
    "ui_none": ("ui_none", "none"),
}


def upgrade() -> None:
    users = sa.table(
        "users",
        sa.column("role", sa.String()),
    )
    normalized_role = sa.func.lower(sa.func.trim(users.c.role))
    for canonical_role, aliases in ROLE_ALIASES.items():
        op.execute(
            users.update()
            .where(normalized_role.in_(aliases))
            .values(role=canonical_role)
        )

    # Unknown historical roles previously granted no canonical UI authority.
    # Preserve that security posture by converting them to explicit no-access.
    op.execute(
        users.update()
        .where(users.c.role.notin_(CANONICAL_ROLES))
        .values(role="ui_none")
    )

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.alter_column(
            "role",
            existing_type=sa.String(),
            nullable=False,
            server_default="ui_user",
        )
        batch_op.create_check_constraint(
            "ck_users_role",
            "role IN ('ui_superadmin', 'ui_admin', 'ui_user', 'ui_none')",
        )


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_constraint("ck_users_role", type_="check")
        batch_op.alter_column(
            "role",
            existing_type=sa.String(),
            nullable=False,
            server_default=None,
        )
