# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

from sqlalchemy import Column, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from .base import Base


class UserNotification(Base):
    __tablename__ = "user_notifications"
    __table_args__ = (
        UniqueConstraint("user_id", "event_key", name="uq_user_notifications_user_event"),
        Index("ix_user_notifications_user_created", "user_id", "created_at"),
        Index("ix_user_notifications_user_read", "user_id", "read_at"),
        Index("ix_user_notifications_subject_account", "s3_account_id", "created_at"),
        Index("ix_user_notifications_subject_s3_user", "s3_user_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    notification_type = Column(String, nullable=False, index=True)
    severity = Column(String, nullable=False)
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    subject_type = Column(String, nullable=True)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=True, index=True)
    s3_account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=True, index=True)
    s3_user_id = Column(Integer, ForeignKey("s3_users.id"), nullable=True, index=True)
    event_key = Column(String, nullable=False)
    payload_json = Column(Text, nullable=True)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow, index=True)
    read_at = Column(UTCDateTime(), nullable=True)

    user = relationship("User")
    storage_endpoint = relationship("StorageEndpoint")
    account = relationship("S3Account")
    s3_user = relationship("S3User")
