# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from .base import Base


class PortalStorageSpaceMetadata(Base):
    __tablename__ = "portal_storage_space_metadata"
    __table_args__ = (
        UniqueConstraint("account_id", "bucket_name", name="uq_portal_storage_space_metadata_account_bucket"),
        CheckConstraint(
            "share_scope IN ('restricted', 'account')",
            name="ck_portal_storage_space_metadata_share_scope",
        ),
        CheckConstraint(
            "account_member_role IS NULL OR account_member_role IN ('Viewer', 'Editor')",
            name="ck_portal_storage_space_metadata_account_member_role",
        ),
        Index("ix_portal_storage_space_metadata_account", "account_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("s3_accounts.id", ondelete="CASCADE"), nullable=False)
    bucket_name = Column(String, nullable=False)
    display_name = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    owner_label = Column(String, nullable=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    visibility = Column(String, nullable=False, default="private")
    share_scope = Column(String, nullable=False, default="restricted")
    account_member_role = Column(String, nullable=True)
    project_key = Column(String, nullable=True)
    dataset_label = Column(String, nullable=True)
    origin = Column(String, nullable=False, default="legacy")
    name_editable = Column(Boolean, nullable=False, default=False)
    archived_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    account = relationship("S3Account")
    owner_user = relationship("User")
    grants = relationship(
        "PortalStorageSpaceGrant",
        back_populates="storage_space",
        cascade="all, delete-orphan",
    )


class PortalStorageSpaceGrant(Base):
    __tablename__ = "portal_storage_space_grants"
    __table_args__ = (
        UniqueConstraint(
            "storage_space_metadata_id",
            "user_id",
            name="uq_portal_storage_space_grants_space_user",
        ),
        CheckConstraint(
            "role IN ('Viewer', 'Editor', 'Owner')",
            name="ck_portal_storage_space_grants_role",
        ),
        Index("ix_portal_storage_space_grants_space", "storage_space_metadata_id"),
        Index("ix_portal_storage_space_grants_user", "user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    storage_space_metadata_id = Column(
        Integer,
        ForeignKey("portal_storage_space_metadata.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String, nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    storage_space = relationship("PortalStorageSpaceMetadata", back_populates="grants")
    user = relationship("User", foreign_keys=[user_id])
    created_by = relationship("User", foreign_keys=[created_by_user_id])


class PortalPublicLink(Base):
    __tablename__ = "portal_public_links"
    __table_args__ = (
        UniqueConstraint("token", name="uq_portal_public_links_token"),
        Index("ix_portal_public_links_account_bucket", "account_id", "bucket_name"),
        Index("ix_portal_public_links_expires", "expires_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String, nullable=False)
    account_id = Column(Integer, ForeignKey("s3_accounts.id", ondelete="CASCADE"), nullable=False)
    bucket_name = Column(String, nullable=False)
    object_key = Column(Text, nullable=False)
    label = Column(String, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_email = Column(String, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    account = relationship("S3Account")
    created_by = relationship("User")
