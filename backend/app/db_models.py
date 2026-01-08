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


class S3AccountKind(str, Enum):
    IAM_ACCOUNT = "iam_account"
    LEGACY_USER = "legacy_user"


class PortalRoleKey(str, Enum):
    VIEWER = "Viewer"
    ACCESS_ADMIN = "AccessAdmin"
    ACCOUNT_ADMIN = "AccountAdmin"


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
    features_config = Column(Text, nullable=True)
    presign_enabled = Column(Boolean, default=True, nullable=False, server_default="1")
    allow_external_access = Column(Boolean, default=False, nullable=False, server_default="0")
    max_session_duration = Column(Integer, nullable=False, default=3600, server_default="3600")
    allowed_packages = Column(JSON, nullable=True)
    is_default = Column(Boolean, default=False, nullable=False, server_default="0")
    is_editable = Column(Boolean, default=True, nullable=False, server_default="1")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class S3Account(Base):
    __tablename__ = "s3_accounts"

    id = Column(Integer, primary_key=True, index=True)
    kind = Column(
        String,
        nullable=False,
        default=S3AccountKind.IAM_ACCOUNT.value,
        server_default=S3AccountKind.IAM_ACCOUNT.value,
    )
    name = Column(String, unique=True, nullable=False)
    rgw_account_id = Column(String, unique=True, nullable=True)
    email = Column(String, nullable=True)
    rgw_access_key = Column(String, nullable=True)
    rgw_secret_key = Column(EncryptedString, nullable=True)
    bucket_provisioner_iam_username = Column(String, nullable=True)
    bucket_provisioner_access_key = Column(String, nullable=True)
    bucket_provisioner_secret_key = Column(EncryptedString, nullable=True)
    rgw_user_uid = Column(String, nullable=True)
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
    portal_memberships = relationship("PortalMembership", back_populates="account", overlaps="users")
    manager_root_links = relationship("ManagerRootAccess", back_populates="account", overlaps="users")
    iam_identities = relationship("IamIdentity", back_populates="account", overlaps="users")

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
    portal_memberships = relationship("PortalMembership", back_populates="user", overlaps="accounts")
    manager_root_links = relationship("ManagerRootAccess", back_populates="user", overlaps="accounts")
    iam_identities = relationship("IamIdentity", back_populates="user", overlaps="accounts")


class UserS3Account(Base):
    __tablename__ = "user_s3_accounts"
    __table_args__ = (UniqueConstraint("user_id", "account_id", name="uq_user_s3_account"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=False)
    is_root = Column(Boolean, nullable=False, default=False, server_default="0")
    # Legacy field (old portal roles): no longer used by the application.
    account_role = Column(String, nullable=False, default="none", server_default="none")
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


class PortalPermission(Base):
    __tablename__ = "portal_permissions"
    __table_args__ = (UniqueConstraint("key", name="uq_portal_permissions_key"),)

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, nullable=False)
    description = Column(Text, nullable=True)


class PortalRole(Base):
    __tablename__ = "portal_roles"
    __table_args__ = (UniqueConstraint("key", name="uq_portal_roles_key"),)

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, nullable=False)
    description = Column(Text, nullable=True)

    permissions = relationship("PortalRolePermission", back_populates="role", cascade="all, delete-orphan")


class PortalRolePermission(Base):
    __tablename__ = "portal_role_permissions"
    __table_args__ = (UniqueConstraint("role_id", "permission_id", name="uq_portal_role_permission"),)

    id = Column(Integer, primary_key=True, index=True)
    role_id = Column(Integer, ForeignKey("portal_roles.id"), nullable=False)
    permission_id = Column(Integer, ForeignKey("portal_permissions.id"), nullable=False)

    role = relationship("PortalRole", back_populates="permissions")
    permission = relationship("PortalPermission")


class PortalMembership(Base):
    __tablename__ = "portal_memberships"
    __table_args__ = (UniqueConstraint("user_id", "account_id", name="uq_portal_membership"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=False)
    role_key = Column(
        String,
        nullable=False,
        default=PortalRoleKey.VIEWER.value,
        server_default=PortalRoleKey.VIEWER.value,
    )
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="portal_memberships", overlaps="accounts")
    account = relationship("S3Account", back_populates="portal_memberships", overlaps="users")


class PortalRoleBinding(Base):
    __tablename__ = "portal_role_bindings"
    __table_args__ = (
        UniqueConstraint("user_id", "account_id", "role_id", "bucket", "prefix", name="uq_portal_role_binding"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=False)
    role_id = Column(Integer, ForeignKey("portal_roles.id"), nullable=False)
    bucket = Column(String, nullable=True)
    prefix = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User")
    account = relationship("S3Account")
    role = relationship("PortalRole")


class ManagerRootAccess(Base):
    __tablename__ = "manager_root_access"
    __table_args__ = (UniqueConstraint("user_id", "account_id", name="uq_manager_root_access"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="manager_root_links", overlaps="accounts")
    account = relationship("S3Account", back_populates="manager_root_links", overlaps="users")


class IamIdentity(Base):
    __tablename__ = "iam_identities"
    __table_args__ = (UniqueConstraint("user_id", "account_id", name="uq_iam_identity_user_account"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=False)
    iam_user_id = Column(String, nullable=True)
    iam_username = Column(String, nullable=True)
    arn = Column(String, nullable=True)
    active_access_key_id = Column(String, nullable=True)
    is_enabled = Column(Boolean, default=True, nullable=False, server_default="1")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="iam_identities", overlaps="accounts")
    account = relationship("S3Account", back_populates="iam_identities", overlaps="users")
    grants = relationship("AccessGrant", back_populates="iam_identity", cascade="all, delete-orphan")


class AccessGrant(Base):
    __tablename__ = "access_grants"
    __table_args__ = (
        UniqueConstraint("iam_identity_id", "package_key", "bucket", "prefix", name="uq_access_grant"),
    )

    id = Column(Integer, primary_key=True, index=True)
    iam_identity_id = Column(Integer, ForeignKey("iam_identities.id"), nullable=False)
    package_key = Column(String, nullable=False)
    bucket = Column(String, nullable=False)
    prefix = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    materialization_status = Column(String, nullable=False, default="pending", server_default="pending")
    materialization_error = Column(Text, nullable=True)
    iam_group_name = Column(String, nullable=True)
    iam_policy_arn = Column(String, nullable=True)

    iam_identity = relationship("IamIdentity", back_populates="grants")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_email = Column(String, nullable=False)
    user_role = Column(String, nullable=False)
    scope = Column(String, nullable=False)  # e.g. admin / manager
    action = Column(String, nullable=False)
    surface = Column(String, nullable=True)
    workflow = Column(String, nullable=True)
    entity_type = Column(String, nullable=True)
    entity_id = Column(String, nullable=True)
    account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=True)
    account_name = Column(String, nullable=True)
    executor_type = Column(String, nullable=True)
    executor_principal = Column(String, nullable=True)
    status = Column(String, nullable=False, default="success")
    message = Column(String, nullable=True)
    metadata_json = Column(Text, nullable=True)
    delta_json = Column(Text, nullable=True)
    error = Column(Text, nullable=True)

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
