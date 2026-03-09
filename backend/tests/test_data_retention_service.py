# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace

from app.utils.time import utcnow

from app.db import (
    BillingStorageDaily,
    BillingUsageDaily,
    QuotaUsageDaily,
    QuotaUsageHourly,
    S3Account,
    StorageEndpoint,
    StorageProvider,
)
from app.services.data_retention_service import DataRetentionService


def _seed_endpoint_and_account(db_session) -> tuple[StorageEndpoint, S3Account]:
    endpoint = StorageEndpoint(
        name="retention-endpoint",
        endpoint_url="http://retention-rgw.local",
        provider=StorageProvider.CEPH.value,
        is_default=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)

    account = S3Account(
        name="retention-account",
        rgw_account_id="RGW12345678901234567",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return endpoint, account


def test_purge_all_removes_old_quota_and_billing_rows(db_session):
    endpoint, account = _seed_endpoint_and_account(db_session)
    now = utcnow()
    current_hour = now.replace(minute=0, second=0, microsecond=0)
    old_hour = current_hour - timedelta(days=45)

    db_session.add_all(
        [
            QuotaUsageHourly(
                hour_ts=old_hour,
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                s3_user_id=None,
                used_bytes=100,
                used_objects=10,
                usage_ratio_pct=10.0,
                collected_at=now,
            ),
            QuotaUsageHourly(
                hour_ts=current_hour,
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                s3_user_id=None,
                used_bytes=10,
                used_objects=1,
                usage_ratio_pct=1.0,
                collected_at=now,
            ),
        ]
    )

    db_session.add_all(
        [
            QuotaUsageDaily(
                day=now.date() - timedelta(days=400),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                s3_user_id=None,
                last_used_bytes=100,
                last_used_objects=10,
                max_ratio_pct=20.0,
                samples_count=1,
                updated_at=now,
            ),
            QuotaUsageDaily(
                day=now.date(),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                s3_user_id=None,
                last_used_bytes=110,
                last_used_objects=11,
                max_ratio_pct=22.0,
                samples_count=1,
                updated_at=now,
            ),
            BillingUsageDaily(
                day=now.date() - timedelta(days=400),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                bytes_in=1,
                bytes_out=2,
                ops_total=3,
                source="rgw_admin_usage",
                collected_at=now,
            ),
            BillingUsageDaily(
                day=now.date(),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                bytes_in=11,
                bytes_out=22,
                ops_total=33,
                source="rgw_admin_usage",
                collected_at=now,
            ),
            BillingStorageDaily(
                day=now.date() - timedelta(days=400),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                total_bytes=100,
                total_objects=5,
                source="rgw_admin_bucket_stats",
                collected_at=now,
            ),
            BillingStorageDaily(
                day=now.date(),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                total_bytes=200,
                total_objects=8,
                source="rgw_admin_bucket_stats",
                collected_at=now,
            ),
        ]
    )
    db_session.commit()

    service = DataRetentionService(db_session)
    service.settings = SimpleNamespace(
        quota_history_hourly_retention_days=30,
        quota_history_daily_retention_days=365,
        billing_daily_retention_days=365,
    )

    first = service.purge_all()
    assert first["quota_history"]["deleted_hourly"] == 1
    assert first["quota_history"]["deleted_daily"] == 1
    assert first["billing_history"]["deleted_usage_daily"] == 1
    assert first["billing_history"]["deleted_storage_daily"] == 1

    assert db_session.query(QuotaUsageHourly).count() == 1
    assert db_session.query(QuotaUsageDaily).count() == 1
    assert db_session.query(BillingUsageDaily).count() == 1
    assert db_session.query(BillingStorageDaily).count() == 1

    second = service.purge_all()
    assert second["quota_history"]["deleted_hourly"] == 0
    assert second["quota_history"]["deleted_daily"] == 0
    assert second["billing_history"]["deleted_usage_daily"] == 0
    assert second["billing_history"]["deleted_storage_daily"] == 0


def test_purge_all_with_zero_retention_disables_purge(db_session):
    endpoint, account = _seed_endpoint_and_account(db_session)
    now = utcnow()

    db_session.add_all(
        [
            QuotaUsageHourly(
                hour_ts=now.replace(minute=0, second=0, microsecond=0) - timedelta(days=400),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                s3_user_id=None,
                used_bytes=1,
                used_objects=1,
                usage_ratio_pct=1.0,
                collected_at=now,
            ),
            QuotaUsageDaily(
                day=now.date() - timedelta(days=400),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                s3_user_id=None,
                last_used_bytes=1,
                last_used_objects=1,
                max_ratio_pct=1.0,
                samples_count=1,
                updated_at=now,
            ),
            BillingUsageDaily(
                day=now.date() - timedelta(days=400),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                bytes_in=1,
                bytes_out=1,
                ops_total=1,
                source="rgw_admin_usage",
                collected_at=now,
            ),
            BillingStorageDaily(
                day=now.date() - timedelta(days=400),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                total_bytes=1,
                total_objects=1,
                source="rgw_admin_bucket_stats",
                collected_at=now,
            ),
        ]
    )
    db_session.commit()

    service = DataRetentionService(db_session)
    service.settings = SimpleNamespace(
        quota_history_hourly_retention_days=0,
        quota_history_daily_retention_days=0,
        billing_daily_retention_days=0,
    )

    result = service.purge_all()
    assert result["quota_history"]["deleted_hourly"] == 0
    assert result["quota_history"]["deleted_daily"] == 0
    assert result["billing_history"]["deleted_usage_daily"] == 0
    assert result["billing_history"]["deleted_storage_daily"] == 0

    assert db_session.query(QuotaUsageHourly).count() == 1
    assert db_session.query(QuotaUsageDaily).count() == 1
    assert db_session.query(BillingUsageDaily).count() == 1
    assert db_session.query(BillingStorageDaily).count() == 1
