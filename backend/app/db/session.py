# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow

from sqlalchemy import Boolean, Column, DateTime, String, Text

from .base import Base
from .enums import UserRole


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
    created_at = Column(DateTime, default=utcnow, nullable=False)
    last_used_at = Column(DateTime, default=utcnow, nullable=False)
