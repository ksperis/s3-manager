# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow

from sqlalchemy import Boolean, Column, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from .base import Base
from .enums import UserRole


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
        UniqueConstraint("auth_provider", "auth_provider_subject", name="uq_users_provider_subject"),
    )

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    display_name = Column(String, nullable=True)
    picture_url = Column(String, nullable=True)
    hashed_password = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    role = Column(String, nullable=False, default=UserRole.UI_USER.value)
    is_root = Column(Boolean, default=False, nullable=False, server_default="0")
    can_access_ceph_admin = Column(Boolean, default=False, nullable=False, server_default="0")
    auth_provider = Column(String, nullable=True)
    auth_provider_subject = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
    last_login_at = Column(DateTime, nullable=True)
    ui_language = Column(String, nullable=True)
    quota_alerts_enabled = Column(Boolean, default=True, nullable=False, server_default="1")
    quota_alerts_global_watch = Column(Boolean, default=False, nullable=False, server_default="0")

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
        back_populates="owner",
        cascade="all, delete-orphan",
        overlaps="owner",
    )

    # Connections explicitly shared with the user (UI access control).
    shared_s3_connections = relationship(
        "S3Connection",
        secondary="user_s3_connections",
        back_populates="users",
        overlaps="s3_connections,owner,user_links,connection_links",
    )
    s3_connection_links = relationship(
        "UserS3Connection",
        back_populates="user",
        overlaps="shared_s3_connections,s3_connections,users",
    )
