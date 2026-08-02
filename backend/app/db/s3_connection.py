# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""SQLAlchemy models for user-scoped S3 connections (credential-first)."""

from __future__ import annotations

from app.db.utc_datetime import UTCDateTime
from app.utils.s3_connection_capabilities import DEFAULT_S3_CONNECTION_CAPABILITIES_JSON
from app.utils.time import utcnow

from sqlalchemy import Boolean, CheckConstraint, Column, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import relationship

from app.core.security import EncryptedString
from .base import Base


class S3Connection(Base):
    __tablename__ = "s3_connections"
    __table_args__ = (
        CheckConstraint(
            "credential_owner_type IS NULL OR credential_owner_type IN ('iam_user', 'account_user', 's3_user')",
            name="ck_s3_connections_credential_owner_type",
        ),
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
    remediation_required = Column(Boolean, nullable=False, default=False, server_default="0")
    remediation_reason = Column(String, nullable=True)
    server_managed = Column(Boolean, nullable=False, default=False, server_default="0")
    credential_owner_type = Column(String, nullable=True)
    credential_owner_identifier = Column(String, nullable=True)

    # S3 target
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=True, index=True)
    custom_endpoint_config = Column(Text, nullable=True)

    # Credentials (session_token/expires_at reserved for future STS support)
    access_key_id = Column(String, nullable=False)
    secret_access_key = Column(EncryptedString, nullable=False)
    session_token = Column(EncryptedString, nullable=True)
    expires_at = Column(UTCDateTime(), nullable=True)
    is_temporary = Column(Boolean, nullable=False, default=False, server_default="0")
    temp_user_uid = Column(String, nullable=True)
    temp_access_key_id = Column(String, nullable=True)

    # Cached capability profile (JSON) computed from probes.
    capabilities_json = Column(
        Text,
        nullable=False,
        default=DEFAULT_S3_CONNECTION_CAPABILITIES_JSON,
        server_default=DEFAULT_S3_CONNECTION_CAPABILITIES_JSON,
    )
    tags_json = Column(Text, nullable=False, default="[]", server_default="[]")

    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    last_used_at = Column(UTCDateTime(), nullable=True)

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
    managed_private_access = relationship(
        "ManagedPrivateAccess",
        back_populates="connection",
        uselist=False,
        passive_deletes=True,
    )


class UserS3Connection(Base):
    __tablename__ = "user_s3_connections"
    __table_args__ = (
        UniqueConstraint("user_id", "s3_connection_id", name="uq_user_s3_connection"),
        Index("ix_user_s3_connections_connection_user", "s3_connection_id", "user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    s3_connection_id = Column(Integer, ForeignKey("s3_connections.id"), nullable=False)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=utcnow, nullable=False)

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


class ManagedPrivateAccess(Base):
    """Durable saga state for server-provisioned private credentials."""

    __tablename__ = "managed_private_accesses"
    __table_args__ = (
        CheckConstraint(
            "source_context_type IN ('account', 'connection', 's3_user')",
            name="ck_managed_private_access_source_type",
        ),
        CheckConstraint(
            "remote_principal_type IN ('iam_user', 'rgw_user')",
            name="ck_managed_private_access_principal_type",
        ),
        CheckConstraint(
            "state IN ('provisioning', 'active', 'deleting', 'cleanup_pending', 'failed')",
            name="ck_managed_private_access_state",
        ),
        Index(
            "uq_managed_private_access_active_source",
            "owner_user_id",
            "source_context_type",
            "source_context_id",
            unique=True,
            sqlite_where=text("state IN ('provisioning', 'active', 'deleting', 'cleanup_pending')"),
            postgresql_where=text("state IN ('provisioning', 'active', 'deleting', 'cleanup_pending')"),
        ),
        UniqueConstraint("s3_connection_id", name="uq_managed_private_access_connection"),
    )

    id = Column(Integer, primary_key=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    source_context_type = Column(String, nullable=False)
    source_context_id = Column(Integer, nullable=False)
    remote_principal_type = Column(String, nullable=False)
    remote_principal_identifier = Column(String, nullable=False)
    iam_username = Column(String, nullable=True)
    access_key_id = Column(String, nullable=True)
    s3_connection_id = Column(
        Integer,
        ForeignKey("s3_connections.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    state = Column(String, nullable=False, default="provisioning", server_default="provisioning")
    cleanup_error = Column(Text, nullable=True)
    iam_groups_json = Column(Text, nullable=False, default="[]", server_default="[]")
    iam_managed_policies_json = Column(Text, nullable=False, default="[]", server_default="[]")
    iam_inline_policy_names_json = Column(Text, nullable=False, default="[]", server_default="[]")
    created_remote_principal = Column(Boolean, nullable=False, default=False, server_default="0")
    created_access_key = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=utcnow, onupdate=utcnow, nullable=False)

    owner = relationship("User")
    connection = relationship("S3Connection", back_populates="managed_private_access")
