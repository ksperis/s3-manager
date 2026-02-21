# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.utils.time import utcnow

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from .base import Base


class EndpointHealthCheck(Base):
    __tablename__ = "endpoint_health_checks"

    id = Column(Integer, primary_key=True, index=True)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=False, index=True)
    checked_at = Column(DateTime, nullable=False, default=utcnow, index=True)
    http_status = Column(Integer, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    check_mode = Column(String, nullable=False, default="http", server_default="http")
    status = Column(String, nullable=False)
    error_message = Column(String, nullable=True)

    storage_endpoint = relationship("StorageEndpoint")


class EndpointHealthLatest(Base):
    __tablename__ = "endpoint_health_latest"
    __table_args__ = (
        UniqueConstraint(
            "storage_endpoint_id",
            "check_mode",
            "check_type",
            "scope",
            name="uq_endpoint_health_latest_scope",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=False, index=True)
    check_mode = Column(String, nullable=False, default="http", server_default="http")
    check_type = Column(String, nullable=False, default="availability", server_default="availability")
    scope = Column(String, nullable=False, default="endpoint", server_default="endpoint")
    checked_at = Column(DateTime, nullable=False, index=True)
    status = Column(String, nullable=False)
    latency_ms = Column(Integer, nullable=True)
    http_status = Column(Integer, nullable=True)
    error_message = Column(String, nullable=True)
    min_latency_ms = Column(Integer, nullable=True)
    avg_latency_ms = Column(Integer, nullable=True)
    max_latency_ms = Column(Integer, nullable=True)
    latency_sample_count = Column(Integer, nullable=False, default=0, server_default="0")
    availability_24h = Column(Integer, nullable=True)
    updated_at = Column(DateTime, nullable=False, default=utcnow, index=True)

    storage_endpoint = relationship("StorageEndpoint")


class EndpointHealthStatusSegment(Base):
    __tablename__ = "endpoint_health_status_segments"

    id = Column(Integer, primary_key=True, index=True)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=False, index=True)
    check_mode = Column(String, nullable=False, default="http", server_default="http")
    check_type = Column(String, nullable=False, default="availability", server_default="availability")
    scope = Column(String, nullable=False, default="endpoint", server_default="endpoint")
    status = Column(String, nullable=False, index=True)
    started_at = Column(DateTime, nullable=False, index=True)
    ended_at = Column(DateTime, nullable=True, index=True)
    checks_count = Column(Integer, nullable=False, default=0, server_default="0")
    min_latency_ms = Column(Integer, nullable=True)
    avg_latency_ms = Column(Integer, nullable=True)
    max_latency_ms = Column(Integer, nullable=True)
    latency_sample_count = Column(Integer, nullable=False, default=0, server_default="0")
    updated_at = Column(DateTime, nullable=False, default=utcnow, index=True)

    storage_endpoint = relationship("StorageEndpoint")


class EndpointHealthRollup(Base):
    __tablename__ = "endpoint_health_rollups"
    __table_args__ = (
        UniqueConstraint(
            "storage_endpoint_id",
            "check_mode",
            "check_type",
            "scope",
            "resolution_seconds",
            "bucket_start",
            name="uq_endpoint_health_rollup_bucket",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=False, index=True)
    check_mode = Column(String, nullable=False, default="http", server_default="http")
    check_type = Column(String, nullable=False, default="availability", server_default="availability")
    scope = Column(String, nullable=False, default="endpoint", server_default="endpoint")
    resolution_seconds = Column(Integer, nullable=False, default=300, server_default="300")
    bucket_start = Column(DateTime, nullable=False, index=True)
    up_count = Column(Integer, nullable=False, default=0, server_default="0")
    degraded_count = Column(Integer, nullable=False, default=0, server_default="0")
    down_count = Column(Integer, nullable=False, default=0, server_default="0")
    unknown_count = Column(Integer, nullable=False, default=0, server_default="0")
    latency_min_ms = Column(Integer, nullable=True)
    latency_avg_ms = Column(Integer, nullable=True)
    latency_max_ms = Column(Integer, nullable=True)
    latency_p95_ms = Column(Integer, nullable=True)
    latency_sample_count = Column(Integer, nullable=False, default=0, server_default="0")
    updated_at = Column(DateTime, nullable=False, default=utcnow, index=True)

    storage_endpoint = relationship("StorageEndpoint")
