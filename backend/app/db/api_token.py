# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from .base import Base


class ApiToken(Base):
    __tablename__ = "api_tokens"

    id = Column(String, primary_key=True, index=True)
    jti = Column(String, nullable=False, unique=True, index=True)
    token_hash = Column(String, nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False, index=True)
    last_used_at = Column(UTCDateTime(), nullable=True)
    expires_at = Column(UTCDateTime(), nullable=False)
    revoked_at = Column(UTCDateTime(), nullable=True)

    user = relationship("User", foreign_keys=[user_id])
