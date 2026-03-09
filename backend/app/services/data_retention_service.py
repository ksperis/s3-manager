# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import BillingStorageDaily, BillingUsageDaily, QuotaUsageDaily, QuotaUsageHourly
from app.utils.time import utcnow


class DataRetentionService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.settings = get_settings()

    def _hourly_cutoff(self) -> datetime | None:
        days = int(self.settings.quota_history_hourly_retention_days or 0)
        if days <= 0:
            return None
        return (utcnow() - timedelta(days=days))

    def _daily_cutoff(self, retention_days: int) -> date | None:
        days = int(retention_days or 0)
        if days <= 0:
            return None
        return (utcnow().date() - timedelta(days=days))

    def purge_quota_history(self) -> dict[str, Any]:
        deleted_hourly = 0
        deleted_daily = 0

        hourly_cutoff = self._hourly_cutoff()
        if hourly_cutoff is not None:
            deleted_hourly = (
                self.db.query(QuotaUsageHourly)
                .filter(QuotaUsageHourly.hour_ts < hourly_cutoff)
                .delete(synchronize_session=False)
            )

        daily_cutoff = self._daily_cutoff(int(self.settings.quota_history_daily_retention_days or 0))
        if daily_cutoff is not None:
            deleted_daily = (
                self.db.query(QuotaUsageDaily)
                .filter(QuotaUsageDaily.day < daily_cutoff)
                .delete(synchronize_session=False)
            )

        if deleted_hourly or deleted_daily:
            self.db.commit()

        return {
            "quota_history": {
                "hourly_retention_days": int(self.settings.quota_history_hourly_retention_days or 0),
                "daily_retention_days": int(self.settings.quota_history_daily_retention_days or 0),
                "deleted_hourly": int(deleted_hourly),
                "deleted_daily": int(deleted_daily),
            }
        }

    def purge_billing_daily(self) -> dict[str, Any]:
        deleted_usage = 0
        deleted_storage = 0

        daily_cutoff = self._daily_cutoff(int(self.settings.billing_daily_retention_days or 0))
        if daily_cutoff is not None:
            deleted_usage = (
                self.db.query(BillingUsageDaily)
                .filter(BillingUsageDaily.day < daily_cutoff)
                .delete(synchronize_session=False)
            )
            deleted_storage = (
                self.db.query(BillingStorageDaily)
                .filter(BillingStorageDaily.day < daily_cutoff)
                .delete(synchronize_session=False)
            )

        if deleted_usage or deleted_storage:
            self.db.commit()

        return {
            "billing_history": {
                "daily_retention_days": int(self.settings.billing_daily_retention_days or 0),
                "deleted_usage_daily": int(deleted_usage),
                "deleted_storage_daily": int(deleted_storage),
            }
        }

    def purge_all(self) -> dict[str, Any]:
        result: dict[str, Any] = {}
        result.update(self.purge_quota_history())
        result.update(self.purge_billing_daily())
        return result
