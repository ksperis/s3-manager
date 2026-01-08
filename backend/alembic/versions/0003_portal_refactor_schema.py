"""Portal refactor schema

Revision ID: 0003_portal_refactor_schema
Revises: 0002_remove_account_quota_columns
Create Date: 2026-01-08 00:00:01
"""

from __future__ import annotations

from datetime import datetime

from alembic import op
import sqlalchemy as sa


revision = "0003_portal_refactor_schema"
down_revision = "0002_remove_account_quota_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Core columns ---
    with op.batch_alter_table("s3_accounts") as batch_op:
        batch_op.add_column(
            sa.Column(
                "kind",
                sa.String(),
                nullable=False,
                server_default="iam_account",
            )
        )

    with op.batch_alter_table("storage_endpoints") as batch_op:
        batch_op.add_column(sa.Column("presign_enabled", sa.Boolean(), nullable=False, server_default="1"))
        batch_op.add_column(sa.Column("allow_external_access", sa.Boolean(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("max_session_duration", sa.Integer(), nullable=False, server_default="3600"))
        batch_op.add_column(sa.Column("allowed_packages", sa.JSON(), nullable=True))

    with op.batch_alter_table("audit_logs") as batch_op:
        batch_op.add_column(sa.Column("surface", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("workflow", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("executor_type", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("executor_principal", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("delta_json", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("error", sa.Text(), nullable=True))

    # --- Portal RBAC tables ---
    op.create_table(
        "portal_permissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.UniqueConstraint("key", name="uq_portal_permissions_key"),
    )
    op.create_index("ix_portal_permissions_id", "portal_permissions", ["id"])

    op.create_table(
        "portal_roles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.UniqueConstraint("key", name="uq_portal_roles_key"),
    )
    op.create_index("ix_portal_roles_id", "portal_roles", ["id"])

    op.create_table(
        "portal_role_permissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("role_id", sa.Integer(), sa.ForeignKey("portal_roles.id"), nullable=False),
        sa.Column("permission_id", sa.Integer(), sa.ForeignKey("portal_permissions.id"), nullable=False),
        sa.UniqueConstraint("role_id", "permission_id", name="uq_portal_role_permission"),
    )
    op.create_index("ix_portal_role_permissions_id", "portal_role_permissions", ["id"])

    op.create_table(
        "portal_memberships",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("s3_accounts.id"), nullable=False),
        sa.Column("role_key", sa.String(), nullable=False, server_default="Viewer"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("user_id", "account_id", name="uq_portal_membership"),
    )
    op.create_index("ix_portal_memberships_id", "portal_memberships", ["id"])

    op.create_table(
        "portal_role_bindings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("s3_accounts.id"), nullable=False),
        sa.Column("role_id", sa.Integer(), sa.ForeignKey("portal_roles.id"), nullable=False),
        sa.Column("bucket", sa.String(), nullable=True),
        sa.Column("prefix", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("user_id", "account_id", "role_id", "bucket", "prefix", name="uq_portal_role_binding"),
    )
    op.create_index("ix_portal_role_bindings_id", "portal_role_bindings", ["id"])

    # --- Portal associations ---
    op.create_table(
        "manager_root_access",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("s3_accounts.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("user_id", "account_id", name="uq_manager_root_access"),
    )
    op.create_index("ix_manager_root_access_id", "manager_root_access", ["id"])

    op.create_table(
        "iam_identities",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("s3_accounts.id"), nullable=False),
        sa.Column("iam_user_id", sa.String(), nullable=True),
        sa.Column("iam_username", sa.String(), nullable=True),
        sa.Column("arn", sa.String(), nullable=True),
        sa.Column("active_access_key_id", sa.String(), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("user_id", "account_id", name="uq_iam_identity_user_account"),
    )
    op.create_index("ix_iam_identities_id", "iam_identities", ["id"])

    op.create_table(
        "access_grants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("iam_identity_id", sa.Integer(), sa.ForeignKey("iam_identities.id"), nullable=False),
        sa.Column("package_key", sa.String(), nullable=False),
        sa.Column("bucket", sa.String(), nullable=False),
        sa.Column("prefix", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("materialization_status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("materialization_error", sa.Text(), nullable=True),
        sa.Column("iam_group_name", sa.String(), nullable=True),
        sa.Column("iam_policy_arn", sa.String(), nullable=True),
        sa.UniqueConstraint("iam_identity_id", "package_key", "bucket", "prefix", name="uq_access_grant"),
    )
    op.create_index("ix_access_grants_id", "access_grants", ["id"])

    # --- Seed default roles/permissions ---
    bind = op.get_bind()
    permissions = [
        ("portal.dashboard.view", "View portal dashboard"),
        ("portal.buckets.view", "List buckets"),
        ("portal.browser.view", "Use integrated browser"),
        ("portal.objects.list", "List objects"),
        ("portal.objects.get", "Download objects"),
        ("portal.objects.put", "Upload objects"),
        ("portal.objects.delete", "Delete objects"),
        ("portal.external.self.manage", "Manage own external access"),
        ("portal.external.team.manage", "Manage team external access"),
        ("portal.members.view", "View members"),
        ("portal.members.manage", "Manage members"),
        ("portal.audit.view", "View audit logs"),
        ("portal.admin.view", "View account admin settings"),
        ("portal.bucket.create", "Create bucket via portal workflow"),
    ]
    roles = [
        ("Viewer", "Read-only portal access"),
        ("AccessAdmin", "Manage access packages and external access"),
        ("AccountAdmin", "Full portal administration for the account"),
    ]
    now = datetime.utcnow()
    bind.execute(sa.text("INSERT OR IGNORE INTO portal_permissions(key, description) VALUES (:k, :d)"), [{"k": k, "d": d} for k, d in permissions])
    bind.execute(sa.text("INSERT OR IGNORE INTO portal_roles(key, description) VALUES (:k, :d)"), [{"k": k, "d": d} for k, d in roles])

    role_rows = bind.execute(sa.text("SELECT id, key FROM portal_roles")).fetchall()
    perm_rows = bind.execute(sa.text("SELECT id, key FROM portal_permissions")).fetchall()
    role_ids = {row[1]: row[0] for row in role_rows}
    perm_ids = {row[1]: row[0] for row in perm_rows}

    viewer_perms = [
        "portal.dashboard.view",
        "portal.buckets.view",
        "portal.browser.view",
        "portal.objects.list",
        "portal.objects.get",
    ]
    access_admin_perms = viewer_perms + [
        "portal.objects.put",
        "portal.objects.delete",
        "portal.external.self.manage",
        "portal.external.team.manage",
        "portal.members.view",
        "portal.audit.view",
    ]
    account_admin_perms = access_admin_perms + [
        "portal.members.manage",
        "portal.admin.view",
        "portal.bucket.create",
    ]
    mappings: list[dict] = []
    for key in viewer_perms:
        mappings.append({"role_id": role_ids["Viewer"], "permission_id": perm_ids[key]})
    for key in access_admin_perms:
        mappings.append({"role_id": role_ids["AccessAdmin"], "permission_id": perm_ids[key]})
    for key in account_admin_perms:
        mappings.append({"role_id": role_ids["AccountAdmin"], "permission_id": perm_ids[key]})
    bind.execute(
        sa.text("INSERT OR IGNORE INTO portal_role_permissions(role_id, permission_id) VALUES (:role_id, :permission_id)"),
        mappings,
    )

    # --- Migrate existing links ---
    # user_s3_accounts => portal_memberships + manager_root_access
    user_links = bind.execute(
        sa.text(
            "SELECT user_id, account_id, is_root, account_role, account_admin, can_manage_portal_users "
            "FROM user_s3_accounts"
        )
    ).fetchall()
    membership_rows: list[dict] = []
    binding_rows: list[dict] = []
    root_rows: list[dict] = []
    for user_id, account_id, is_root, account_role, account_admin, can_manage_portal_users in user_links:
        if not account_id:
            continue
        if account_role == "portal_none":
            continue
        role_key = "Viewer"
        if bool(is_root) or bool(account_admin) or bool(can_manage_portal_users) or account_role == "portal_manager":
            role_key = "AccountAdmin"
        membership_rows.append(
            {
                "user_id": user_id,
                "account_id": account_id,
                "role_key": role_key,
                "created_at": now,
                "updated_at": now,
            }
        )
        binding_rows.append(
            {
                "user_id": user_id,
                "account_id": account_id,
                "role_id": role_ids[role_key],
                "bucket": None,
                "prefix": None,
                "created_at": now,
            }
        )
        if bool(is_root) or bool(account_admin):
            root_rows.append({"user_id": user_id, "account_id": account_id, "created_at": now})

    if membership_rows:
        bind.execute(
            sa.text(
                "INSERT OR IGNORE INTO portal_memberships(user_id, account_id, role_key, created_at, updated_at) "
                "VALUES (:user_id, :account_id, :role_key, :created_at, :updated_at)"
            ),
            membership_rows,
        )
    if binding_rows:
        bind.execute(
            sa.text(
                "INSERT OR IGNORE INTO portal_role_bindings(user_id, account_id, role_id, bucket, prefix, created_at) "
                "VALUES (:user_id, :account_id, :role_id, :bucket, :prefix, :created_at)"
            ),
            binding_rows,
        )
    if root_rows:
        bind.execute(
            sa.text(
                "INSERT OR IGNORE INTO manager_root_access(user_id, account_id, created_at) "
                "VALUES (:user_id, :account_id, :created_at)"
            ),
            root_rows,
        )

    # account_iam_users => iam_identities (and wipe stored secrets)
    try:
        iam_links = bind.execute(
            sa.text(
                "SELECT user_id, account_id, iam_user_id, iam_username, iam_role_arn, active_access_key "
                "FROM account_iam_users"
            )
        ).fetchall()
        iam_rows: list[dict] = []
        for user_id, account_id, iam_user_id, iam_username, iam_role_arn, active_access_key in iam_links:
            iam_rows.append(
                {
                    "user_id": user_id,
                    "account_id": account_id,
                    "iam_user_id": iam_user_id,
                    "iam_username": iam_username,
                    "arn": iam_role_arn,
                    "active_access_key_id": active_access_key,
                    "is_enabled": True,
                    "created_at": now,
                    "updated_at": now,
                }
            )
        if iam_rows:
            bind.execute(
                sa.text(
                    "INSERT OR IGNORE INTO iam_identities("
                    "user_id, account_id, iam_user_id, iam_username, arn, active_access_key_id, is_enabled, created_at, updated_at"
                    ") VALUES ("
                    ":user_id, :account_id, :iam_user_id, :iam_username, :arn, :active_access_key_id, :is_enabled, :created_at, :updated_at"
                    ")"
                ),
                iam_rows,
            )
        bind.execute(sa.text("UPDATE account_iam_users SET active_secret_key = NULL"))
    except Exception:
        # Best-effort migration (table may not exist in some environments)
        pass


def downgrade() -> None:
    op.drop_index("ix_access_grants_id", table_name="access_grants")
    op.drop_table("access_grants")
    op.drop_index("ix_iam_identities_id", table_name="iam_identities")
    op.drop_table("iam_identities")
    op.drop_index("ix_manager_root_access_id", table_name="manager_root_access")
    op.drop_table("manager_root_access")
    op.drop_index("ix_portal_role_bindings_id", table_name="portal_role_bindings")
    op.drop_table("portal_role_bindings")
    op.drop_index("ix_portal_memberships_id", table_name="portal_memberships")
    op.drop_table("portal_memberships")
    op.drop_index("ix_portal_role_permissions_id", table_name="portal_role_permissions")
    op.drop_table("portal_role_permissions")
    op.drop_index("ix_portal_roles_id", table_name="portal_roles")
    op.drop_table("portal_roles")
    op.drop_index("ix_portal_permissions_id", table_name="portal_permissions")
    op.drop_table("portal_permissions")

    with op.batch_alter_table("audit_logs") as batch_op:
        batch_op.drop_column("error")
        batch_op.drop_column("delta_json")
        batch_op.drop_column("executor_principal")
        batch_op.drop_column("executor_type")
        batch_op.drop_column("workflow")
        batch_op.drop_column("surface")

    with op.batch_alter_table("storage_endpoints") as batch_op:
        batch_op.drop_column("allowed_packages")
        batch_op.drop_column("max_session_duration")
        batch_op.drop_column("allow_external_access")
        batch_op.drop_column("presign_enabled")

    with op.batch_alter_table("s3_accounts") as batch_op:
        batch_op.drop_column("kind")

