"""Add projects for portal account grouping.

Revision ID: 0063_projects_portal_associations
Revises: 0062_add_ceph_zonegroup_to_storage_endpoints
Create Date: 2026-07-04 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0063_projects_portal_associations"
down_revision = "0062_add_ceph_zonegroup_to_storage_endpoints"
branch_labels = None
depends_on = None


PORTAL_ROLES = ("portal_user", "portal_manager")


def _unique_project_name(connection, base_name: str) -> str:
    candidate = base_name[:160]
    counter = 2
    while connection.execute(
        sa.text("SELECT 1 FROM projects WHERE lower(name) = lower(:name)"),
        {"name": candidate},
    ).first():
        suffix = f" ({counter})"
        candidate = f"{base_name[: 160 - len(suffix)]}{suffix}"
        counter += 1
    return candidate


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_projects_name"),
    )
    op.create_index(op.f("ix_projects_id"), "projects", ["id"], unique=False)
    op.create_index(op.f("ix_projects_name"), "projects", ["name"], unique=False)

    op.create_table(
        "project_s3_accounts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["s3_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "account_id", name="uq_project_s3_account"),
    )
    op.create_index(op.f("ix_project_s3_accounts_id"), "project_s3_accounts", ["id"], unique=False)
    op.create_index(
        "ix_project_s3_accounts_account_project",
        "project_s3_accounts",
        ["account_id", "project_id"],
        unique=False,
    )

    op.create_table(
        "user_projects",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("account_role", sa.String(), server_default="portal_user", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "project_id", name="uq_user_project"),
    )
    op.create_index(op.f("ix_user_projects_id"), "user_projects", ["id"], unique=False)
    op.create_index("ix_user_projects_project_user", "user_projects", ["project_id", "user_id"], unique=False)

    op.create_table(
        "ui_group_projects",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("account_role", sa.String(), server_default="portal_user", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["ui_groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("group_id", "project_id", name="uq_ui_group_project"),
    )
    op.create_index(op.f("ix_ui_group_projects_id"), "ui_group_projects", ["id"], unique=False)
    op.create_index(
        "ix_ui_group_projects_project_group",
        "ui_group_projects",
        ["project_id", "group_id"],
        unique=False,
    )

    connection = op.get_bind()
    accounts = connection.execute(
        sa.text(
            """
            SELECT DISTINCT a.id, a.name
            FROM s3_accounts a
            WHERE EXISTS (
                SELECT 1 FROM user_s3_accounts usa
                WHERE usa.account_id = a.id AND usa.account_role IN ('portal_user', 'portal_manager')
            )
            OR EXISTS (
                SELECT 1 FROM ui_group_s3_accounts gsa
                WHERE gsa.account_id = a.id AND gsa.account_role IN ('portal_user', 'portal_manager')
            )
            ORDER BY lower(a.name), a.id
            """
        )
    ).all()

    account_project_ids: dict[int, int] = {}
    for account_id, account_name in accounts:
        project_name = _unique_project_name(connection, account_name or f"S3 Account {account_id}")
        result = connection.execute(
            sa.text(
                """
                INSERT INTO projects (name, description, created_at, updated_at)
                VALUES (:name, :description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """
            ),
            {
                "name": project_name,
                "description": f"Migrated portal project for S3 Account {account_name or account_id}.",
            },
        )
        project_id = result.lastrowid
        if project_id is None:
            project_id = connection.execute(sa.text("SELECT id FROM projects WHERE name = :name"), {"name": project_name}).scalar()
        account_project_ids[int(account_id)] = int(project_id)
        connection.execute(
            sa.text(
                """
                INSERT INTO project_s3_accounts
                    (project_id, account_id, display_name, sort_order, created_at, updated_at)
                VALUES (:project_id, :account_id, :display_name, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """
            ),
            {
                "project_id": project_id,
                "account_id": account_id,
                "display_name": account_name or f"S3 Account {account_id}",
            },
        )

    user_rows = connection.execute(
        sa.text(
            """
            SELECT user_id, account_id, account_role
            FROM user_s3_accounts
            WHERE account_role IN ('portal_user', 'portal_manager')
            """
        )
    ).all()
    for user_id, account_id, account_role in user_rows:
        project_id = account_project_ids.get(int(account_id))
        if project_id is None:
            continue
        connection.execute(
            sa.text(
                """
                INSERT INTO user_projects (user_id, project_id, account_role, created_at, updated_at)
                VALUES (:user_id, :project_id, :account_role, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, project_id) DO UPDATE SET
                    account_role = CASE
                        WHEN user_projects.account_role = 'portal_manager'
                             OR excluded.account_role = 'portal_manager'
                        THEN 'portal_manager'
                        ELSE excluded.account_role
                    END,
                    updated_at = CURRENT_TIMESTAMP
                """
            ),
            {"user_id": user_id, "project_id": project_id, "account_role": account_role},
        )

    group_rows = connection.execute(
        sa.text(
            """
            SELECT group_id, account_id, account_role
            FROM ui_group_s3_accounts
            WHERE account_role IN ('portal_user', 'portal_manager')
            """
        )
    ).all()
    for group_id, account_id, account_role in group_rows:
        project_id = account_project_ids.get(int(account_id))
        if project_id is None:
            continue
        connection.execute(
            sa.text(
                """
                INSERT INTO ui_group_projects (group_id, project_id, account_role, created_at, updated_at)
                VALUES (:group_id, :project_id, :account_role, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT(group_id, project_id) DO UPDATE SET
                    account_role = CASE
                        WHEN ui_group_projects.account_role = 'portal_manager'
                             OR excluded.account_role = 'portal_manager'
                        THEN 'portal_manager'
                        ELSE excluded.account_role
                    END,
                    updated_at = CURRENT_TIMESTAMP
                """
            ),
            {"group_id": group_id, "project_id": project_id, "account_role": account_role},
        )

    connection.execute(
        sa.text("UPDATE user_s3_accounts SET account_role = 'portal_none' WHERE account_role IN :roles").bindparams(
            sa.bindparam("roles", expanding=True)
        ),
        {"roles": PORTAL_ROLES},
    )
    connection.execute(
        sa.text("UPDATE ui_group_s3_accounts SET account_role = 'portal_none' WHERE account_role IN :roles").bindparams(
            sa.bindparam("roles", expanding=True)
        ),
        {"roles": PORTAL_ROLES},
    )


def downgrade() -> None:
    connection = op.get_bind()
    restored_user_rows = connection.execute(
        sa.text(
            """
            SELECT up.user_id, psa.account_id, up.account_role
            FROM user_projects up
            JOIN project_s3_accounts psa ON psa.project_id = up.project_id
            """
        )
    ).all()
    for user_id, account_id, account_role in restored_user_rows:
        connection.execute(
            sa.text(
                """
                INSERT INTO user_s3_accounts
                    (user_id, account_id, is_root, account_admin, account_role, created_at, updated_at)
                VALUES (:user_id, :account_id, 0, 0, :account_role, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, account_id) DO UPDATE SET
                    account_role = CASE
                        WHEN user_s3_accounts.account_role = 'portal_manager'
                             OR excluded.account_role = 'portal_manager'
                        THEN 'portal_manager'
                        ELSE excluded.account_role
                    END,
                    updated_at = CURRENT_TIMESTAMP
                """
            ),
            {"user_id": user_id, "account_id": account_id, "account_role": account_role},
        )

    restored_group_rows = connection.execute(
        sa.text(
            """
            SELECT gp.group_id, psa.account_id, gp.account_role
            FROM ui_group_projects gp
            JOIN project_s3_accounts psa ON psa.project_id = gp.project_id
            """
        )
    ).all()
    for group_id, account_id, account_role in restored_group_rows:
        connection.execute(
            sa.text(
                """
                INSERT INTO ui_group_s3_accounts
                    (group_id, account_id, account_admin, account_role, created_at, updated_at)
                VALUES (:group_id, :account_id, 0, :account_role, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT(group_id, account_id) DO UPDATE SET
                    account_role = CASE
                        WHEN ui_group_s3_accounts.account_role = 'portal_manager'
                             OR excluded.account_role = 'portal_manager'
                        THEN 'portal_manager'
                        ELSE excluded.account_role
                    END,
                    updated_at = CURRENT_TIMESTAMP
                """
            ),
            {"group_id": group_id, "account_id": account_id, "account_role": account_role},
        )

    op.drop_index("ix_ui_group_projects_project_group", table_name="ui_group_projects")
    op.drop_index(op.f("ix_ui_group_projects_id"), table_name="ui_group_projects")
    op.drop_table("ui_group_projects")
    op.drop_index("ix_user_projects_project_user", table_name="user_projects")
    op.drop_index(op.f("ix_user_projects_id"), table_name="user_projects")
    op.drop_table("user_projects")
    op.drop_index("ix_project_s3_accounts_account_project", table_name="project_s3_accounts")
    op.drop_index(op.f("ix_project_s3_accounts_id"), table_name="project_s3_accounts")
    op.drop_table("project_s3_accounts")
    op.drop_index(op.f("ix_projects_name"), table_name="projects")
    op.drop_index(op.f("ix_projects_id"), table_name="projects")
    op.drop_table("projects")
