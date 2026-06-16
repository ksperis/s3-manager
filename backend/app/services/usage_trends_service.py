# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date, timedelta
from typing import Literal

from sqlalchemy.orm import Session

from app.db import QuotaUsageDaily, S3Account
from app.models.manager_stats import ManagerUsageTrendBaseline, ManagerUsageTrendsResponse
from app.utils.time import utcnow

UsageTrendWindow = Literal["month", "week", "day"]

USAGE_TREND_WINDOWS: tuple[tuple[UsageTrendWindow, str, int], ...] = (
    ("month", "last 30 days", 28),
    ("week", "last week", 6),
    ("day", "yesterday", 1),
)


def account_usage_trend_filters(account: S3Account, model=QuotaUsageDaily) -> list | None:
    if getattr(account, "s3_connection_id", None) is not None:
        return None
    endpoint_id = getattr(account, "storage_endpoint_id", None)
    if endpoint_id is None:
        return None

    filters = [model.storage_endpoint_id == int(endpoint_id)]
    s3_user_id = getattr(account, "s3_user_id", None)
    if s3_user_id is not None:
        filters.extend(
            [
                model.s3_user_id == int(s3_user_id),
                model.s3_account_id.is_(None),
            ]
        )
    else:
        filters.extend(
            [
                model.s3_account_id == int(account.id),
                model.s3_user_id.is_(None),
            ]
        )
    return filters


def _serialize_usage_trend_baseline(
    row: QuotaUsageDaily,
    *,
    window: UsageTrendWindow,
    label: str,
) -> ManagerUsageTrendBaseline:
    return ManagerUsageTrendBaseline(
        window=window,
        label=label,
        period_start=row.day.isoformat(),
        used_bytes=int(row.last_used_bytes or 0),
        used_objects=int(row.last_used_objects or 0),
        bucket_count=int(row.bucket_count) if row.bucket_count is not None else None,
        collected_at=row.updated_at.isoformat() if row.updated_at else None,
    )


def select_usage_trend_baseline(
    db: Session,
    *,
    filters: list,
    value_column,
    reference_date: date | None = None,
) -> ManagerUsageTrendBaseline | None:
    today = reference_date or utcnow().date()
    for window, label, min_age_days in USAGE_TREND_WINDOWS:
        cutoff = today - timedelta(days=min_age_days)
        row = (
            db.query(QuotaUsageDaily)
            .filter(*filters, QuotaUsageDaily.day <= cutoff, value_column.isnot(None))
            .order_by(QuotaUsageDaily.day.desc(), QuotaUsageDaily.updated_at.desc(), QuotaUsageDaily.id.desc())
            .first()
        )
        if row is not None:
            return _serialize_usage_trend_baseline(row, window=window, label=label)
    return None


def build_account_usage_trends(
    db: Session,
    account: S3Account,
    *,
    reference_date: date | None = None,
) -> ManagerUsageTrendsResponse:
    filters = account_usage_trend_filters(account)
    if not filters:
        return ManagerUsageTrendsResponse()
    return ManagerUsageTrendsResponse(
        storage=select_usage_trend_baseline(
            db,
            filters=filters,
            value_column=QuotaUsageDaily.last_used_bytes,
            reference_date=reference_date,
        ),
        objects=select_usage_trend_baseline(
            db,
            filters=filters,
            value_column=QuotaUsageDaily.last_used_objects,
            reference_date=reference_date,
        ),
        buckets=select_usage_trend_baseline(
            db,
            filters=filters,
            value_column=QuotaUsageDaily.bucket_count,
            reference_date=reference_date,
        ),
    )
