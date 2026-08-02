# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

from sqlalchemy import Column, String, Text

from .base import Base


class BackendOperationLease(Base):
    __tablename__ = "backend_operation_leases"

    operation_name = Column(String, primary_key=True)
    lease_owner = Column(String, nullable=False)
    lease_until = Column(UTCDateTime(), nullable=False, index=True)
    acquired_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    metadata_json = Column(Text, nullable=True)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key = Column(String, primary_key=True)
    payload_json = Column(Text, nullable=False)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow)
