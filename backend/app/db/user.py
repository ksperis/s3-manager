# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

from sqlalchemy import Boolean, CheckConstraint, Column, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from .base import Base
from .enums import UserRole


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
        UniqueConstraint("auth_provider", "auth_provider_subject", name="uq_users_provider_subject"),
        CheckConstraint(
            "role IN ('ui_superadmin', 'ui_admin', 'ui_user', 'ui_none')",
            name="ck_users_role",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    display_name = Column(String, nullable=True)
    picture_url = Column(String, nullable=True)
    avatar_preference = Column(String, nullable=False, default="auto", server_default="auto")
    avatar_image = Column(LargeBinary, nullable=True)
    avatar_content_type = Column(String, nullable=True)
    avatar_updated_at = Column(UTCDateTime(), nullable=True)
    hashed_password = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    role = Column(
        String,
        nullable=False,
        default=UserRole.UI_USER.value,
        server_default=UserRole.UI_USER.value,
    )
    is_root = Column(Boolean, default=False, nullable=False, server_default="0")
    can_access_ceph_admin = Column(Boolean, default=False, nullable=False, server_default="0")
    can_access_storage_ops = Column(Boolean, default=False, nullable=False, server_default="0")
    can_access_manager_bucket_compare = Column(Boolean, default=False, nullable=False, server_default="0")
    can_access_manager_bucket_integrity_check = Column(Boolean, default=False, nullable=False, server_default="0")
    can_access_manager_bucket_migration = Column(Boolean, default=False, nullable=False, server_default="0")
    can_access_manager_feature_rules = Column(Boolean, default=False, nullable=False, server_default="0")
    can_access_manager_bucket_purge = Column(Boolean, default=False, nullable=False, server_default="0")
    can_create_manual_private_connections = Column(Boolean, default=False, nullable=False, server_default="0")
    can_provision_managed_private_connections = Column(Boolean, default=False, nullable=False, server_default="0")
    browser_advanced_features_enabled = Column(Boolean, default=False, nullable=False, server_default="0")
    auth_provider = Column(String, nullable=True)
    auth_provider_subject = Column(String, nullable=True)
    created_at = Column(UTCDateTime(), default=utcnow)
    updated_at = Column(UTCDateTime(), default=utcnow, onupdate=utcnow, nullable=False)
    last_login_at = Column(UTCDateTime(), nullable=True)
    ui_language = Column(String, nullable=True)
    quota_alerts_enabled = Column(Boolean, default=True, nullable=False, server_default="1")
    quota_alerts_global_watch = Column(Boolean, default=False, nullable=False, server_default="0")
    ui_preferences_json = Column(Text, nullable=False, default="{}", server_default="{}")

    accounts = relationship(
        "S3Account",
        secondary="user_s3_accounts",
        back_populates="users",
        overlaps="user_links,account_links",
    )
    account_links = relationship(
        "UserS3Account",
        back_populates="user",
        overlaps="accounts,users,user_links",
    )
    s3_users = relationship(
        "S3User",
        secondary="user_s3_users",
        back_populates="users",
        overlaps="s3_user_links",
    )
    s3_user_links = relationship(
        "UserS3User",
        back_populates="user",
        overlaps="s3_users",
    )
    portal_iam_links = relationship(
        "AccountIAMUser",
        back_populates="user",
        overlaps="accounts,account_links",
    )
    # User-scoped S3 connections (credential-first).
    s3_connections = relationship(
        "S3Connection",
        back_populates="created_by",
        cascade="all, delete-orphan",
        overlaps="created_by",
    )

    # Connections explicitly shared with the user (UI access control).
    shared_s3_connections = relationship(
        "S3Connection",
        secondary="user_s3_connections",
        back_populates="users",
        overlaps="s3_connections,created_by,user_links,connection_links",
    )
    s3_connection_links = relationship(
        "UserS3Connection",
        back_populates="user",
        overlaps="shared_s3_connections,s3_connections,users",
    )
    ui_group_links = relationship(
        "UserUiGroup",
        back_populates="user",
        cascade="all, delete-orphan",
    )
