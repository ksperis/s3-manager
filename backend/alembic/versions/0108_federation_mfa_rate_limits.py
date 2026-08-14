# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add external identities, WebAuthn, recovery and persistent rate limits.

Revision ID: 0108_federation_mfa_rate_limits
Revises: 0107_auth_session_foundation
Create Date: 2026-08-14
"""

from alembic import op
import sqlalchemy as sa


revision = "0108_federation_mfa_rate_limits"
down_revision = "0107_auth_session_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "oidc_authorization_codes",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("code_hash", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_oidc_authorization_codes_provider", "oidc_authorization_codes", ["provider"])
    op.create_index("ix_oidc_authorization_codes_code_hash", "oidc_authorization_codes", ["code_hash"], unique=True)
    op.create_index("ix_oidc_authorization_codes_expires_at", "oidc_authorization_codes", ["expires_at"])

    op.create_table(
        "external_identities",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("provider_type", sa.String(), nullable=False),
        sa.Column("provider_id", sa.String(), nullable=False),
        sa.Column("subject", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_type", "provider_id", "subject", name="uq_external_identity_subject"),
    )
    for column in ("user_id", "email", "revoked_at"):
        op.create_index(f"ix_external_identities_{column}", "external_identities", [column], unique=False)

    op.create_table(
        "external_identity_link_requests",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("provider_type", sa.String(), nullable=False),
        sa.Column("provider_id", sa.String(), nullable=False),
        sa.Column("subject", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=True),
        sa.Column("picture_url", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by_user_id", sa.Integer(), nullable=True),
        sa.Column("decision_reason", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["decided_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_type", "provider_id", "subject", name="uq_external_link_request_subject"),
    )
    op.create_index("ix_external_identity_link_requests_user_id", "external_identity_link_requests", ["user_id"])
    op.create_index("ix_external_identity_link_requests_status", "external_identity_link_requests", ["status"])

    op.create_table(
        "webauthn_credentials",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("credential_id", sa.String(), nullable=False),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column("sign_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("transports_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_webauthn_credentials_user_id", "webauthn_credentials", ["user_id"])
    op.create_index("ix_webauthn_credentials_credential_id", "webauthn_credentials", ["credential_id"], unique=True)
    op.create_index("ix_webauthn_credentials_revoked_at", "webauthn_credentials", ["revoked_at"])

    op.create_table(
        "auth_challenges",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("binding_sid", sa.String(), nullable=True),
        sa.Column("purpose", sa.String(), nullable=False),
        sa.Column("challenge_hash", sa.String(), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("challenge_hash"),
    )
    for column in ("user_id", "binding_sid", "purpose", "expires_at"):
        op.create_index(f"ix_auth_challenges_{column}", "auth_challenges", [column])

    op.create_table(
        "recovery_codes",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("code_hash", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code_hash"),
    )
    op.create_index("ix_recovery_codes_user_id", "recovery_codes", ["user_id"])
    op.create_index("ix_recovery_codes_consumed_at", "recovery_codes", ["consumed_at"])

    op.create_table(
        "auth_rate_limits",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("bucket_key", sa.String(), nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("bucket_key", "window_started_at", name="uq_auth_rate_limit_window"),
    )
    op.create_index("ix_auth_rate_limits_bucket_key", "auth_rate_limits", ["bucket_key"])


def downgrade() -> None:
    op.drop_index("ix_auth_rate_limits_bucket_key", table_name="auth_rate_limits")
    op.drop_table("auth_rate_limits")
    op.drop_index("ix_recovery_codes_consumed_at", table_name="recovery_codes")
    op.drop_index("ix_recovery_codes_user_id", table_name="recovery_codes")
    op.drop_table("recovery_codes")
    for column in ("expires_at", "purpose", "binding_sid", "user_id"):
        op.drop_index(f"ix_auth_challenges_{column}", table_name="auth_challenges")
    op.drop_table("auth_challenges")
    op.drop_index("ix_webauthn_credentials_revoked_at", table_name="webauthn_credentials")
    op.drop_index("ix_webauthn_credentials_credential_id", table_name="webauthn_credentials")
    op.drop_index("ix_webauthn_credentials_user_id", table_name="webauthn_credentials")
    op.drop_table("webauthn_credentials")
    op.drop_index("ix_external_identity_link_requests_status", table_name="external_identity_link_requests")
    op.drop_index("ix_external_identity_link_requests_user_id", table_name="external_identity_link_requests")
    op.drop_table("external_identity_link_requests")
    for column in ("revoked_at", "email", "user_id"):
        op.drop_index(f"ix_external_identities_{column}", table_name="external_identities")
    op.drop_table("external_identities")
    op.drop_index("ix_oidc_authorization_codes_expires_at", table_name="oidc_authorization_codes")
    op.drop_index("ix_oidc_authorization_codes_code_hash", table_name="oidc_authorization_codes")
    op.drop_index("ix_oidc_authorization_codes_provider", table_name="oidc_authorization_codes")
    op.drop_table("oidc_authorization_codes")
