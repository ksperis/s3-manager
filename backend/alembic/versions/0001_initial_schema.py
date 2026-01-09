"""Initial schema

Revision ID: 0001_initial_schema
Revises:
Create Date: 2025-02-01 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.core.security import EncryptedString

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "storage_endpoints",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("endpoint_url", sa.String(), nullable=False),
        sa.Column("admin_endpoint", sa.String(), nullable=True),
        sa.Column("region", sa.String(), nullable=True),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("admin_access_key", sa.String(), nullable=True),
        sa.Column("admin_secret_key", EncryptedString(), nullable=True),
        sa.Column("supervision_access_key", sa.String(), nullable=True),
        sa.Column("supervision_secret_key", EncryptedString(), nullable=True),
        sa.Column("features_config", sa.Text(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_editable", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("name", name="uq_storage_endpoints_name"),
        sa.UniqueConstraint("endpoint_url", name="uq_storage_endpoints_endpoint"),
    )
    op.create_index("ix_storage_endpoints_id", "storage_endpoints", ["id"])

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("full_name", sa.String(), nullable=True),
        sa.Column("display_name", sa.String(), nullable=True),
        sa.Column("picture_url", sa.String(), nullable=True),
        sa.Column("hashed_password", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("is_root", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("rgw_access_key", sa.String(), nullable=True),
        sa.Column("rgw_secret_key", EncryptedString(), nullable=True),
        sa.Column("auth_provider", sa.String(), nullable=True),
        sa.Column("auth_provider_subject", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("email", name="uq_users_email"),
        sa.UniqueConstraint("auth_provider", "auth_provider_subject", name="uq_users_provider_subject"),
    )
    op.create_index("ix_users_id", "users", ["id"])

    op.create_table(
        "s3_accounts",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(), nullable=False, unique=True),
        sa.Column("rgw_account_id", sa.String(), nullable=True, unique=True),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("rgw_access_key", sa.String(), nullable=True),
        sa.Column("rgw_secret_key", EncryptedString(), nullable=True),
        sa.Column("rgw_user_uid", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("storage_endpoint_id", sa.Integer(), sa.ForeignKey("storage_endpoints.id"), nullable=True),
    )
    op.create_index("ix_s3_accounts_id", "s3_accounts", ["id"])

    op.create_table(
        "s3_users",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("rgw_user_uid", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("rgw_access_key", sa.String(), nullable=False),
        sa.Column("rgw_secret_key", EncryptedString(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), sa.ForeignKey("storage_endpoints.id"), nullable=True),
        sa.UniqueConstraint("rgw_user_uid", name="uq_s3_users_uid"),
    )
    op.create_index("ix_s3_users_id", "s3_users", ["id"])

    op.create_table(
        "user_s3_accounts",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("s3_accounts.id"), nullable=False),
        sa.Column("is_root", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("account_role", sa.String(), nullable=False),
        sa.Column("account_admin", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("can_manage_iam", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("can_manage_buckets", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("can_manage_portal_users", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("can_view_root_key", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "account_id", name="uq_user_s3_account"),
    )
    op.create_index("ix_user_s3_accounts_id", "user_s3_accounts", ["id"])

    op.create_table(
        "account_iam_users",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("s3_accounts.id"), nullable=False),
        sa.Column("iam_user_id", sa.String(), nullable=False),
        sa.Column("iam_username", sa.String(), nullable=True),
        sa.Column("active_access_key", sa.String(), nullable=True),
        sa.Column("active_secret_key", EncryptedString(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "account_id", name="uq_account_iam_user"),
        sa.UniqueConstraint("iam_user_id", name="uq_account_iam_user_id"),
    )
    op.create_index("ix_account_iam_users_id", "account_iam_users", ["id"])

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("user_email", sa.String(), nullable=False),
        sa.Column("user_role", sa.String(), nullable=False),
        sa.Column("scope", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("entity_type", sa.String(), nullable=True),
        sa.Column("entity_id", sa.String(), nullable=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("s3_accounts.id"), nullable=True),
        sa.Column("account_name", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("message", sa.String(), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=True),
    )
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])
    op.create_index("ix_audit_logs_id", "audit_logs", ["id"])

    op.create_table(
        "rgw_sessions",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("access_key_enc", sa.String(), nullable=False),
        sa.Column("secret_key_enc", sa.String(), nullable=False),
        sa.Column("access_key_hash", sa.String(), nullable=False),
        sa.Column("actor_type", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("account_id", sa.String(), nullable=True),
        sa.Column("account_name", sa.String(), nullable=True),
        sa.Column("user_uid", sa.String(), nullable=True),
        sa.Column("capabilities", sa.Text(), nullable=True),
        sa.Column("can_manage_iam", sa.Boolean(), nullable=False),
        sa.Column("can_manage_buckets", sa.Boolean(), nullable=False),
        sa.Column("can_view_traffic", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_rgw_sessions_access_key_hash", "rgw_sessions", ["access_key_hash"])
    op.create_index("ix_rgw_sessions_id", "rgw_sessions", ["id"])

    op.create_table(
        "user_s3_users",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("s3_user_id", sa.Integer(), sa.ForeignKey("s3_users.id"), nullable=False),
        sa.UniqueConstraint("user_id", "s3_user_id", name="uq_user_s3_user"),
    )
    op.create_index("ix_user_s3_users_id", "user_s3_users", ["id"])

    op.create_table(
        "oidc_login_states",
        sa.Column("state", sa.String(), primary_key=True, nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("code_verifier", sa.String(), nullable=False),
        sa.Column("nonce", sa.String(), nullable=True),
        sa.Column("redirect_path", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_oidc_login_states_created_at", "oidc_login_states", ["created_at"])
    op.create_index("ix_oidc_login_states_state", "oidc_login_states", ["state"])


def downgrade() -> None:
    op.drop_index("ix_oidc_login_states_state", table_name="oidc_login_states")
    op.drop_index("ix_oidc_login_states_created_at", table_name="oidc_login_states")
    op.drop_table("oidc_login_states")

    op.drop_index("ix_user_s3_users_id", table_name="user_s3_users")
    op.drop_table("user_s3_users")

    op.drop_index("ix_rgw_sessions_id", table_name="rgw_sessions")
    op.drop_index("ix_rgw_sessions_access_key_hash", table_name="rgw_sessions")
    op.drop_table("rgw_sessions")

    op.drop_index("ix_audit_logs_id", table_name="audit_logs")
    op.drop_index("ix_audit_logs_created_at", table_name="audit_logs")
    op.drop_table("audit_logs")

    op.drop_index("ix_account_iam_users_id", table_name="account_iam_users")
    op.drop_table("account_iam_users")

    op.drop_index("ix_user_s3_accounts_id", table_name="user_s3_accounts")
    op.drop_table("user_s3_accounts")

    op.drop_index("ix_s3_users_id", table_name="s3_users")
    op.drop_table("s3_users")

    op.drop_index("ix_s3_accounts_id", table_name="s3_accounts")
    op.drop_table("s3_accounts")

    op.drop_index("ix_users_id", table_name="users")
    op.drop_table("users")

    op.drop_index("ix_storage_endpoints_id", table_name="storage_endpoints")
    op.drop_table("storage_endpoints")
