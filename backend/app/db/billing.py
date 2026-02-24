# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.utils.time import utcnow

from sqlalchemy import BigInteger, Column, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from .base import Base


class BillingUsageDaily(Base):
    __tablename__ = "billing_usage_daily"
    __table_args__ = (
        UniqueConstraint(
            "day",
            "storage_endpoint_id",
            "s3_account_id",
            "s3_user_id",
            "source",
            name="uq_billing_usage_daily",
        ),
        Index(
            "ix_billing_usage_daily_endpoint_day_account",
            "storage_endpoint_id",
            "day",
            "s3_account_id",
        ),
        Index(
            "ix_billing_usage_daily_endpoint_day_user",
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
    bytes_in = Column(BigInteger, nullable=False, default=0, server_default="0")
    bytes_out = Column(BigInteger, nullable=False, default=0, server_default="0")
    ops_total = Column(BigInteger, nullable=False, default=0, server_default="0")
    ops_breakdown = Column(Text, nullable=True)
    source = Column(String, nullable=False, default="rgw_admin_usage")
    collected_at = Column(DateTime, nullable=False, default=utcnow)

    storage_endpoint = relationship("StorageEndpoint")
    account = relationship("S3Account")
    s3_user = relationship("S3User")


class BillingStorageDaily(Base):
    __tablename__ = "billing_storage_daily"
    __table_args__ = (
        UniqueConstraint(
            "day",
            "storage_endpoint_id",
            "s3_account_id",
            "s3_user_id",
            "source",
            name="uq_billing_storage_daily",
        ),
        Index(
            "ix_billing_storage_daily_endpoint_day_account",
            "storage_endpoint_id",
            "day",
            "s3_account_id",
        ),
        Index(
            "ix_billing_storage_daily_endpoint_day_user",
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
    total_bytes = Column(BigInteger, nullable=False, default=0, server_default="0")
    total_objects = Column(BigInteger, nullable=False, default=0, server_default="0")
    by_bucket = Column(Text, nullable=True)
    source = Column(String, nullable=False, default="rgw_admin_bucket_stats")
    collected_at = Column(DateTime, nullable=False, default=utcnow)

    storage_endpoint = relationship("StorageEndpoint")
    account = relationship("S3Account")
    s3_user = relationship("S3User")


class BillingRateCard(Base):
    __tablename__ = "billing_rate_cards"
    __table_args__ = (
        UniqueConstraint("name", name="uq_billing_rate_cards_name"),
        Index(
            "ix_billing_rate_cards_endpoint_effective_window",
            "storage_endpoint_id",
            "effective_from",
            "effective_to",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    currency = Column(String, nullable=False, default="EUR", server_default="EUR")
    storage_gb_month_price = Column(Numeric(12, 6), nullable=True)
    egress_gb_price = Column(Numeric(12, 6), nullable=True)
    ingress_gb_price = Column(Numeric(12, 6), nullable=True)
    requests_per_1000_price = Column(Numeric(12, 6), nullable=True)
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=utcnow)
    updated_at = Column(DateTime, nullable=False, default=utcnow)

    storage_endpoint = relationship("StorageEndpoint")


class BillingAssignment(Base):
    __tablename__ = "billing_assignments"
    __table_args__ = (
        Index(
            "ix_billing_assignments_endpoint_account_created",
            "storage_endpoint_id",
            "s3_account_id",
            "created_at",
        ),
        Index(
            "ix_billing_assignments_endpoint_user_created",
            "storage_endpoint_id",
            "s3_user_id",
            "created_at",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=False, index=True)
    s3_account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=True, index=True)
    s3_user_id = Column(Integer, ForeignKey("s3_users.id"), nullable=True, index=True)
    rate_card_id = Column(Integer, ForeignKey("billing_rate_cards.id"), nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=utcnow)

    storage_endpoint = relationship("StorageEndpoint")
    account = relationship("S3Account")
    s3_user = relationship("S3User")
    rate_card = relationship("BillingRateCard")
