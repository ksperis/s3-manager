# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from app.core.security import EncryptedString
from .base import Base
from .enums import StorageProvider


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
    ceph_admin_access_key = Column(String, nullable=True)
    ceph_admin_secret_key = Column(EncryptedString, nullable=True)
    features_config = Column(Text, nullable=True)
    tags_json = Column(Text, nullable=False, default="[]", server_default="[]")
    verify_tls = Column(Boolean, default=True, nullable=False, server_default="1")
    is_default = Column(Boolean, default=False, nullable=False, server_default="0")
    is_editable = Column(Boolean, default=True, nullable=False, server_default="1")
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    tag_links = relationship("StorageEndpointTag", back_populates="endpoint", cascade="all, delete-orphan")
