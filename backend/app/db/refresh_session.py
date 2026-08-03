# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from .base import Base


class RefreshSession(Base):
    __tablename__ = "refresh_sessions"

    id = Column(String, primary_key=True, index=True)
    token_hash = Column(String, nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    s3_session_id = Column(String, ForeignKey("s3_sessions.id"), nullable=True, index=True)
    auth_type = Column(String, nullable=True)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    last_used_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    expires_at = Column(UTCDateTime(), nullable=False)
    revoked_at = Column(UTCDateTime(), nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    s3_session = relationship("S3Session")
