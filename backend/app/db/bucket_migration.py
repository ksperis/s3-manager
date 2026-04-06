# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.utils.time import utcnow

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .base import Base


class BucketMigration(Base):
    __tablename__ = "bucket_migrations"
    __table_args__ = (
        Index("ix_bucket_migrations_status_created", "status", "created_at"),
        Index("ix_bucket_migrations_source_target", "source_context_id", "target_context_id"),
        Index("ix_bucket_migrations_worker_lease", "worker_lease_until", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    source_context_id = Column(String, nullable=False, index=True)
    target_context_id = Column(String, nullable=False, index=True)

    mode = Column(String, nullable=False, default="one_shot", server_default="one_shot")
    copy_bucket_settings = Column(Boolean, nullable=False, default=False, server_default="0")
    delete_source = Column(Boolean, nullable=False, default=False, server_default="0")
    strong_integrity_check = Column(Boolean, nullable=False, default=False, server_default="0")
    lock_target_writes = Column(Boolean, nullable=False, default=True, server_default="1")
    use_same_endpoint_copy = Column(Boolean, nullable=False, default=False, server_default="0")
    auto_grant_source_read_for_copy = Column(Boolean, nullable=False, default=False, server_default="0")
    webhook_url = Column(String, nullable=True)
    mapping_prefix = Column(String, nullable=True)

    status = Column(String, nullable=False, default="draft", server_default="draft", index=True)
    pause_requested = Column(Boolean, nullable=False, default=False, server_default="0")
    cancel_requested = Column(Boolean, nullable=False, default=False, server_default="0")
    worker_lease_owner = Column(String, nullable=True, index=True)
    worker_lease_until = Column(DateTime, nullable=True, index=True)
    precheck_status = Column(String, nullable=False, default="pending", server_default="pending", index=True)
    precheck_report_json = Column(Text, nullable=True)
    precheck_checked_at = Column(DateTime, nullable=True)

    parallelism_max = Column(Integer, nullable=False, default=16, server_default="16")

    total_items = Column(Integer, nullable=False, default=0, server_default="0")
    completed_items = Column(Integer, nullable=False, default=0, server_default="0")
    failed_items = Column(Integer, nullable=False, default=0, server_default="0")
    skipped_items = Column(Integer, nullable=False, default=0, server_default="0")
    awaiting_items = Column(Integer, nullable=False, default=0, server_default="0")

    error_message = Column(String, nullable=True)

    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    last_heartbeat_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=utcnow, nullable=False, index=True)

    created_by = relationship("User", lazy="joined")
    items = relationship("BucketMigrationItem", back_populates="migration", cascade="all, delete-orphan")
    events = relationship("BucketMigrationEvent", back_populates="migration", cascade="all, delete-orphan")


class BucketMigrationItem(Base):
    __tablename__ = "bucket_migration_items"
    __table_args__ = (
        UniqueConstraint("migration_id", "source_bucket", name="uq_bucket_migration_items_source"),
        Index("ix_bucket_migration_items_migration_status", "migration_id", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    migration_id = Column(Integer, ForeignKey("bucket_migrations.id"), nullable=False, index=True)

    source_bucket = Column(String, nullable=False)
    target_bucket = Column(String, nullable=False)

    status = Column(String, nullable=False, default="pending", server_default="pending", index=True)
    step = Column(String, nullable=False, default="create_bucket", server_default="create_bucket")

    pre_sync_done = Column(Boolean, nullable=False, default=False, server_default="0")
    read_only_applied = Column(Boolean, nullable=False, default=False, server_default="0")
    target_lock_applied = Column(Boolean, nullable=False, default=False, server_default="0")
    target_bucket_exists = Column(Boolean, nullable=False, default=False, server_default="0")

    objects_copied = Column(Integer, nullable=False, default=0, server_default="0")
    objects_deleted = Column(Integer, nullable=False, default=0, server_default="0")

    source_count = Column(Integer, nullable=True)
    target_count = Column(Integer, nullable=True)
    matched_count = Column(Integer, nullable=True)
    different_count = Column(Integer, nullable=True)
    only_source_count = Column(Integer, nullable=True)
    only_target_count = Column(Integer, nullable=True)
    diff_sample_json = Column(Text, nullable=True)

    source_snapshot_json = Column(Text, nullable=True)
    target_snapshot_json = Column(Text, nullable=True)
    execution_plan_json = Column(Text, nullable=True)

    source_policy_backup_json = Column(Text, nullable=True)
    target_policy_backup_json = Column(Text, nullable=True)
    error_message = Column(String, nullable=True)

    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=utcnow, nullable=False, index=True)

    migration = relationship("BucketMigration", back_populates="items")
    events = relationship("BucketMigrationEvent", back_populates="item")


class BucketMigrationEvent(Base):
    __tablename__ = "bucket_migration_events"
    __table_args__ = (
        Index("ix_bucket_migration_events_migration_created", "migration_id", "created_at"),
        Index("ix_bucket_migration_events_item_created", "item_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    migration_id = Column(Integer, ForeignKey("bucket_migrations.id"), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey("bucket_migration_items.id"), nullable=True, index=True)

    level = Column(String, nullable=False, default="info", server_default="info")
    message = Column(Text, nullable=False)
    metadata_json = Column(Text, nullable=True)

    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)

    migration = relationship("BucketMigration", back_populates="events")
    item = relationship("BucketMigrationItem", back_populates="events")
