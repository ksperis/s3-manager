# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow
from typing import Optional

from sqlalchemy import Boolean, CheckConstraint, Column, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.security import EncryptedString
from .base import Base


class S3Account(Base):
    __tablename__ = "s3_accounts"
    __table_args__ = (
        Index("ix_s3_accounts_storage_endpoint", "storage_endpoint_id"),
        CheckConstraint("TRIM(rgw_account_id) <> ''", name="ck_s3_accounts_rgw_account_id_nonempty"),
        CheckConstraint("TRIM(rgw_user_uid) <> ''", name="ck_s3_accounts_rgw_user_uid_nonempty"),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    rgw_account_id = Column(String, unique=True, nullable=False)
    email = Column(String, nullable=True)
    rgw_access_key = Column(String, nullable=True)
    rgw_secret_key = Column(EncryptedString, nullable=True)
    rgw_user_uid = Column(String, nullable=False)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=utcnow, onupdate=utcnow, nullable=False)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=False)
    portal_settings_override = Column(Text, nullable=True)
    portal_settings_delegated = Column(Boolean, default=False, nullable=False, server_default="0")
    allow_bucket_quota_management = Column(Boolean, default=False, nullable=False, server_default="0")

    storage_endpoint = relationship("StorageEndpoint", lazy="joined")

    users = relationship(
        "User",
        secondary="user_s3_accounts",
        back_populates="accounts",
        overlaps="user_links,account_links",
    )
    user_links = relationship(
        "UserS3Account",
        back_populates="account",
        overlaps="users,accounts,account_links",
    )
    portal_iam_links = relationship(
        "AccountIAMUser",
        back_populates="account",
        overlaps="users,account_links",
    )
    tag_links = relationship("S3AccountTag", back_populates="account", cascade="all, delete-orphan")

    def effective_rgw_credentials(self) -> tuple[Optional[str], Optional[str]]:
        return self.rgw_access_key, self.rgw_secret_key

    def session_token(self) -> Optional[str]:
        return None


class UserS3Account(Base):
    __tablename__ = "user_s3_accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "account_id", name="uq_user_s3_account"),
        Index("ix_user_s3_accounts_account_user", "account_id", "user_id"),
        CheckConstraint(
            "manager_role IS NULL OR manager_role = 'account_administrator'",
            name="ck_user_s3_accounts_manager_role",
        ),
        CheckConstraint(
            "portal_role IS NULL OR portal_role IN ('portal_user', 'portal_manager')",
            name="ck_user_s3_accounts_portal_role",
        ),
        CheckConstraint(
            "manager_role IS NOT NULL OR portal_role IS NOT NULL",
            name="ck_user_s3_accounts_has_role",
        ),
        CheckConstraint(
            "allow_manager_browser_data_access IS FALSE "
            "OR manager_role = 'account_administrator'",
            name="ck_user_s3_accounts_manager_browser_role",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=False)
    manager_role = Column(String, nullable=True)
    portal_role = Column(String, nullable=True)
    allow_manager_browser_data_access = Column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=utcnow, nullable=False)

    user = relationship(
        "User",
        back_populates="account_links",
        overlaps="accounts,users,user_links",
    )
    account = relationship(
        "S3Account",
        back_populates="user_links",
        overlaps="users,accounts,account_links",
    )


class AccountIAMUser(Base):
    __tablename__ = "account_iam_users"
    __table_args__ = (
        UniqueConstraint("user_id", "account_id", name="uq_account_iam_user"),
        UniqueConstraint("iam_user_id", name="uq_account_iam_user_id"),
        Index("ix_account_iam_users_account_user", "account_id", "user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=False)
    iam_user_id = Column(String, nullable=False)
    iam_username = Column(String, nullable=True)
    active_access_key = Column(String, nullable=True)
    active_secret_key = Column(EncryptedString, nullable=True)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)

    user = relationship(
        "User",
        back_populates="portal_iam_links",
        overlaps="accounts,account_links",
    )
    account = relationship(
        "S3Account",
        back_populates="portal_iam_links",
        overlaps="users,account_links",
    )
