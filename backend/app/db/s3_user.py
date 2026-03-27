# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.security import EncryptedString
from .base import Base


class S3User(Base):
    __tablename__ = "s3_users"
    __table_args__ = (UniqueConstraint("rgw_user_uid", name="uq_s3_users_uid"),)

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    rgw_user_uid = Column(String, nullable=False)
    email = Column(String, nullable=True)
    rgw_access_key = Column(String, nullable=False)
    rgw_secret_key = Column(EncryptedString, nullable=False)
    tags_json = Column(Text, nullable=False, default="[]", server_default="[]")
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
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
    tag_links = relationship("S3UserTag", back_populates="s3_user", cascade="all, delete-orphan")


class UserS3User(Base):
    __tablename__ = "user_s3_users"
    __table_args__ = (
        UniqueConstraint("user_id", "s3_user_id", name="uq_user_s3_user"),
        Index("ix_user_s3_users_s3_user_user", "s3_user_id", "user_id"),
    )

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
