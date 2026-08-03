# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Encrypt any remaining plaintext credential fields.

Revision ID: 0098_encrypt_plaintext_secrets
Revises: 0097_remove_unused_rollup_extrema
Create Date: 2026-08-03
"""

from __future__ import annotations

import base64
import binascii

from alembic import op
import sqlalchemy as sa

from app.core.security import decrypt_secret, encrypt_secret


revision = "0098_encrypt_plaintext_secrets"
down_revision = "0097_remove_unused_rollup_extrema"
branch_labels = None
depends_on = None


_SECRET_COLUMNS: dict[str, tuple[str, ...]] = {
    "storage_endpoints": (
        "admin_secret_key",
        "supervision_secret_key",
        "ceph_admin_secret_key",
    ),
    "s3_accounts": ("rgw_secret_key",),
    "account_iam_users": ("active_secret_key",),
    "s3_users": ("rgw_secret_key",),
    "s3_connections": ("secret_access_key", "session_token"),
    "ldap_providers": ("bind_password",),
    "oidc_providers": ("client_secret",),
    "s3_sessions": ("access_key_enc", "secret_key_enc"),
}


def _looks_like_fernet_token(value: str) -> bool:
    try:
        decoded = base64.urlsafe_b64decode(value.encode())
    except (ValueError, binascii.Error):
        return False
    return len(decoded) >= 73 and decoded[0] == 0x80


def _canonicalize_column(bind, table_name: str, column_name: str) -> None:
    rows = bind.execute(
        sa.text(
            f"SELECT id, {column_name} FROM {table_name} "
            f"WHERE {column_name} IS NOT NULL"
        )
    ).mappings().all()
    for row in rows:
        value = str(row[column_name])
        try:
            decrypt_secret(value)
            continue
        except ValueError:
            if _looks_like_fernet_token(value):
                raise RuntimeError(
                    "Unable to decrypt an encrypted credential in "
                    f"{table_name}.{column_name} for row {row['id']!r}. "
                    "Configure every historical credential key before upgrading."
                ) from None

        bind.execute(
            sa.text(
                f"UPDATE {table_name} SET {column_name} = :value "
                "WHERE id = :row_id"
            ),
            {"value": encrypt_secret(value), "row_id": row["id"]},
        )


def upgrade() -> None:
    bind = op.get_bind()
    for table_name, column_names in _SECRET_COLUMNS.items():
        for column_name in column_names:
            _canonicalize_column(bind, table_name, column_name)


def downgrade() -> None:
    # Keeping credentials encrypted is safe for the previous application version.
    pass
