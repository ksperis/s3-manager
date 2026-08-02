# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

from sqlalchemy import Boolean, Column, Index, Integer, String, Text, UniqueConstraint

from .base import Base


class BucketUsageStatsSnapshot(Base):
    __tablename__ = "bucket_usage_stats_snapshots"
    __table_args__ = (
        UniqueConstraint("scope_kind", "scope_id", "bucket_name", name="uq_bucket_usage_stats_scope_bucket"),
        Index("ix_bucket_usage_stats_scope", "scope_kind", "scope_id"),
        Index("ix_bucket_usage_stats_calculated_at", "calculated_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    scope_kind = Column(String, nullable=False)
    scope_id = Column(String, nullable=False)
    scope_name = Column(String, nullable=True)
    bucket_name = Column(String, nullable=False)

    scan_mode = Column(String, nullable=False, default="versions", server_default="versions")
    version_listing_available = Column(Boolean, nullable=False, default=True, server_default="1")

    object_version_count = Column(Integer, nullable=False, default=0, server_default="0")
    current_version_count = Column(Integer, nullable=False, default=0, server_default="0")
    noncurrent_version_count = Column(Integer, nullable=False, default=0, server_default="0")
    delete_marker_count = Column(Integer, nullable=False, default=0, server_default="0")

    total_bytes = Column(Integer, nullable=False, default=0, server_default="0")
    current_bytes = Column(Integer, nullable=False, default=0, server_default="0")
    noncurrent_bytes = Column(Integer, nullable=False, default=0, server_default="0")

    data_type_distribution_json = Column(Text, nullable=False)
    storage_class_distribution_json = Column(Text, nullable=False)
    size_distribution_json = Column(Text, nullable=False)
    age_distribution_json = Column(Text, nullable=False)
    current_noncurrent_distribution_json = Column(Text, nullable=False)
    warnings_json = Column(Text, nullable=True)

    calculated_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=utcnow, onupdate=utcnow, nullable=False)
