# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from .base import Base


class RefreshSession(Base):
    __tablename__ = "refresh_sessions"

    id = Column(String, primary_key=True, index=True)
    token_hash = Column(String, nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    rgw_session_id = Column(String, ForeignKey("rgw_sessions.id"), nullable=True, index=True)
    auth_type = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_used_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)

    user = relationship("User")
    rgw_session = relationship("RgwSession")
