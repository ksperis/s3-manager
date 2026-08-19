# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Perform the destructive authentication cutover.

Revision ID: 0109_authentication_cutover
Revises: 0108_federation_mfa_rate_limits
Create Date: 2026-08-14
"""

from __future__ import annotations

import os
import uuid

from alembic import op
import sqlalchemy as sa


revision = "0109_authentication_cutover"
down_revision = "0108_federation_mfa_rate_limits"
branch_labels = None
depends_on = None

_BACKUP_VERIFIED_ENV = "BUCKETREEF_DB_BACKUP_VERIFIED"


def _require_backup_for_destructive_cutover(bind) -> None:
    tables = set(sa.inspect(bind).get_table_names())
    destructive_tables = [
        name
        for name in ("refresh_sessions", "api_tokens", "s3_sessions", "oidc_login_states")
        if name in tables and int(bind.execute(sa.text(f'SELECT COUNT(*) FROM "{name}"')).scalar() or 0) > 0
    ]
    if not destructive_tables:
        return
    confirmed = str(os.getenv(_BACKUP_VERIFIED_ENV) or "").strip().lower()
    if confirmed not in {"1", "true", "yes", "on"}:
        raise RuntimeError(
            "Authentication cutover will irreversibly revoke or erase legacy authentication data in "
            f"{', '.join(destructive_tables)}. Verify a restorable database backup, then set "
            f"{_BACKUP_VERIFIED_ENV}=true for the migration run."
        )


def upgrade() -> None:
    bind = op.get_bind()
    _require_backup_for_destructive_cutover(bind)
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
    now = sa.func.now()
    for row in bind.execute(
        sa.select(users.c.id, users.c.email, users.c.auth_provider, users.c.auth_provider_subject).where(
            users.c.auth_provider.is_not(None),
            users.c.auth_provider_subject.is_not(None),
        )
    ).mappings():
        provider = str(row["auth_provider"])
        provider_type = "ldap" if provider.startswith("ldap:") else "oidc"
        provider_id = provider.split(":", 1)[1] if provider_type == "ldap" else provider
        bind.execute(
            identities.insert().values(
                id=str(uuid.uuid4()),
                user_id=row["id"],
                provider_type=provider_type,
                provider_id=provider_id,
                subject=row["auth_provider_subject"],
                email=row["email"],
                # The legacy schema did not retain evidence that the provider
                # asserted a verified address. Preserve the immutable subject
                # mapping without manufacturing that assurance.
                email_verified=False,
                created_at=now,
            )
        )

    # Deliberate big-bang revocation: no pre-cutover browser, S3 or API bearer survives.
    if "refresh_sessions" in sa.inspect(bind).get_table_names():
        bind.execute(sa.text("DELETE FROM refresh_sessions"))
    bind.execute(sa.text("DELETE FROM refresh_tokens"))
    bind.execute(sa.text("DELETE FROM auth_sessions"))
    bind.execute(sa.text("DELETE FROM oidc_login_states"))
    bind.execute(sa.text("UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL"))
    bind.execute(sa.text("DELETE FROM s3_sessions"))

    if "refresh_sessions" in sa.inspect(bind).get_table_names():
        op.drop_table("refresh_sessions")

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_constraint("uq_users_provider_subject", type_="unique")
        batch_op.drop_column("auth_provider_subject")
        batch_op.drop_column("auth_provider")

    with op.batch_alter_table("s3_sessions", schema=None) as batch_op:
        batch_op.alter_column("idle_expires_at", existing_type=sa.DateTime(timezone=True), nullable=False)
        batch_op.alter_column("absolute_expires_at", existing_type=sa.DateTime(timezone=True), nullable=False)


def downgrade() -> None:
    raise RuntimeError(
        "Authentication cutover is irreversible: erased S3 credentials and revoked "
        "sessions/tokens cannot be restored. Restore the mandatory pre-deployment "
        "database backup instead."
    )
