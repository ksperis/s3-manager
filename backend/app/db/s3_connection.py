# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""SQLAlchemy models for user-scoped S3 connections (credential-first)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.security import EncryptedString
from .base import Base


class S3Connection(Base):
    __tablename__ = "s3_connections"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "name", name="uq_s3_connections_owner_name"),
    )

    id = Column(Integer, primary_key=True, index=True)

    # Owner (private-by-default)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Friendly name (e.g. "AWS-prod-admin")
    name = Column(String, nullable=False)

    # Optional hint for UX / compatibility (aws, ceph, scality, minio, other)
    provider_hint = Column(String, nullable=True)

    # S3 target
    endpoint_url = Column(String, nullable=False)
    region = Column(String, nullable=True)

    # Credentials (session_token/expires_at reserved for future STS support)
    access_key_id = Column(String, nullable=False)
    secret_access_key = Column(EncryptedString, nullable=False)
    session_token = Column(EncryptedString, nullable=True)
    expires_at = Column(DateTime, nullable=True)

    # Optional connection options
    force_path_style = Column(Boolean, nullable=False, default=False, server_default="0")
    verify_tls = Column(Boolean, nullable=False, default=True, server_default="1")

    # Cached capability profile (JSON) computed from probes (optional)
    capabilities_json = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_used_at = Column(DateTime, nullable=True)

    owner = relationship("User", back_populates="s3_connections", overlaps="s3_connections")


# If you later need sharing, introduce a link table (user_s3_connections)
# but for now we keep connections owner-scoped.
