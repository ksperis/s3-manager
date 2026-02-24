# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship

from .base import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_scope_id", "scope", "id"),
        Index("ix_audit_logs_account_id_id", "account_id", "id"),
        Index("ix_audit_logs_user_role_id", "user_role", "id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_email = Column(String, nullable=False)
    user_role = Column(String, nullable=False)
    scope = Column(String, nullable=False)  # e.g. admin / manager
    action = Column(String, nullable=False)
    entity_type = Column(String, nullable=True)
    entity_id = Column(String, nullable=True)
    account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=True)
    account_name = Column(String, nullable=True)
    status = Column(String, nullable=False, default="success")
    message = Column(String, nullable=True)
    metadata_json = Column(Text, nullable=True)
    request_id = Column(String, nullable=True, index=True)
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)

    user = relationship("User", lazy="joined")
    account = relationship("S3Account", lazy="joined")
