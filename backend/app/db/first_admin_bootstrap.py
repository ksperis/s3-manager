# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db.utc_datetime import UTCDateTime

from sqlalchemy import CheckConstraint, Column, ForeignKey, Integer, String

from .base import Base


class FirstAdminBootstrap(Base):
    """Singleton state for the explicitly-issued first-admin bootstrap token."""

    __tablename__ = "first_admin_bootstrap"
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_first_admin_bootstrap_singleton"),
    )

    id = Column(Integer, primary_key=True)
    token_digest = Column(String(64), nullable=True)
    issued_at = Column(UTCDateTime(), nullable=True)
    expires_at = Column(UTCDateTime(), nullable=True)
    consumed_at = Column(UTCDateTime(), nullable=True)
    created_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
