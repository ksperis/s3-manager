# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Repair authentication schema drift from pre-release 0108/0109 revisions.

Revision ID: 0111_auth_schema_drift_repair
Revises: 0110_remove_ldap_email_linking
Create Date: 2026-08-14
"""

from __future__ import annotations

import uuid

from alembic import op
import sqlalchemy as sa


revision = "0111_auth_schema_drift_repair"
down_revision = "0110_remove_ldap_email_linking"
branch_labels = None
depends_on = None


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _column_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _index_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _unique_constraint_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {
        constraint["name"]
        for constraint in sa.inspect(bind).get_unique_constraints(table_name)
        if constraint.get("name")
    }


def _repair_oidc_authorization_codes(bind) -> None:
    if "oidc_authorization_codes" not in _table_names(bind):
        op.create_table(
            "oidc_authorization_codes",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("provider", sa.String(), nullable=False),
            sa.Column("code_hash", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )

    indexes = _index_names(bind, "oidc_authorization_codes")
    if "ix_oidc_authorization_codes_provider" not in indexes:
        op.create_index(
            "ix_oidc_authorization_codes_provider",
            "oidc_authorization_codes",
            ["provider"],
        )
    if "ix_oidc_authorization_codes_code_hash" not in indexes:
        op.create_index(
            "ix_oidc_authorization_codes_code_hash",
            "oidc_authorization_codes",
            ["code_hash"],
            unique=True,
        )
    if "ix_oidc_authorization_codes_expires_at" not in indexes:
        op.create_index(
            "ix_oidc_authorization_codes_expires_at",
            "oidc_authorization_codes",
            ["expires_at"],
        )


def _repair_auth_challenges(bind) -> None:
    columns = _column_names(bind, "auth_challenges")
    if not columns:
        return

    # Challenges live for five minutes and are bound to a specific login or
    # session. Purging them is safer than translating stale bindings while the
    # legacy foreign-key column is replaced.
    bind.execute(sa.text("DELETE FROM auth_challenges"))

    indexes = _index_names(bind, "auth_challenges")
    with op.batch_alter_table("auth_challenges", schema=None) as batch_op:
        if "ix_auth_challenges_auth_session_id" in indexes:
            batch_op.drop_index("ix_auth_challenges_auth_session_id")
        if "binding_sid" not in columns:
            batch_op.add_column(sa.Column("binding_sid", sa.String(), nullable=True))
        if "auth_session_id" in columns:
            batch_op.drop_column("auth_session_id")

    if "ix_auth_challenges_binding_sid" not in _index_names(bind, "auth_challenges"):
        with op.batch_alter_table("auth_challenges", schema=None) as batch_op:
            batch_op.create_index(
                "ix_auth_challenges_binding_sid",
                ["binding_sid"],
                unique=False,
            )


def _backfill_legacy_external_identities(bind, user_columns: set[str]) -> None:
    legacy_columns = {"auth_provider", "auth_provider_subject"}
    if not legacy_columns.issubset(user_columns):
        return
    if "external_identities" not in _table_names(bind):
        raise RuntimeError(
            "Cannot remove legacy users auth-provider columns before external_identities exists"
        )

    users = sa.table(
        "users",
        sa.column("id", sa.Integer()),
        sa.column("email", sa.String()),
        sa.column("auth_provider", sa.String()),
        sa.column("auth_provider_subject", sa.String()),
    )
    identities = sa.table(
        "external_identities",
        sa.column("id", sa.String()),
        sa.column("user_id", sa.Integer()),
        sa.column("provider_type", sa.String()),
        sa.column("provider_id", sa.String()),
        sa.column("subject", sa.String()),
        sa.column("email", sa.String()),
        sa.column("email_verified", sa.Boolean()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    rows = bind.execute(
        sa.select(
            users.c.id,
            users.c.email,
            users.c.auth_provider,
            users.c.auth_provider_subject,
        ).where(
            users.c.auth_provider.is_not(None),
            users.c.auth_provider_subject.is_not(None),
        )
    ).mappings()
    for row in rows:
        provider = str(row["auth_provider"])
        provider_type = "ldap" if provider.startswith("ldap:") else "oidc"
        provider_id = provider.split(":", 1)[1] if provider_type == "ldap" else provider
        subject = str(row["auth_provider_subject"])
        existing = bind.execute(
            sa.select(identities.c.id).where(
                identities.c.provider_type == provider_type,
                identities.c.provider_id == provider_id,
                identities.c.subject == subject,
            )
        ).scalar_one_or_none()
        if existing is None:
            bind.execute(
                identities.insert().values(
                    id=str(uuid.uuid4()),
                    user_id=row["id"],
                    provider_type=provider_type,
                    provider_id=provider_id,
                    subject=subject,
                    email=row["email"],
                    email_verified=False,
                    created_at=sa.func.now(),
                )
            )


def _remove_legacy_user_identity_columns(bind) -> None:
    columns = _column_names(bind, "users")
    legacy_columns = {"auth_provider", "auth_provider_subject"}
    if not columns.intersection(legacy_columns):
        return

    _backfill_legacy_external_identities(bind, columns)
    constraints = _unique_constraint_names(bind, "users")
    with op.batch_alter_table("users", schema=None) as batch_op:
        if "uq_users_provider_subject" in constraints:
            batch_op.drop_constraint("uq_users_provider_subject", type_="unique")
        if "auth_provider_subject" in columns:
            batch_op.drop_column("auth_provider_subject")
        if "auth_provider" in columns:
            batch_op.drop_column("auth_provider")


def upgrade() -> None:
    bind = op.get_bind()
    _repair_oidc_authorization_codes(bind)
    _repair_auth_challenges(bind)
    _remove_legacy_user_identity_columns(bind)


def downgrade() -> None:
    # Forward-only repair: revision 0109 already made these removals part of the
    # canonical, irreversible authentication cutover.
    pass
