# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove provider indexes duplicated by unique constraints.

Revision ID: 0076_remove_redundant_provider_indexes
Revises: 0075_canonical_s3_session_capabilities
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "0076_remove_redundant_provider_indexes"
down_revision = "0075_canonical_s3_session_capabilities"
branch_labels = None
depends_on = None


PROVIDER_INDEXES = (
    ("ldap_providers", "ix_ldap_providers_provider_id"),
    ("oidc_providers", "ix_oidc_providers_provider_id"),
)


def upgrade() -> None:
    for table_name, index_name in PROVIDER_INDEXES:
        op.drop_index(index_name, table_name=table_name)


def downgrade() -> None:
    for table_name, index_name in PROVIDER_INDEXES:
        op.create_index(index_name, table_name, ["provider_id"], unique=False)
