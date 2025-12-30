# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import declarative_base, relationship
from app.core.security import EncryptedString

Base = declarative_base()


class UserRole(str, Enum):
    UI_ADMIN = "ui_admin"
    UI_USER = "ui_user"
    UI_NONE = "ui_none"


class AccountRole(str, Enum):
    PORTAL_MANAGER = "portal_manager"
    PORTAL_USER = "portal_user"
    PORTAL_NONE = "portal_none"


class StorageProvider(str, Enum):
    CEPH = "ceph"
    OTHER = "other"


class StorageEndpoint(Base):
    __tablename__ = "storage_endpoints"
    __table_args__ = (
        UniqueConstraint("name", name="uq_storage_endpoints_name"),
        UniqueConstraint("endpoint_url", name="uq_storage_endpoints_endpoint"),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    endpoint_url = Column(String, nullable=False)
    admin_endpoint = Column(String, nullable=True)
    region = Column(String, nullable=True)
    provider = Column(String, nullable=False, default=StorageProvider.CEPH.value)
    admin_access_key = Column(String, nullable=True)
    admin_secret_key = Column(EncryptedString, nullable=True)
    supervision_access_key = Column(String, nullable=True)
    supervision_secret_key = Column(EncryptedString, nullable=True)
    capabilities = Column(JSON, nullable=True)
    is_default = Column(Boolean, default=False, nullable=False, server_default="0")
    is_editable = Column(Boolean, default=True, nullable=False, server_default="1")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class S3Account(Base):
    __tablename__ = "s3_accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    rgw_account_id = Column(String, unique=True, nullable=True)
    email = Column(String, nullable=True)
    rgw_access_key = Column(String, nullable=True)
    rgw_secret_key = Column(EncryptedString, nullable=True)
    rgw_user_uid = Column(String, nullable=True)
    quota_max_size_gb = Column(Integer, nullable=True)
    quota_max_objects = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=True)

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

    def set_session_credentials(self, access_key: Optional[str], secret_key: Optional[str]) -> None:
        self._session_access_key = access_key
        self._session_secret_key = secret_key

    def clear_session_credentials(self) -> None:
        if hasattr(self, "_session_access_key"):
            delattr(self, "_session_access_key")
        if hasattr(self, "_session_secret_key"):
            delattr(self, "_session_secret_key")

    def effective_rgw_credentials(self) -> tuple[Optional[str], Optional[str]]:
        override_access = getattr(self, "_session_access_key", None)
        override_secret = getattr(self, "_session_secret_key", None)
        if override_access and override_secret:
            return override_access, override_secret
        return self.rgw_access_key, self.rgw_secret_key


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
    rgw_access_key = Column(String, nullable=True)
    rgw_secret_key = Column(EncryptedString, nullable=True)
    auth_provider = Column(String, nullable=True)
    auth_provider_subject = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)

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


class UserS3Account(Base):
    __tablename__ = "user_s3_accounts"
    __table_args__ = (UniqueConstraint("user_id", "account_id", name="uq_user_s3_account"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=False)
    is_root = Column(Boolean, nullable=False, default=False, server_default="0")
    account_role = Column(String, nullable=False, default=AccountRole.PORTAL_USER.value)
    account_admin = Column(Boolean, nullable=False, default=False, server_default="0")
    can_manage_iam = Column(Boolean, nullable=False, default=False, server_default="0")
    can_manage_buckets = Column(Boolean, nullable=False, default=True, server_default="1")
    can_manage_portal_users = Column(Boolean, nullable=False, default=False, server_default="0")
    can_view_root_key = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)

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
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=False)
    iam_user_id = Column(String, nullable=False)
    iam_username = Column(String, nullable=True)
    iam_role_arn = Column(String, nullable=True)
    active_access_key = Column(String, nullable=True)
    active_secret_key = Column(EncryptedString, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

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


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_email = Column(String, nullable=False)
    user_role = Column(String, nullable=False)
    scope = Column(String, nullable=False)  # e.g. admin / manager
    action = Column(String, nullable=False)
    entity_type = Column(String, nullable=True)
    entity_id = Column(String, nullable=True)
    account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=True)
    account_name = Column(String, nullable=True)
    status = Column(String, nullable=False, default="success")
    message = Column(String, nullable=True)
    metadata_json = Column(Text, nullable=True)

    user = relationship("User", lazy="joined")
    account = relationship("S3Account", lazy="joined")


class RgwSession(Base):
    __tablename__ = "rgw_sessions"

    id = Column(String, primary_key=True, index=True)
    access_key_enc = Column(String, nullable=False)
    secret_key_enc = Column(String, nullable=False)
    access_key_hash = Column(String, nullable=False, index=True)
    actor_type = Column(String, nullable=False)
    role = Column(String, nullable=False, default=UserRole.UI_USER.value)
    account_id = Column(String, nullable=True)
    account_name = Column(String, nullable=True)
    user_uid = Column(String, nullable=True)
    capabilities = Column(Text, nullable=True)
    can_manage_iam = Column(Boolean, default=False, nullable=False)
    can_manage_buckets = Column(Boolean, default=True, nullable=False)
    can_view_traffic = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_used_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class S3User(Base):
    __tablename__ = "s3_users"
    __table_args__ = (UniqueConstraint("rgw_user_uid", name="uq_s3_users_uid"),)

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    rgw_user_uid = Column(String, nullable=False)
    email = Column(String, nullable=True)
    rgw_access_key = Column(String, nullable=False)
    rgw_secret_key = Column(EncryptedString, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=True)

    users = relationship(
        "User",
        secondary="user_s3_users",
        back_populates="s3_users",
        overlaps="s3_user_links,user_links",
    )
    user_links = relationship(
        "UserS3User",
        back_populates="s3_user",
        overlaps="users,s3_users",
    )
    storage_endpoint = relationship("StorageEndpoint", lazy="joined")


class UserS3User(Base):
    __tablename__ = "user_s3_users"
    __table_args__ = (UniqueConstraint("user_id", "s3_user_id", name="uq_user_s3_user"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    s3_user_id = Column(Integer, ForeignKey("s3_users.id"), nullable=False)

    user = relationship(
        "User",
        back_populates="s3_user_links",
        overlaps="s3_users,users",
    )
    s3_user = relationship(
        "S3User",
        back_populates="user_links",
        overlaps="users,s3_users",
    )


class OidcLoginState(Base):
    __tablename__ = "oidc_login_states"

    state = Column(String, primary_key=True, index=True)
    provider = Column(String, nullable=False)
    code_verifier = Column(String, nullable=False)
    nonce = Column(String, nullable=True)
    redirect_path = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
