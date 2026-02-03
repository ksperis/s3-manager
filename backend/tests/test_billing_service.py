# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import date, datetime

import pytest

from app.db import BillingRateCard, BillingStorageDaily, BillingUsageDaily, S3Account, StorageEndpoint
from app.services.billing_service import BillingService, _parse_month


def _seed_endpoint(db_session) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="ceph-prod",
        endpoint_url="http://rgw.local",
        provider="ceph",
        is_default=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    return endpoint


def _seed_account(db_session, endpoint_id: int) -> S3Account:
    account = S3Account(
        name="acme",
        rgw_account_id="RGW12345678901234567",
        storage_endpoint_id=endpoint_id,
    )
    db_session.add(account)
    db_session.commit()
    return account


def test_parse_month():
    period = _parse_month("2026-01")
    assert period.start == date(2026, 1, 1)
    assert period.end == date(2026, 2, 1)
    assert period.days_in_month == 31


def test_billing_summary_and_cost(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)

    day_one = date(2026, 1, 10)
    day_two = date(2026, 1, 11)

    db_session.add_all(
        [
            BillingUsageDaily(
                day=day_one,
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                bytes_in=1024,
                bytes_out=2048,
                ops_total=1000,
                source="rgw_admin_usage",
                collected_at=datetime.utcnow(),
            ),
            BillingUsageDaily(
                day=day_two,
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                bytes_in=2048,
                bytes_out=4096,
                ops_total=500,
                source="rgw_admin_usage",
                collected_at=datetime.utcnow(),
            ),
            BillingStorageDaily(
                day=day_one,
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                total_bytes=100,
                total_objects=10,
                source="rgw_admin_bucket_stats",
                collected_at=datetime.utcnow(),
            ),
            BillingStorageDaily(
                day=day_two,
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                total_bytes=300,
                total_objects=20,
                source="rgw_admin_bucket_stats",
                collected_at=datetime.utcnow(),
            ),
        ]
    )

    rate_card = BillingRateCard(
        name="default",
        currency="EUR",
        storage_gb_month_price=1.0,
        egress_gb_price=2.0,
        ingress_gb_price=0.5,
        requests_per_1000_price=3.0,
        effective_from=date(2025, 1, 1),
        storage_endpoint_id=endpoint.id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db_session.add(rate_card)
    db_session.commit()

    service = BillingService(db_session)
    summary = service.summary("2026-01", endpoint.id)

    assert summary.usage.bytes_in == 3072
    assert summary.usage.bytes_out == 6144
    assert summary.usage.ops_total == 1500
    assert summary.storage.avg_bytes == 200
    assert summary.coverage.days_collected == 2

    assert summary.cost is not None
    assert summary.cost.currency == "EUR"
    assert summary.cost.total_cost is not None
    assert summary.cost.total_cost > 0


def test_billing_subject_detail_and_export(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)

    db_session.add(
        BillingUsageDaily(
            day=date(2026, 1, 5),
            storage_endpoint_id=endpoint.id,
            s3_account_id=account.id,
            bytes_in=0,
            bytes_out=1024,
            ops_total=100,
            source="rgw_admin_usage",
            collected_at=datetime.utcnow(),
        )
    )
    db_session.add(
        BillingStorageDaily(
            day=date(2026, 1, 5),
            storage_endpoint_id=endpoint.id,
            s3_account_id=account.id,
            total_bytes=2048,
            total_objects=5,
            source="rgw_admin_bucket_stats",
            collected_at=datetime.utcnow(),
        )
    )
    db_session.commit()

    service = BillingService(db_session)
    detail = service.subject_detail("2026-01", endpoint.id, "account", account.id)

    assert detail.subject_id == account.id
    assert detail.usage.bytes_out == 1024
    assert detail.storage.avg_bytes == 2048
    assert detail.coverage.days_collected == 1
    assert len(detail.daily) == 1

    filename, payload = service.export_csv("2026-01", endpoint.id)
    assert filename.startswith("billing-2026-01")
    assert "subject_type" in payload
    assert str(account.id) in payload
