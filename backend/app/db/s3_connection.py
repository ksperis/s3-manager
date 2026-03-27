# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""SQLAlchemy models for user-scoped S3 connections (credential-first)."""

from __future__ import annotations

from app.utils.time import utcnow

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import relationship

from app.core.security import EncryptedString
from .base import Base


class S3Connection(Base):
    __tablename__ = "s3_connections"
    __table_args__ = (
        Index(
            "uq_s3_connections_private_creator_name",
            "created_by_user_id",
            "name",
            unique=True,
            sqlite_where=text("is_shared = 0"),
            postgresql_where=text("is_shared = false"),
        ),
        Index(
            "uq_s3_connections_shared_name",
            "name",
            unique=True,
            sqlite_where=text("is_shared = 1"),
            postgresql_where=text("is_shared = true"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)

    # Immutable creator identity used for traceability.
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Friendly name (e.g. "AWS-prod-admin")
    name = Column(String, nullable=False)

    # Visibility
    is_shared = Column(Boolean, nullable=False, default=False, server_default="0")
    is_active = Column(Boolean, nullable=False, default=True, server_default="1")
    access_manager = Column(Boolean, nullable=False, default=False, server_default="0")
    access_browser = Column(Boolean, nullable=False, default=True, server_default="1")
    credential_owner_type = Column(String, nullable=True)
    credential_owner_identifier = Column(String, nullable=True)

    # S3 target
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=True, index=True)
    custom_endpoint_config = Column(Text, nullable=True)

    # Credentials (session_token/expires_at reserved for future STS support)
    access_key_id = Column(String, nullable=False)
    secret_access_key = Column(EncryptedString, nullable=False)
    session_token = Column(EncryptedString, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    is_temporary = Column(Boolean, nullable=False, default=False, server_default="0")
    temp_user_uid = Column(String, nullable=True)
    temp_access_key_id = Column(String, nullable=True)

    # Cached capability profile (JSON) computed from probes (optional)
    capabilities_json = Column(Text, nullable=False, default="{}", server_default="{}")
    tags_json = Column(Text, nullable=False, default="[]", server_default="[]")

    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, nullable=False)
    last_used_at = Column(DateTime, nullable=True)

    created_by = relationship("User", back_populates="s3_connections", overlaps="s3_connections")
    storage_endpoint = relationship("StorageEndpoint")

    users = relationship(
        "User",
        secondary="user_s3_connections",
        back_populates="shared_s3_connections",
        overlaps="user_links,connection_links,created_by,s3_connection_links",
    )
    user_links = relationship(
        "UserS3Connection",
        back_populates="connection",
        overlaps="users,shared_s3_connections,connection_links,created_by",
        cascade="all, delete-orphan",
    )
    tag_links = relationship("S3ConnectionTag", back_populates="connection", cascade="all, delete-orphan")


class UserS3Connection(Base):
    __tablename__ = "user_s3_connections"
    __table_args__ = (
        UniqueConstraint("user_id", "s3_connection_id", name="uq_user_s3_connection"),
        Index("ix_user_s3_connections_connection_user", "s3_connection_id", "user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    s3_connection_id = Column(Integer, ForeignKey("s3_connections.id"), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, nullable=False)

    user = relationship(
        "User",
        back_populates="s3_connection_links",
        overlaps="shared_s3_connections,s3_connections,users",
    )
    connection = relationship(
        "S3Connection",
        back_populates="user_links",
        overlaps="users,shared_s3_connections,created_by",
    )
