# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import date, datetime
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import QuotaUsageDaily, QuotaUsageHourly
from app.services.quota_subject import SubjectContext, quota_subject_ids


class QuotaUsageHistoryService:
    """Persist idempotent hourly and daily quota usage samples."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def upsert_hourly(
        self,
        subject: SubjectContext,
        used_bytes: int,
        used_objects: int,
        bucket_count: int,
        quota_size_bytes: Optional[int],
        quota_objects: Optional[int],
        ratio_pct: Optional[float],
        now: datetime,
    ) -> None:
        hour_ts = now.replace(minute=0, second=0, microsecond=0)
        account_id, user_id = quota_subject_ids(subject)
        existing = self._find_hourly(
            hour_ts=hour_ts,
            subject=subject,
            account_id=account_id,
            user_id=user_id,
        )
        if existing is not None:
            self._update_hourly(
                existing,
                used_bytes=used_bytes,
                used_objects=used_objects,
                bucket_count=bucket_count,
                quota_size_bytes=quota_size_bytes,
                quota_objects=quota_objects,
                ratio_pct=ratio_pct,
                now=now,
            )
            return
        row = QuotaUsageHourly(
            hour_ts=hour_ts,
            storage_endpoint_id=subject.endpoint_id,
            s3_account_id=account_id,
            s3_user_id=user_id,
            used_bytes=int(used_bytes),
            used_objects=int(used_objects),
            bucket_count=int(bucket_count),
            quota_size_bytes=quota_size_bytes,
            quota_objects=quota_objects,
            usage_ratio_pct=ratio_pct,
            collected_at=now,
        )
        try:
            with self.db.begin_nested():
                self.db.add(row)
                self.db.flush()
        except IntegrityError:
            existing = self._find_hourly(
                hour_ts=hour_ts,
                subject=subject,
                account_id=account_id,
                user_id=user_id,
            )
            if existing is None:
                raise
            self._update_hourly(
                existing,
                used_bytes=used_bytes,
                used_objects=used_objects,
                bucket_count=bucket_count,
                quota_size_bytes=quota_size_bytes,
                quota_objects=quota_objects,
                ratio_pct=ratio_pct,
                now=now,
            )

    def upsert_daily(
        self,
        subject: SubjectContext,
        used_bytes: int,
        used_objects: int,
        bucket_count: int,
        ratio_pct: Optional[float],
        now: datetime,
    ) -> None:
        day = now.date()
        account_id, user_id = quota_subject_ids(subject)
        existing = self._find_daily(
            day=day,
            subject=subject,
            account_id=account_id,
            user_id=user_id,
        )
        if existing is not None:
            self._update_daily(
                existing,
                used_bytes=used_bytes,
                used_objects=used_objects,
                bucket_count=bucket_count,
                ratio_pct=ratio_pct,
                now=now,
            )
            return
        row = QuotaUsageDaily(
            day=day,
            storage_endpoint_id=subject.endpoint_id,
            s3_account_id=account_id,
            s3_user_id=user_id,
            last_used_bytes=int(used_bytes),
            last_used_objects=int(used_objects),
            bucket_count=int(bucket_count),
            max_ratio_pct=ratio_pct,
            samples_count=1,
            updated_at=now,
        )
        try:
            with self.db.begin_nested():
                self.db.add(row)
                self.db.flush()
        except IntegrityError:
            existing = self._find_daily(
                day=day,
                subject=subject,
                account_id=account_id,
                user_id=user_id,
            )
            if existing is None:
                raise
            self._update_daily(
                existing,
                used_bytes=used_bytes,
                used_objects=used_objects,
                bucket_count=bucket_count,
                ratio_pct=ratio_pct,
                now=now,
            )

    def _find_hourly(
        self,
        *,
        hour_ts: datetime,
        subject: SubjectContext,
        account_id: Optional[int],
        user_id: Optional[int],
    ) -> Optional[QuotaUsageHourly]:
        return (
            self.db.query(QuotaUsageHourly)
            .filter(
                QuotaUsageHourly.hour_ts == hour_ts,
                QuotaUsageHourly.storage_endpoint_id == subject.endpoint_id,
                QuotaUsageHourly.s3_account_id == account_id,
                QuotaUsageHourly.s3_user_id == user_id,
            )
            .first()
        )

    @staticmethod
    def _update_hourly(
        row: QuotaUsageHourly,
        *,
        used_bytes: int,
        used_objects: int,
        bucket_count: int,
        quota_size_bytes: Optional[int],
        quota_objects: Optional[int],
        ratio_pct: Optional[float],
        now: datetime,
    ) -> None:
        row.used_bytes = int(used_bytes)
        row.used_objects = int(used_objects)
        row.bucket_count = int(bucket_count)
        row.quota_size_bytes = quota_size_bytes
        row.quota_objects = quota_objects
        row.usage_ratio_pct = ratio_pct
        row.collected_at = now

    def _find_daily(
        self,
        *,
        day: date,
        subject: SubjectContext,
        account_id: Optional[int],
        user_id: Optional[int],
    ) -> Optional[QuotaUsageDaily]:
        return (
            self.db.query(QuotaUsageDaily)
            .filter(
                QuotaUsageDaily.day == day,
                QuotaUsageDaily.storage_endpoint_id == subject.endpoint_id,
                QuotaUsageDaily.s3_account_id == account_id,
                QuotaUsageDaily.s3_user_id == user_id,
            )
            .first()
        )

    @staticmethod
    def _update_daily(
        row: QuotaUsageDaily,
        *,
        used_bytes: int,
        used_objects: int,
        bucket_count: int,
        ratio_pct: Optional[float],
        now: datetime,
    ) -> None:
        row.last_used_bytes = int(used_bytes)
        row.last_used_objects = int(used_objects)
        row.bucket_count = int(bucket_count)
        if ratio_pct is not None:
            if row.max_ratio_pct is None:
                row.max_ratio_pct = ratio_pct
            else:
                row.max_ratio_pct = max(
                    float(row.max_ratio_pct),
                    ratio_pct,
                )
        row.samples_count = int(row.samples_count or 0) + 1
        row.updated_at = now
