# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

from sqlalchemy import Column, String, Text

from .base import Base
from .enums import UserRole


class S3Session(Base):
    __tablename__ = "s3_sessions"

    id = Column(String, primary_key=True, index=True)
    access_key_enc = Column(String, nullable=True)
    secret_key_enc = Column(String, nullable=True)
    access_key_hash = Column(String, nullable=False, index=True)
    actor_type = Column(String, nullable=False)
    role = Column(String, nullable=False, default=UserRole.UI_USER.value)
    account_id = Column(String, nullable=True)
    account_name = Column(String, nullable=True)
    user_uid = Column(String, nullable=True)
    capabilities = Column(Text, nullable=False)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    last_used_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    idle_expires_at = Column(UTCDateTime(), nullable=False)
    absolute_expires_at = Column(UTCDateTime(), nullable=False)
    revoked_at = Column(UTCDateTime(), nullable=True, index=True)
    revoke_reason = Column(String, nullable=True)
