# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from .base import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
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

    user = relationship("User", lazy="joined")
    account = relationship("S3Account", lazy="joined")
