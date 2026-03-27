# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.utils.time import utcnow
from app.utils.tagging import DEFAULT_TAG_SCOPE

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import relationship

from .base import Base


class TagDefinition(Base):
    __tablename__ = "tag_definitions"
    __table_args__ = (
        Index("ix_tag_definitions_domain_owner", "domain_kind", "owner_user_id"),
        Index(
            "uq_tag_definitions_domain_global_label",
            "domain_kind",
            "label_key",
            unique=True,
            sqlite_where=text("owner_user_id IS NULL"),
            postgresql_where=text("owner_user_id IS NULL"),
        ),
        Index(
            "uq_tag_definitions_domain_owner_label",
            "domain_kind",
            "owner_user_id",
            "label_key",
            unique=True,
            sqlite_where=text("owner_user_id IS NOT NULL"),
            postgresql_where=text("owner_user_id IS NOT NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    domain_kind = Column(String, nullable=False)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    label = Column(String, nullable=False)
    label_key = Column(String, nullable=False)
    color_key = Column(String, nullable=False)
    scope = Column(String, nullable=False, default=DEFAULT_TAG_SCOPE, server_default=DEFAULT_TAG_SCOPE)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    owner = relationship("User")


class StorageEndpointTag(Base):
    __tablename__ = "storage_endpoint_tags"
    __table_args__ = (
        UniqueConstraint("storage_endpoint_id", "tag_definition_id", name="uq_storage_endpoint_tag"),
        Index("ix_storage_endpoint_tags_endpoint_position", "storage_endpoint_id", "position"),
    )

    id = Column(Integer, primary_key=True, index=True)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id", ondelete="CASCADE"), nullable=False)
    tag_definition_id = Column(Integer, ForeignKey("tag_definitions.id", ondelete="CASCADE"), nullable=False)
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    endpoint = relationship("StorageEndpoint", back_populates="tag_links")
    tag_definition = relationship("TagDefinition")


class S3AccountTag(Base):
    __tablename__ = "s3_account_tags"
    __table_args__ = (
        UniqueConstraint("account_id", "tag_definition_id", name="uq_s3_account_tag"),
        Index("ix_s3_account_tags_account_position", "account_id", "position"),
    )

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("s3_accounts.id", ondelete="CASCADE"), nullable=False)
    tag_definition_id = Column(Integer, ForeignKey("tag_definitions.id", ondelete="CASCADE"), nullable=False)
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    account = relationship("S3Account", back_populates="tag_links")
    tag_definition = relationship("TagDefinition")


class S3UserTag(Base):
    __tablename__ = "s3_user_tags"
    __table_args__ = (
        UniqueConstraint("s3_user_id", "tag_definition_id", name="uq_s3_user_tag"),
        Index("ix_s3_user_tags_user_position", "s3_user_id", "position"),
    )

    id = Column(Integer, primary_key=True, index=True)
    s3_user_id = Column(Integer, ForeignKey("s3_users.id", ondelete="CASCADE"), nullable=False)
    tag_definition_id = Column(Integer, ForeignKey("tag_definitions.id", ondelete="CASCADE"), nullable=False)
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    s3_user = relationship("S3User", back_populates="tag_links")
    tag_definition = relationship("TagDefinition")


class S3ConnectionTag(Base):
    __tablename__ = "s3_connection_tags"
    __table_args__ = (
        UniqueConstraint("s3_connection_id", "tag_definition_id", name="uq_s3_connection_tag"),
        Index("ix_s3_connection_tags_connection_position", "s3_connection_id", "position"),
    )

    id = Column(Integer, primary_key=True, index=True)
    s3_connection_id = Column(Integer, ForeignKey("s3_connections.id", ondelete="CASCADE"), nullable=False)
    tag_definition_id = Column(Integer, ForeignKey("tag_definitions.id", ondelete="CASCADE"), nullable=False)
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    connection = relationship("S3Connection", back_populates="tag_links")
    tag_definition = relationship("TagDefinition")
