# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from .base import Base


class EndpointHealthCheck(Base):
    __tablename__ = "endpoint_health_checks"

    id = Column(Integer, primary_key=True, index=True)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=False, index=True)
    checked_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    http_status = Column(Integer, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    status = Column(String, nullable=False)
    error_message = Column(String, nullable=True)

    storage_endpoint = relationship("StorageEndpoint")


class EndpointHealthDaily(Base):
    __tablename__ = "endpoint_health_daily"
    __table_args__ = (
        UniqueConstraint("day", "storage_endpoint_id", name="uq_endpoint_health_daily"),
    )

    id = Column(Integer, primary_key=True, index=True)
    day = Column(Date, nullable=False, index=True)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=False, index=True)
    check_count = Column(Integer, nullable=False, default=0, server_default="0")
    ok_count = Column(Integer, nullable=False, default=0, server_default="0")
    degraded_count = Column(Integer, nullable=False, default=0, server_default="0")
    down_count = Column(Integer, nullable=False, default=0, server_default="0")
    avg_latency_ms = Column(Integer, nullable=True)
    p95_latency_ms = Column(Integer, nullable=True)
    last_status = Column(String, nullable=True)
    last_checked_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    storage_endpoint = relationship("StorageEndpoint")
