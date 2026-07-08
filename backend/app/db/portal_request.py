# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.utils.time import utcnow

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship

from .base import Base


class PortalAdminRequest(Base):
    __tablename__ = "portal_admin_requests"
    __table_args__ = (
        CheckConstraint(
            "request_type IN ('portal_user_access', 'portal_user_removal', 'account_quota_change')",
            name="ck_portal_admin_requests_type",
        ),
        CheckConstraint(
            "status IN ('pending', 'processing', 'approved', 'rejected', 'failed')",
            name="ck_portal_admin_requests_status",
        ),
        Index("ix_portal_admin_requests_account_status", "account_id", "status", "created_at"),
        Index("ix_portal_admin_requests_requester", "requester_user_id", "created_at"),
        Index("ix_portal_admin_requests_status_created", "status", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("s3_accounts.id", ondelete="CASCADE"), nullable=False)
    requester_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    requester_email = Column(String, nullable=False)
    request_type = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending", server_default="pending")
    payload_json = Column(Text, nullable=False)
    result_json = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    decided_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_by_email = Column(String, nullable=True)
    decided_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    account = relationship("S3Account")
    requester = relationship("User", foreign_keys=[requester_user_id])
    decided_by = relationship("User", foreign_keys=[decided_by_user_id])
    messages = relationship(
        "PortalAdminRequestMessage",
        back_populates="request",
        cascade="all, delete-orphan",
        order_by="PortalAdminRequestMessage.created_at.asc(), PortalAdminRequestMessage.id.asc()",
    )


class PortalAdminRequestMessage(Base):
    __tablename__ = "portal_admin_request_messages"
    __table_args__ = (
        Index("ix_portal_admin_request_messages_request", "request_id", "created_at"),
        Index("ix_portal_admin_request_messages_author", "author_user_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(Integer, ForeignKey("portal_admin_requests.id", ondelete="CASCADE"), nullable=False)
    author_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    author_email = Column(String, nullable=False)
    author_role = Column(String, nullable=True)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    request = relationship("PortalAdminRequest", back_populates="messages")
    author = relationship("User")
