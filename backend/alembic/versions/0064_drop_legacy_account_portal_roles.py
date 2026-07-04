"""Drop legacy direct account portal role fields.

Revision ID: 0064_drop_legacy_account_portal_roles
Revises: 0063_projects_portal_associations
Create Date: 2026-07-04 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0064_drop_legacy_account_portal_roles"
down_revision = "0063_projects_portal_associations"
branch_labels = None
depends_on = None


def _has_column(connection, table_name: str, column_name: str) -> bool:  # noqa: ANN001
    inspector = sa.inspect(connection)
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def _unique_project_name(connection, base_name: str) -> str:  # noqa: ANN001
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


def _ensure_project_for_account(connection, account_id: int, account_name: str | None) -> int:  # noqa: ANN001
    existing_project_id = connection.execute(
        sa.text(
            """
            SELECT project_id
            FROM project_s3_accounts
            WHERE account_id = :account_id
            ORDER BY sort_order, project_id
            LIMIT 1
            """
        ),
        {"account_id": account_id},
    ).scalar()
    if existing_project_id is not None:
        return int(existing_project_id)

    label = account_name or f"S3 Account {account_id}"
    project_name = _unique_project_name(connection, label)
    result = connection.execute(
        sa.text(
            """
            INSERT INTO projects (name, description, created_at, updated_at)
            VALUES (:name, :description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """
        ),
        {
            "name": project_name,
            "description": f"Migrated portal project for S3 Account {label}.",
        },
    )
    project_id = result.lastrowid
    if project_id is None:
        project_id = connection.execute(
            sa.text("SELECT id FROM projects WHERE name = :name"),
            {"name": project_name},
        ).scalar()
    connection.execute(
        sa.text(
            """
            INSERT INTO project_s3_accounts
                (project_id, account_id, display_name, sort_order, created_at, updated_at)
            VALUES (:project_id, :account_id, :display_name, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """
        ),
        {"project_id": project_id, "account_id": account_id, "display_name": label},
    )
    return int(project_id)


def _migrate_user_roles(connection) -> None:  # noqa: ANN001
    rows = connection.execute(
        sa.text(
            """
            SELECT usa.user_id, usa.account_id, usa.account_role, a.name
            FROM user_s3_accounts usa
            JOIN s3_accounts a ON a.id = usa.account_id
            WHERE usa.account_role IN ('portal_user', 'portal_manager')
            """
        )
    ).all()
    for user_id, account_id, account_role, account_name in rows:
        project_id = _ensure_project_for_account(connection, int(account_id), account_name)
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


def _migrate_group_roles(connection) -> None:  # noqa: ANN001
    rows = connection.execute(
        sa.text(
            """
            SELECT gsa.group_id, gsa.account_id, gsa.account_role, a.name
            FROM ui_group_s3_accounts gsa
            JOIN s3_accounts a ON a.id = gsa.account_id
            WHERE gsa.account_role IN ('portal_user', 'portal_manager')
            """
        )
    ).all()
    for group_id, account_id, account_role, account_name in rows:
        project_id = _ensure_project_for_account(connection, int(account_id), account_name)
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


def upgrade() -> None:
    connection = op.get_bind()
    user_role_column_exists = _has_column(connection, "user_s3_accounts", "account_role")
    group_role_column_exists = _has_column(connection, "ui_group_s3_accounts", "account_role")

    if user_role_column_exists:
        _migrate_user_roles(connection)
        with op.batch_alter_table("user_s3_accounts") as batch_op:
            batch_op.drop_column("account_role")

    if group_role_column_exists:
        _migrate_group_roles(connection)
        with op.batch_alter_table("ui_group_s3_accounts") as batch_op:
            batch_op.drop_column("account_role")


def downgrade() -> None:
    connection = op.get_bind()

    if not _has_column(connection, "user_s3_accounts", "account_role"):
        with op.batch_alter_table("user_s3_accounts") as batch_op:
            batch_op.add_column(
                sa.Column("account_role", sa.String(), server_default="portal_none", nullable=False)
            )
    if not _has_column(connection, "ui_group_s3_accounts", "account_role"):
        with op.batch_alter_table("ui_group_s3_accounts") as batch_op:
            batch_op.add_column(
                sa.Column("account_role", sa.String(), server_default="portal_none", nullable=False)
            )

    restored_user_rows = connection.execute(
        sa.text(
            """
            SELECT up.user_id, psa.account_id, up.account_role
            FROM user_projects up
            JOIN project_s3_accounts psa ON psa.project_id = up.project_id
            WHERE up.account_role IN ('portal_user', 'portal_manager')
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
            WHERE gp.account_role IN ('portal_user', 'portal_manager')
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
