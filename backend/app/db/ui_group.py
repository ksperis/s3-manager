# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from .base import Base
from .enums import AccountRole


class UiGroup(Base):
    __tablename__ = "ui_groups"
    __table_args__ = (UniqueConstraint("name", name="uq_ui_groups_name"),)

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    can_access_ceph_admin = Column(Boolean, default=False, nullable=False, server_default="0")
    can_access_storage_ops = Column(Boolean, default=False, nullable=False, server_default="0")
    can_access_manager_bucket_compare = Column(Boolean, default=False, nullable=False, server_default="0")
    can_access_manager_bucket_integrity_check = Column(Boolean, default=False, nullable=False, server_default="0")
    can_access_manager_bucket_migration = Column(Boolean, default=False, nullable=False, server_default="0")
    can_access_manager_feature_rules = Column(Boolean, default=False, nullable=False, server_default="0")
    can_access_manager_bucket_quota = Column(Boolean, default=False, nullable=False, server_default="0")
    can_access_manager_ceph_s3_user_keys = Column(Boolean, default=False, nullable=False, server_default="0")
    browser_advanced_features_enabled = Column(Boolean, default=False, nullable=False, server_default="0")
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    user_links = relationship("UserUiGroup", back_populates="group", cascade="all, delete-orphan")
    account_links = relationship("UiGroupS3Account", back_populates="group", cascade="all, delete-orphan")
    s3_user_links = relationship("UiGroupS3User", back_populates="group", cascade="all, delete-orphan")
    s3_connection_links = relationship("UiGroupS3Connection", back_populates="group", cascade="all, delete-orphan")


class UserUiGroup(Base):
    __tablename__ = "user_ui_groups"
    __table_args__ = (
        UniqueConstraint("user_id", "group_id", name="uq_user_ui_group"),
        Index("ix_user_ui_groups_group_user", "group_id", "user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    group_id = Column(Integer, ForeignKey("ui_groups.id"), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    user = relationship("User", back_populates="ui_group_links")
    group = relationship("UiGroup", back_populates="user_links")


class UiGroupS3Account(Base):
    __tablename__ = "ui_group_s3_accounts"
    __table_args__ = (
        UniqueConstraint("group_id", "account_id", name="uq_ui_group_s3_account"),
        Index("ix_ui_group_s3_accounts_account_group", "account_id", "group_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("ui_groups.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=False)
    account_admin = Column(Boolean, nullable=False, default=False, server_default="0")
    account_role = Column(
        String,
        nullable=False,
        default=AccountRole.PORTAL_NONE.value,
        server_default=AccountRole.PORTAL_NONE.value,
    )
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    group = relationship("UiGroup", back_populates="account_links")
    account = relationship("S3Account")


class UiGroupS3User(Base):
    __tablename__ = "ui_group_s3_users"
    __table_args__ = (
        UniqueConstraint("group_id", "s3_user_id", name="uq_ui_group_s3_user"),
        Index("ix_ui_group_s3_users_s3_user_group", "s3_user_id", "group_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("ui_groups.id"), nullable=False)
    s3_user_id = Column(Integer, ForeignKey("s3_users.id"), nullable=False)

    group = relationship("UiGroup", back_populates="s3_user_links")
    s3_user = relationship("S3User")


class UiGroupS3Connection(Base):
    __tablename__ = "ui_group_s3_connections"
    __table_args__ = (
        UniqueConstraint("group_id", "s3_connection_id", name="uq_ui_group_s3_connection"),
        Index("ix_ui_group_s3_connections_connection_group", "s3_connection_id", "group_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("ui_groups.id"), nullable=False)
    s3_connection_id = Column(Integer, ForeignKey("s3_connections.id"), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    group = relationship("UiGroup", back_populates="s3_connection_links")
    connection = relationship("S3Connection")
