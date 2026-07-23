# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text

from app.core.security import EncryptedString
from .base import Base


class LdapProvider(Base):
    __tablename__ = "ldap_providers"

    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=False)
    url = Column(String, nullable=False)
    bind_dn = Column(String, nullable=True)
    bind_password = Column(EncryptedString, nullable=True)
    user_base_dn = Column(String, nullable=False)
    user_filter = Column(Text, nullable=False)
    email_attribute = Column(String, nullable=False, default="mail")
    name_attribute = Column(String, nullable=True)
    subject_attribute = Column(String, nullable=True)
    start_tls = Column(Boolean, nullable=False, default=False)
    tls_verify = Column(Boolean, nullable=False, default=True)
    tls_ca_file = Column(String, nullable=True)
    allow_legacy_tls = Column(Boolean, nullable=False, default=False)
    timeout_seconds = Column(Float, nullable=False, default=5.0)
    enabled = Column(Boolean, nullable=False, default=True)
    allow_insecure = Column(Boolean, nullable=False, default=False)
    allow_email_linking = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
