# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

from sqlalchemy import Boolean, CheckConstraint, Column, ForeignKey, Index, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from .base import Base


class PortalStorageSpaceMetadata(Base):
    __tablename__ = "portal_storage_space_metadata"
    __table_args__ = (
        UniqueConstraint("account_id", "bucket_name", name="uq_portal_storage_space_metadata_account_bucket"),
        CheckConstraint(
            "(visibility = 'private' AND share_scope = 'restricted' AND account_member_role IS NULL) OR "
            "(visibility = 'shared' AND ("
            "(share_scope = 'restricted' AND account_member_role IS NULL) OR "
            "(share_scope = 'account' AND account_member_role IS NOT NULL "
            "AND account_member_role IN ('Viewer', 'Editor'))"
            "))",
            name="ck_portal_storage_space_metadata_canonical_sharing",
        ),
        CheckConstraint(
            "icon_source IN ('preset', 'uploaded')",
            name="ck_portal_storage_space_metadata_icon_source",
        ),
        CheckConstraint(
            "icon_preset IN ('bucket', 'folder', 'archive', 'database', 'media')",
            name="ck_portal_storage_space_metadata_icon_preset",
        ),
        CheckConstraint(
            "icon_content_type IS NULL OR icon_content_type IN ('image/jpeg', 'image/png')",
            name="ck_portal_storage_space_metadata_icon_content_type",
        ),
        CheckConstraint(
            "(visibility = 'private' AND owner_user_id IS NOT NULL) OR "
            "(visibility = 'shared' AND owner_user_id IS NULL)",
            name="ck_portal_storage_space_metadata_private_owner",
        ),
        Index("ix_portal_storage_space_metadata_account", "account_id"),
        Index("ix_portal_storage_space_metadata_owner_user", "owner_user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("s3_accounts.id", ondelete="CASCADE"), nullable=False)
    bucket_name = Column(String, nullable=False)
    display_name = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    visibility = Column(String, nullable=False, default="private")
    share_scope = Column(String, nullable=False, default="restricted")
    account_member_role = Column(String, nullable=True)
    project_key = Column(String, nullable=True)
    dataset_label = Column(String, nullable=True)
    icon_source = Column(String, nullable=False, default="preset", server_default="preset")
    icon_preset = Column(String, nullable=False, default="bucket", server_default="bucket")
    icon_image = Column(LargeBinary, nullable=True)
    icon_content_type = Column(String, nullable=True)
    icon_updated_at = Column(UTCDateTime(), nullable=True)
    origin = Column(String, nullable=False, default="imported")
    name_editable = Column(Boolean, nullable=False, default=False)
    archived_at = Column(UTCDateTime(), nullable=True)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=utcnow, onupdate=utcnow, nullable=False)

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
            "role IN ('Viewer', 'Editor')",
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
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=utcnow, onupdate=utcnow, nullable=False)

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
    expires_at = Column(UTCDateTime(), nullable=True)
    revoked_at = Column(UTCDateTime(), nullable=True)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)

    account = relationship("S3Account")
    created_by = relationship("User")


class PortalExternalAccessCredential(Base):
    __tablename__ = "portal_external_access_credentials"
    __table_args__ = (
        UniqueConstraint("iam_username", name="uq_portal_external_access_credentials_iam_username"),
        UniqueConstraint("access_key_id", name="uq_portal_external_access_credentials_access_key"),
        CheckConstraint(
            "permission IN ('read_only', 'read_write')",
            name="ck_portal_external_access_credentials_permission",
        ),
        CheckConstraint(
            "status IN ('Active', 'Inactive')",
            name="ck_portal_external_access_credentials_status",
        ),
        Index("ix_portal_external_access_credentials_account", "account_id"),
        Index("ix_portal_external_access_credentials_space", "storage_space_metadata_id"),
        Index("ix_portal_external_access_credentials_creator", "created_by_user_id"),
        Index("ix_portal_external_access_credentials_revoked", "revoked_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("s3_accounts.id", ondelete="CASCADE"), nullable=False)
    storage_space_metadata_id = Column(
        Integer,
        ForeignKey("portal_storage_space_metadata.id", ondelete="CASCADE"),
        nullable=False,
    )
    bucket_name = Column(String, nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    external_email = Column(String, nullable=False)
    permission = Column(String, nullable=False)
    iam_user_id = Column(String, nullable=True)
    iam_username = Column(String, nullable=False)
    access_key_id = Column(String, nullable=False)
    status = Column(String, nullable=False, default="Active", server_default="Active")
    revoked_at = Column(UTCDateTime(), nullable=True)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=utcnow, onupdate=utcnow, nullable=False)

    account = relationship("S3Account")
    storage_space = relationship("PortalStorageSpaceMetadata")
    created_by = relationship("User")
