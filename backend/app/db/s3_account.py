# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow
from typing import Optional

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.security import EncryptedString
from .base import Base


class S3Account(Base):
    __tablename__ = "s3_accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    rgw_account_id = Column(String, unique=True, nullable=True)
    email = Column(String, nullable=True)
    rgw_access_key = Column(String, nullable=True)
    rgw_secret_key = Column(EncryptedString, nullable=True)
    rgw_user_uid = Column(String, nullable=True)
    tags_json = Column(Text, nullable=False, default="[]", server_default="[]")
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
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
    tag_links = relationship("S3AccountTag", back_populates="account", cascade="all, delete-orphan")

    def set_session_credentials(self, access_key: Optional[str], secret_key: Optional[str]) -> None:
        self._session_access_key = access_key
        self._session_secret_key = secret_key

    def clear_session_credentials(self) -> None:
        if hasattr(self, "_session_access_key"):
            delattr(self, "_session_access_key")
        if hasattr(self, "_session_secret_key"):
            delattr(self, "_session_secret_key")
        if hasattr(self, "_session_token"):
            delattr(self, "_session_token")

    def effective_rgw_credentials(self) -> tuple[Optional[str], Optional[str]]:
        override_access = getattr(self, "_session_access_key", None)
        override_secret = getattr(self, "_session_secret_key", None)
        if override_access and override_secret:
            return override_access, override_secret
        return self.rgw_access_key, self.rgw_secret_key

    def session_token(self) -> Optional[str]:
        return getattr(self, "_session_token", None)


class UserS3Account(Base):
    __tablename__ = "user_s3_accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "account_id", name="uq_user_s3_account"),
        Index("ix_user_s3_accounts_account_user", "account_id", "user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=False)
    is_root = Column(Boolean, nullable=False, default=False, server_default="0")
    account_admin = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, nullable=False)

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
