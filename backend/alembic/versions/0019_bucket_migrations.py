# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add persistent bucket migration tables."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0019_bucket_migrations"
down_revision = "0018_refresh_sessions_schema_repair"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bucket_migrations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("source_context_id", sa.String(), nullable=False),
        sa.Column("target_context_id", sa.String(), nullable=False),
        sa.Column("mode", sa.String(), nullable=False, server_default="one_shot"),
        sa.Column("copy_bucket_settings", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("delete_source", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("mapping_prefix", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("pause_requested", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("parallelism_max", sa.Integer(), nullable=False, server_default="16"),
        sa.Column("total_items", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completed_items", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_items", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped_items", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("awaiting_items", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.String(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("last_heartbeat_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("bucket_migrations", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_bucket_migrations_id"), ["id"], unique=False)
        batch_op.create_index(batch_op.f("ix_bucket_migrations_created_by_user_id"), ["created_by_user_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_bucket_migrations_source_context_id"), ["source_context_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_bucket_migrations_target_context_id"), ["target_context_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_bucket_migrations_status"), ["status"], unique=False)
        batch_op.create_index(batch_op.f("ix_bucket_migrations_created_at"), ["created_at"], unique=False)
        batch_op.create_index(batch_op.f("ix_bucket_migrations_updated_at"), ["updated_at"], unique=False)
        batch_op.create_index("ix_bucket_migrations_status_created", ["status", "created_at"], unique=False)
        batch_op.create_index(
            "ix_bucket_migrations_source_target",
            ["source_context_id", "target_context_id"],
            unique=False,
        )

    op.create_table(
        "bucket_migration_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("migration_id", sa.Integer(), nullable=False),
        sa.Column("source_bucket", sa.String(), nullable=False),
        sa.Column("target_bucket", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("step", sa.String(), nullable=False, server_default="create_bucket"),
        sa.Column("pre_sync_done", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("read_only_applied", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("target_bucket_exists", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("objects_copied", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("objects_deleted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source_count", sa.Integer(), nullable=True),
        sa.Column("target_count", sa.Integer(), nullable=True),
        sa.Column("matched_count", sa.Integer(), nullable=True),
        sa.Column("different_count", sa.Integer(), nullable=True),
        sa.Column("only_source_count", sa.Integer(), nullable=True),
        sa.Column("only_target_count", sa.Integer(), nullable=True),
        sa.Column("diff_sample_json", sa.Text(), nullable=True),
        sa.Column("source_policy_backup_json", sa.Text(), nullable=True),
        sa.Column("error_message", sa.String(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["migration_id"], ["bucket_migrations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("migration_id", "source_bucket", name="uq_bucket_migration_items_source"),
    )
    with op.batch_alter_table("bucket_migration_items", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_bucket_migration_items_id"), ["id"], unique=False)
        batch_op.create_index(batch_op.f("ix_bucket_migration_items_migration_id"), ["migration_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_bucket_migration_items_status"), ["status"], unique=False)
        batch_op.create_index(batch_op.f("ix_bucket_migration_items_created_at"), ["created_at"], unique=False)
        batch_op.create_index(batch_op.f("ix_bucket_migration_items_updated_at"), ["updated_at"], unique=False)
        batch_op.create_index(
            "ix_bucket_migration_items_migration_status",
            ["migration_id", "status"],
            unique=False,
        )

    op.create_table(
        "bucket_migration_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("migration_id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=True),
        sa.Column("level", sa.String(), nullable=False, server_default="info"),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["item_id"], ["bucket_migration_items.id"]),
        sa.ForeignKeyConstraint(["migration_id"], ["bucket_migrations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("bucket_migration_events", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_bucket_migration_events_id"), ["id"], unique=False)
        batch_op.create_index(batch_op.f("ix_bucket_migration_events_migration_id"), ["migration_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_bucket_migration_events_item_id"), ["item_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_bucket_migration_events_created_at"), ["created_at"], unique=False)
        batch_op.create_index(
            "ix_bucket_migration_events_migration_created",
            ["migration_id", "created_at"],
            unique=False,
        )
        batch_op.create_index(
            "ix_bucket_migration_events_item_created",
            ["item_id", "created_at"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("bucket_migration_events", schema=None) as batch_op:
        batch_op.drop_index("ix_bucket_migration_events_item_created")
        batch_op.drop_index("ix_bucket_migration_events_migration_created")
        batch_op.drop_index(batch_op.f("ix_bucket_migration_events_created_at"))
        batch_op.drop_index(batch_op.f("ix_bucket_migration_events_item_id"))
        batch_op.drop_index(batch_op.f("ix_bucket_migration_events_migration_id"))
        batch_op.drop_index(batch_op.f("ix_bucket_migration_events_id"))
    op.drop_table("bucket_migration_events")

    with op.batch_alter_table("bucket_migration_items", schema=None) as batch_op:
        batch_op.drop_index("ix_bucket_migration_items_migration_status")
        batch_op.drop_index(batch_op.f("ix_bucket_migration_items_updated_at"))
        batch_op.drop_index(batch_op.f("ix_bucket_migration_items_created_at"))
        batch_op.drop_index(batch_op.f("ix_bucket_migration_items_status"))
        batch_op.drop_index(batch_op.f("ix_bucket_migration_items_migration_id"))
        batch_op.drop_index(batch_op.f("ix_bucket_migration_items_id"))
    op.drop_table("bucket_migration_items")

    with op.batch_alter_table("bucket_migrations", schema=None) as batch_op:
        batch_op.drop_index("ix_bucket_migrations_source_target")
        batch_op.drop_index("ix_bucket_migrations_status_created")
        batch_op.drop_index(batch_op.f("ix_bucket_migrations_updated_at"))
        batch_op.drop_index(batch_op.f("ix_bucket_migrations_created_at"))
        batch_op.drop_index(batch_op.f("ix_bucket_migrations_status"))
        batch_op.drop_index(batch_op.f("ix_bucket_migrations_target_context_id"))
        batch_op.drop_index(batch_op.f("ix_bucket_migrations_source_context_id"))
        batch_op.drop_index(batch_op.f("ix_bucket_migrations_created_by_user_id"))
        batch_op.drop_index(batch_op.f("ix_bucket_migrations_id"))
    op.drop_table("bucket_migrations")
