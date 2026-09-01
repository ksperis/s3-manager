# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add OIDC linking policy and external identity provenance.

Revision ID: 0121_identity_security_policies
Revises: 0120_bucket_ui_tag_definition_settings
Create Date: 2026-09-01
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0121_identity_security_policies"
down_revision = "0120_bucket_ui_tag_definition_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("oidc_providers", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("linking_policy", sa.String(), nullable=False, server_default="manual")
        )
        batch_op.add_column(
            sa.Column("trusted_email_domains_json", sa.Text(), nullable=False, server_default="[]")
        )
    with op.batch_alter_table("external_identities", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("link_source", sa.String(), nullable=False, server_default="jit")
        )
    with op.batch_alter_table("external_identity_link_requests", schema=None) as batch_op:
        batch_op.add_column(sa.Column("decision_source", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("external_identity_link_requests", schema=None) as batch_op:
        batch_op.drop_column("decision_source")
    with op.batch_alter_table("external_identities", schema=None) as batch_op:
        batch_op.drop_column("link_source")
    with op.batch_alter_table("oidc_providers", schema=None) as batch_op:
        batch_op.drop_column("trusted_email_domains_json")
        batch_op.drop_column("linking_policy")
