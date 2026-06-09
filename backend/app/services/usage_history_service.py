# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Callable, Literal, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import QuotaUsageDaily, QuotaUsageHourly, S3Account, S3User, StorageEndpoint
from app.models.usage_history import (
    UsageHistoryRecord,
    UsageHistoryResponse,
    UsageHistorySummary,
    UsageHistoryTrendPoint,
    UsageHistoryTrendResponse,
    UsageHistoryTrendSummary,
)
from app.utils.time import utcnow

Granularity = Literal["daily", "hourly"]
SubjectType = Literal["all", "account", "s3_user"]
SortBy = Literal["period", "subject", "used_bytes", "used_objects", "ratio"]
SortDir = Literal["asc", "desc"]
TrendWindow = Literal["day", "week", "month"]
TrendFilterBuilder = Callable[[Any], list]


class UsageHistoryService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def empty_trends(
        self,
        *,
        window: TrendWindow,
        unavailable_reason: Optional[str] = None,
    ) -> UsageHistoryTrendResponse:
        return UsageHistoryTrendResponse(
            window=window,
            granularity=self._trend_granularity(window),
            available=unavailable_reason is None,
            unavailable_reason=unavailable_reason,
        )

    def aggregate_trends(
        self,
        *,
        window: TrendWindow,
        endpoint_id: Optional[int] = None,
        subject_type: SubjectType = "all",
        extra_filter_builder: Optional[TrendFilterBuilder] = None,
    ) -> UsageHistoryTrendResponse:
        granularity = self._trend_granularity(window)
        model = QuotaUsageDaily if granularity == "daily" else QuotaUsageHourly
        period_col = QuotaUsageDaily.day if granularity == "daily" else QuotaUsageHourly.hour_ts
        used_bytes_col = QuotaUsageDaily.last_used_bytes if granularity == "daily" else QuotaUsageHourly.used_bytes
        used_objects_col = QuotaUsageDaily.last_used_objects if granularity == "daily" else QuotaUsageHourly.used_objects
        ratio_col = QuotaUsageDaily.max_ratio_pct if granularity == "daily" else QuotaUsageHourly.usage_ratio_pct
        collected_col = QuotaUsageDaily.updated_at if granularity == "daily" else QuotaUsageHourly.collected_at
        bucket_col = model.bucket_count
        samples_col = QuotaUsageDaily.samples_count if granularity == "daily" else None
        start, end = self._trend_boundaries(window)

        filters = []
        if endpoint_id is not None:
            filters.append(model.storage_endpoint_id == endpoint_id)
        if subject_type == "account":
            filters.append(model.s3_account_id.isnot(None))
        elif subject_type == "s3_user":
            filters.append(model.s3_user_id.isnot(None))
        filters.append(period_col >= start)
        filters.append(period_col <= end)
        if extra_filter_builder is not None:
            filters.extend(extra_filter_builder(model))

        samples_expr = func.sum(samples_col) if samples_col is not None else func.count(model.id)
        rows = (
            self.db.query(
                period_col.label("period_start"),
                func.sum(used_bytes_col).label("used_bytes"),
                func.sum(used_objects_col).label("used_objects"),
                func.sum(func.coalesce(bucket_col, 0)).label("bucket_count"),
                func.max(ratio_col).label("max_usage_ratio_pct"),
                func.count(func.distinct(model.s3_account_id)).label("account_subjects"),
                func.count(func.distinct(model.s3_user_id)).label("user_subjects"),
                samples_expr.label("samples_count"),
                func.max(collected_col).label("collected_at"),
                func.count(model.id).label("records_count"),
            )
            .filter(*filters)
            .group_by(period_col)
            .order_by(period_col.asc())
            .all()
        )

        points = [
            UsageHistoryTrendPoint(
                period_start=self._iso(row.period_start) or "",
                used_bytes=int(row.used_bytes or 0),
                used_objects=int(row.used_objects or 0),
                bucket_count=int(row.bucket_count or 0),
                max_usage_ratio_pct=self._float_or_none(row.max_usage_ratio_pct),
                subjects_count=int(row.account_subjects or 0) + int(row.user_subjects or 0),
                samples_count=int(row.samples_count or 0),
                collected_at=self._iso(row.collected_at),
            )
            for row in rows
        ]
        latest = points[-1] if points else None
        max_ratio = max(
            (point.max_usage_ratio_pct for point in points if point.max_usage_ratio_pct is not None),
            default=None,
        )
        summary = UsageHistoryTrendSummary(
            total_records=sum(int(row.records_count or 0) for row in rows),
            points_count=len(points),
            subjects_count=self._count_subjects(model, filters),
            latest_used_bytes=latest.used_bytes if latest else 0,
            latest_used_objects=latest.used_objects if latest else 0,
            latest_bucket_count=latest.bucket_count if latest else 0,
            latest_collected_at=latest.collected_at if latest else None,
            max_usage_ratio_pct=max_ratio,
        )
        return UsageHistoryTrendResponse(
            window=window,
            granularity=granularity,
            available=True,
            points=points,
            summary=summary,
        )

    def list_records(
        self,
        *,
        granularity: Granularity,
        endpoint_id: Optional[int],
        subject_type: SubjectType,
        start: date | datetime | None,
        end: date | datetime | None,
        page: int,
        page_size: int,
        sort_by: SortBy,
        sort_dir: SortDir,
    ) -> UsageHistoryResponse:
        model = QuotaUsageDaily if granularity == "daily" else QuotaUsageHourly
        period_col = QuotaUsageDaily.day if granularity == "daily" else QuotaUsageHourly.hour_ts
        used_bytes_col = QuotaUsageDaily.last_used_bytes if granularity == "daily" else QuotaUsageHourly.used_bytes
        used_objects_col = QuotaUsageDaily.last_used_objects if granularity == "daily" else QuotaUsageHourly.used_objects
        ratio_col = QuotaUsageDaily.max_ratio_pct if granularity == "daily" else QuotaUsageHourly.usage_ratio_pct
        collected_col = QuotaUsageDaily.updated_at if granularity == "daily" else QuotaUsageHourly.collected_at

        filters = []
        if endpoint_id is not None:
            filters.append(model.storage_endpoint_id == endpoint_id)
        if subject_type == "account":
            filters.append(model.s3_account_id.isnot(None))
        elif subject_type == "s3_user":
            filters.append(model.s3_user_id.isnot(None))
        if start is not None:
            filters.append(period_col >= start)
        if end is not None:
            filters.append(period_col <= end)

        total = int(self.db.query(func.count(model.id)).filter(*filters).scalar() or 0)
        order_col = {
            "period": period_col,
            "subject": func.coalesce(S3Account.name, S3User.name),
            "used_bytes": used_bytes_col,
            "used_objects": used_objects_col,
            "ratio": ratio_col,
        }[sort_by]
        ordered = order_col.asc() if sort_dir == "asc" else order_col.desc()

        rows = (
            self.db.query(
                model,
                StorageEndpoint.name.label("endpoint_name"),
                S3Account.name.label("account_name"),
                S3Account.rgw_account_id.label("account_rgw_account_id"),
                S3Account.rgw_user_uid.label("account_rgw_user_uid"),
                S3User.name.label("s3_user_name"),
                S3User.rgw_user_uid.label("s3_user_uid"),
            )
            .join(StorageEndpoint, model.storage_endpoint_id == StorageEndpoint.id)
            .outerjoin(S3Account, model.s3_account_id == S3Account.id)
            .outerjoin(S3User, model.s3_user_id == S3User.id)
            .filter(*filters)
            .order_by(ordered, model.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )

        summary = UsageHistorySummary(
            total_records=total,
            subjects_count=self._count_subjects(model, filters),
            latest_collected_at=self._iso(self.db.query(func.max(collected_col)).filter(*filters).scalar()),
            max_usage_ratio_pct=self._float_or_none(self.db.query(func.max(ratio_col)).filter(*filters).scalar()),
        )
        items = [
            self._serialize_row(
                granularity=granularity,
                row=row,
                endpoint_name=endpoint_name,
                account_name=account_name,
                account_rgw_account_id=account_rgw_account_id,
                account_rgw_user_uid=account_rgw_user_uid,
                s3_user_name=s3_user_name,
                s3_user_uid=s3_user_uid,
            )
            for (
                row,
                endpoint_name,
                account_name,
                account_rgw_account_id,
                account_rgw_user_uid,
                s3_user_name,
                s3_user_uid,
            ) in rows
        ]
        return UsageHistoryResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            has_next=page * page_size < total,
            summary=summary,
        )

    def _count_subjects(self, model, filters: list) -> int:
        accounts = int(
            self.db.query(func.count(func.distinct(model.s3_account_id)))
            .filter(*filters, model.s3_account_id.isnot(None))
            .scalar()
            or 0
        )
        users = int(
            self.db.query(func.count(func.distinct(model.s3_user_id)))
            .filter(*filters, model.s3_user_id.isnot(None))
            .scalar()
            or 0
        )
        return accounts + users

    @staticmethod
    def _trend_granularity(window: TrendWindow) -> Granularity:
        return "hourly" if window == "day" else "daily"

    @staticmethod
    def _trend_boundaries(window: TrendWindow) -> tuple[date | datetime, date | datetime]:
        now = utcnow()
        if window == "day":
            return now - timedelta(days=1), now
        days = 7 if window == "week" else 30
        today = now.date()
        return today - timedelta(days=days - 1), today

    def _serialize_row(
        self,
        *,
        granularity: Granularity,
        row,
        endpoint_name: str,
        account_name: Optional[str],
        account_rgw_account_id: Optional[str],
        account_rgw_user_uid: Optional[str],
        s3_user_name: Optional[str],
        s3_user_uid: Optional[str],
    ) -> UsageHistoryRecord:
        is_account = row.s3_account_id is not None
        subject_id = int(row.s3_account_id if is_account else row.s3_user_id)
        subject_name = account_name if is_account else s3_user_name
        subject_identifier = (account_rgw_account_id or account_rgw_user_uid) if is_account else s3_user_uid
        if not subject_name:
            subject_name = f"{'Account' if is_account else 'S3 user'} #{subject_id}"

        if granularity == "daily":
            period_start = row.day.isoformat()
            used_bytes = row.last_used_bytes
            used_objects = row.last_used_objects
            bucket_count = row.bucket_count
            quota_size_bytes = None
            quota_objects = None
            usage_ratio_pct = row.max_ratio_pct
            samples_count = row.samples_count
            collected_at = row.updated_at
        else:
            period_start = row.hour_ts.isoformat()
            used_bytes = row.used_bytes
            used_objects = row.used_objects
            bucket_count = row.bucket_count
            quota_size_bytes = row.quota_size_bytes
            quota_objects = row.quota_objects
            usage_ratio_pct = row.usage_ratio_pct
            samples_count = None
            collected_at = row.collected_at

        return UsageHistoryRecord(
            id=int(row.id),
            granularity=granularity,
            period_start=period_start,
            storage_endpoint_id=int(row.storage_endpoint_id),
            endpoint_name=endpoint_name or f"Endpoint #{row.storage_endpoint_id}",
            subject_type="account" if is_account else "s3_user",
            subject_id=subject_id,
            subject_name=subject_name,
            subject_identifier=subject_identifier,
            used_bytes=int(used_bytes or 0),
            used_objects=int(used_objects or 0),
            bucket_count=int(bucket_count) if bucket_count is not None else None,
            quota_size_bytes=int(quota_size_bytes) if quota_size_bytes is not None else None,
            quota_objects=int(quota_objects) if quota_objects is not None else None,
            usage_ratio_pct=self._float_or_none(usage_ratio_pct),
            samples_count=int(samples_count) if samples_count is not None else None,
            collected_at=self._iso(collected_at) or "",
        )

    @staticmethod
    def _float_or_none(value) -> Optional[float]:
        if value is None:
            return None
        if isinstance(value, Decimal):
            return float(value)
        return float(value)

    @staticmethod
    def _iso(value) -> Optional[str]:
        if value is None:
            return None
        if hasattr(value, "isoformat"):
            return value.isoformat()
        return str(value)
