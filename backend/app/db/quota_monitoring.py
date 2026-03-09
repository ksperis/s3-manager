# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.utils.time import utcnow

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    text,
)
from sqlalchemy.orm import relationship

from .base import Base


class QuotaUsageHourly(Base):
    __tablename__ = "quota_usage_hourly"
    __table_args__ = (
        CheckConstraint(
            "(s3_account_id IS NOT NULL AND s3_user_id IS NULL) OR "
            "(s3_account_id IS NULL AND s3_user_id IS NOT NULL)",
            name="ck_quota_usage_hourly_subject_kind",
        ),
        Index(
            "uq_quota_usage_hourly_account",
            "hour_ts",
            "storage_endpoint_id",
            "s3_account_id",
            unique=True,
            postgresql_where=text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
            sqlite_where=text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
        ),
        Index(
            "uq_quota_usage_hourly_user",
            "hour_ts",
            "storage_endpoint_id",
            "s3_user_id",
            unique=True,
            postgresql_where=text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
            sqlite_where=text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
        ),
        Index(
            "ix_quota_usage_hourly_endpoint_hour_account",
            "storage_endpoint_id",
            "hour_ts",
            "s3_account_id",
        ),
        Index(
            "ix_quota_usage_hourly_endpoint_hour_user",
            "storage_endpoint_id",
            "hour_ts",
            "s3_user_id",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    hour_ts = Column(DateTime, nullable=False, index=True)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=False, index=True)
    s3_account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=True, index=True)
    s3_user_id = Column(Integer, ForeignKey("s3_users.id"), nullable=True, index=True)
    used_bytes = Column(BigInteger, nullable=False, default=0, server_default="0")
    used_objects = Column(BigInteger, nullable=False, default=0, server_default="0")
    quota_size_bytes = Column(BigInteger, nullable=True)
    quota_objects = Column(BigInteger, nullable=True)
    usage_ratio_pct = Column(Numeric(8, 3), nullable=True)
    collected_at = Column(DateTime, nullable=False, default=utcnow)

    storage_endpoint = relationship("StorageEndpoint")
    account = relationship("S3Account")
    s3_user = relationship("S3User")


class QuotaUsageDaily(Base):
    __tablename__ = "quota_usage_daily"
    __table_args__ = (
        CheckConstraint(
            "(s3_account_id IS NOT NULL AND s3_user_id IS NULL) OR "
            "(s3_account_id IS NULL AND s3_user_id IS NOT NULL)",
            name="ck_quota_usage_daily_subject_kind",
        ),
        Index(
            "uq_quota_usage_daily_account",
            "day",
            "storage_endpoint_id",
            "s3_account_id",
            unique=True,
            postgresql_where=text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
            sqlite_where=text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
        ),
        Index(
            "uq_quota_usage_daily_user",
            "day",
            "storage_endpoint_id",
            "s3_user_id",
            unique=True,
            postgresql_where=text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
            sqlite_where=text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
        ),
        Index(
            "ix_quota_usage_daily_endpoint_day_account",
            "storage_endpoint_id",
            "day",
            "s3_account_id",
        ),
        Index(
            "ix_quota_usage_daily_endpoint_day_user",
            "storage_endpoint_id",
            "day",
            "s3_user_id",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    day = Column(Date, nullable=False, index=True)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=False, index=True)
    s3_account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=True, index=True)
    s3_user_id = Column(Integer, ForeignKey("s3_users.id"), nullable=True, index=True)
    last_used_bytes = Column(BigInteger, nullable=False, default=0, server_default="0")
    last_used_objects = Column(BigInteger, nullable=False, default=0, server_default="0")
    max_ratio_pct = Column(Numeric(8, 3), nullable=True)
    samples_count = Column(Integer, nullable=False, default=1, server_default="1")
    updated_at = Column(DateTime, nullable=False, default=utcnow)

    storage_endpoint = relationship("StorageEndpoint")
    account = relationship("S3Account")
    s3_user = relationship("S3User")


class QuotaAlertState(Base):
    __tablename__ = "quota_alert_states"
    __table_args__ = (
        CheckConstraint(
            "(s3_account_id IS NOT NULL AND s3_user_id IS NULL) OR "
            "(s3_account_id IS NULL AND s3_user_id IS NOT NULL)",
            name="ck_quota_alert_states_subject_kind",
        ),
        Index(
            "uq_quota_alert_states_account",
            "storage_endpoint_id",
            "s3_account_id",
            unique=True,
            postgresql_where=text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
            sqlite_where=text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
        ),
        Index(
            "uq_quota_alert_states_user",
            "storage_endpoint_id",
            "s3_user_id",
            unique=True,
            postgresql_where=text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
            sqlite_where=text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
        ),
        Index(
            "ix_quota_alert_states_endpoint_account",
            "storage_endpoint_id",
            "s3_account_id",
        ),
        Index(
            "ix_quota_alert_states_endpoint_user",
            "storage_endpoint_id",
            "s3_user_id",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=False, index=True)
    s3_account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=True, index=True)
    s3_user_id = Column(Integer, ForeignKey("s3_users.id"), nullable=True, index=True)
    last_level = Column(String, nullable=False, default="normal", server_default="normal")
    last_ratio_pct = Column(Numeric(8, 3), nullable=True)
    last_checked_at = Column(DateTime, nullable=False, default=utcnow)
    last_notified_level = Column(String, nullable=True)
    last_notified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=utcnow)
    updated_at = Column(DateTime, nullable=False, default=utcnow)

    storage_endpoint = relationship("StorageEndpoint")
    account = relationship("S3Account")
    s3_user = relationship("S3User")
