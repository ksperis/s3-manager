# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Float,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from app.core.security import EncryptedString
from .base import Base
from .enums import StorageProvider


class StorageEndpoint(Base):
    __tablename__ = "storage_endpoints"
    __table_args__ = (
        UniqueConstraint("name", name="uq_storage_endpoints_name"),
        UniqueConstraint("endpoint_url", name="uq_storage_endpoints_endpoint"),
        CheckConstraint(
            "provider IN ('ceph', 'aws', 'other')",
            name="ck_storage_endpoints_provider",
        ),
        CheckConstraint(
            "endpoint_url = trim(endpoint_url) "
            "AND endpoint_url NOT LIKE '%/' "
            "AND length(endpoint_url) > 0",
            name="ck_storage_endpoints_endpoint_url_canonical",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    endpoint_url = Column(String, nullable=False)
    region = Column(String, nullable=True)
    provider = Column(String, nullable=False, default=StorageProvider.CEPH.value)
    admin_access_key = Column(String, nullable=True)
    admin_secret_key = Column(EncryptedString, nullable=True)
    supervision_access_key = Column(String, nullable=True)
    supervision_secret_key = Column(EncryptedString, nullable=True)
    ceph_admin_access_key = Column(String, nullable=True)
    ceph_admin_secret_key = Column(EncryptedString, nullable=True)
    features_config = Column(Text, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    force_path_style = Column(Boolean, default=False, nullable=False, server_default="0")
    verify_tls = Column(Boolean, default=True, nullable=False, server_default="1")
    is_default = Column(Boolean, default=False, nullable=False, server_default="0")
    is_editable = Column(Boolean, default=True, nullable=False, server_default="1")
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=utcnow, onupdate=utcnow, nullable=False)

    tag_links = relationship("StorageEndpointTag", back_populates="endpoint", cascade="all, delete-orphan")
    bucket_ui_tag_assignments = relationship(
        "BucketUiTagAssignment",
        back_populates="endpoint",
        cascade="all, delete-orphan",
    )
