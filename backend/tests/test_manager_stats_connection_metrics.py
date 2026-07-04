# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from datetime import date, datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import QuotaUsageDaily, QuotaUsageHourly, S3Account, S3Connection, S3User, StorageEndpoint, User, UserRole
from app.models.app_settings import AppSettings
from app.routers import dependencies
from app.routers.manager import stats as manager_stats_router
from app.services.rgw_admin import RGWAdminError
from app.services import usage_history_service
from app.services.traffic_service import TrafficWindow


def _request(path: str):
    return SimpleNamespace(url=SimpleNamespace(path=path), headers={})


def _ceph_endpoint(name: str) -> StorageEndpoint:
    return StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        admin_endpoint=f"https://{name}.example.test/admin",
        provider="ceph",
        supervision_access_key="SUP-AK",
        supervision_secret_key="SUP-SK",
        features_config=(
            "features:\n"
            "  admin:\n"
            "    enabled: true\n"
            "  metrics:\n"
            "    enabled: true\n"
            "  usage:\n"
            "    enabled: true\n"
        ),
    )


def _usage_history_settings(enabled: bool) -> AppSettings:
    settings = AppSettings()
    settings.general.usage_history_enabled = enabled
    return settings


def test_manager_stats_overview_allows_connection_with_resolved_identity(db_session):
    user = User(
        email="manager-stats-conn@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    endpoint = _ceph_endpoint("ceph-stats-overview")
    connection = S3Connection(
        created_by=user,
        name="metrics-connection",
        access_manager=True,
        access_browser=True,
        storage_endpoint=endpoint,
        credential_owner_type="s3_user",
        credential_owner_identifier="rgw-account$reporting",
        capabilities_json=json.dumps({"can_manage_iam": False}),
        access_key_id="AK-CONN-STATS",
        secret_access_key="SK-CONN-STATS",
    )
    db_session.add_all([user, endpoint, connection])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(connection)

    account = dependencies.get_account_context(
        request=_request("/api/manager/stats/overview"),
        account_ref=f"conn-{connection.id}",
        actor=user,
        db=db_session,
    )
    dependencies.require_usage_capable_manager(account=account, actor=user)
    assert account.rgw_user_uid == "rgw-account$reporting"

    class _FakeBucketsService:
        def list_buckets(self, target_account):
            assert target_account.rgw_user_uid == "rgw-account$reporting"
            return []

    payload = manager_stats_router.account_stats(account=account, bucket_service=_FakeBucketsService(), _={})
    assert payload["total_buckets"] == 0
    assert payload["total_bytes"] == 0
    assert payload["total_objects"] == 0


def test_manager_stats_overview_sanitizes_bucket_error_details():
    account = S3Account(name="stats-error-account", rgw_account_id="rgw-stats-error")

    class _LeakyBucketsService:
        def list_buckets(self, target_account):
            raise RuntimeError(
                "GET https://rgw.internal.local/admin?X-Amz-Signature=abcdef "
                "failed with access_key=AKIAIOSFODNN7EXAMPLE and secret_key=top-secret"
            )

    with pytest.raises(HTTPException) as exc:
        manager_stats_router.account_stats(account=account, bucket_service=_LeakyBucketsService(), _={})

    detail = str(exc.value.detail)
    assert exc.value.status_code == 502
    assert detail.startswith("Unable to fetch buckets:")
    assert "<redacted-url>" in detail
    assert "access_key=<redacted>" in detail
    assert "secret_key=<redacted>" in detail
    assert "rgw.internal.local" not in detail
    assert "AKIAIOSFODNN7EXAMPLE" not in detail
    assert "top-secret" not in detail


def test_manager_stats_traffic_allows_connection_with_resolved_identity(db_session, monkeypatch):
    user = User(
        email="manager-stats-conn-traffic@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    endpoint = _ceph_endpoint("ceph-stats-traffic")
    connection = S3Connection(
        created_by=user,
        name="traffic-connection",
        access_manager=True,
        access_browser=True,
        storage_endpoint=endpoint,
        credential_owner_type="s3_user",
        credential_owner_identifier="rgw-account$traffic",
        capabilities_json=json.dumps({"can_manage_iam": False}),
        access_key_id="AK-CONN-TRAFFIC",
        secret_access_key="SK-CONN-TRAFFIC",
    )
    db_session.add_all([user, endpoint, connection])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(connection)

    account = dependencies.get_account_context(
        request=_request("/api/manager/stats/traffic"),
        account_ref=f"conn-{connection.id}",
        actor=user,
        db=db_session,
    )
    dependencies.require_metrics_capable_manager(account=account, actor=user)
    assert account.rgw_user_uid == "rgw-account$traffic"

    captured = {"uid": None}

    class _FakeTrafficService:
        def __init__(self, target_account):
            captured["uid"] = target_account.rgw_user_uid

        def get_traffic(self, window, bucket=None):
            return {
                "window": window.value,
                "bucket_filter": bucket,
                "series": [],
                "totals": {"bytes_in": 0, "bytes_out": 0, "ops": 0, "success_ops": 0, "success_rate": None},
                "bucket_rankings": [],
                "user_rankings": [],
                "request_breakdown": [],
                "category_breakdown": [],
                "start": "2026-01-01T00:00:00+00:00",
                "end": "2026-01-01T00:00:00+00:00",
                "resolution": "daily",
                "data_points": 0,
            }

    monkeypatch.setattr(manager_stats_router, "TrafficService", _FakeTrafficService)
    payload = manager_stats_router.account_traffic(
        window=TrafficWindow.WEEK,
        bucket=None,
        account=account,
        _={},
    )
    assert captured["uid"] == "rgw-account$traffic"
    assert payload["window"] == "week"
    assert payload["totals"]["ops"] == 0


def test_manager_stats_traffic_sanitizes_rgw_error_details(monkeypatch):
    account = S3Account(
        name="traffic-error-account",
        rgw_account_id="rgw-traffic-error",
        rgw_access_key="ak",
        rgw_secret_key="sk",
    )

    class _LeakyTrafficService:
        def __init__(self, target_account):
            pass

        def get_traffic(self, window, bucket=None):
            raise RGWAdminError(
                "RGW admin error 403 from https://rgw.internal.local/admin "
                "with token=secret-token and signature=abcdef"
            )

    monkeypatch.setattr(manager_stats_router, "TrafficService", _LeakyTrafficService)

    with pytest.raises(HTTPException) as exc:
        manager_stats_router.account_traffic(window=TrafficWindow.WEEK, bucket=None, account=account, _={})

    detail = str(exc.value.detail)
    assert exc.value.status_code == 502
    assert detail.startswith("Unable to fetch traffic logs:")
    assert "<redacted-url>" in detail
    assert "token=<redacted>" in detail
    assert "signature=<redacted>" in detail
    assert "rgw.internal.local" not in detail
    assert "secret-token" not in detail
    assert "abcdef" not in detail


def test_manager_stats_dependency_rejects_connection_without_resolved_identity(db_session, monkeypatch):
    user = User(
        email="manager-stats-conn-no-identity@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    endpoint = _ceph_endpoint("ceph-stats-identity-ko")
    connection = S3Connection(
        created_by=user,
        name="identity-ko-connection",
        access_manager=True,
        access_browser=True,
        storage_endpoint=endpoint,
        capabilities_json=json.dumps({"can_manage_iam": False}),
        access_key_id="AK-CONN-NOID",
        secret_access_key="SK-CONN-NOID",
    )
    db_session.add_all([user, endpoint, connection])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(connection)

    monkeypatch.setattr(
        "app.services.connection_identity_service.get_rgw_admin_client",
        lambda **kwargs: SimpleNamespace(get_user_by_access_key=lambda *args, **kw: None),
    )

    account = dependencies.get_account_context(
        request=_request("/api/manager/stats/overview"),
        account_ref=f"conn-{connection.id}",
        actor=user,
        db=db_session,
    )
    with pytest.raises(HTTPException) as exc:
        dependencies.require_usage_capable_manager(account=account, actor=user)
    assert exc.value.status_code == 403
    assert "unable to resolve rgw identity" in str(exc.value.detail).lower()


def test_manager_usage_trends_falls_back_per_metric(db_session, monkeypatch):
    monkeypatch.setattr(manager_stats_router, "load_app_settings", lambda: _usage_history_settings(True))
    monkeypatch.setattr(manager_stats_router, "utcnow", lambda: datetime(2026, 6, 9, 12, 0, 0))
    endpoint = _ceph_endpoint("ceph-usage-trends")
    account = S3Account(
        name="trend-account",
        rgw_account_id="trend-account",
        rgw_access_key="ak",
        rgw_secret_key="sk",
        storage_endpoint=endpoint,
    )
    db_session.add_all([endpoint, account])
    db_session.commit()
    db_session.refresh(account)

    db_session.add_all(
        [
            QuotaUsageDaily(
                day=date(2026, 5, 10),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                last_used_bytes=100,
                last_used_objects=10,
                bucket_count=None,
                updated_at=datetime(2026, 5, 10, 12, 0, 0),
            ),
            QuotaUsageDaily(
                day=date(2026, 6, 2),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                last_used_bytes=200,
                last_used_objects=20,
                bucket_count=2,
                updated_at=datetime(2026, 6, 2, 12, 0, 0),
            ),
            QuotaUsageDaily(
                day=date(2026, 6, 8),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                last_used_bytes=300,
                last_used_objects=30,
                bucket_count=3,
                updated_at=datetime(2026, 6, 8, 12, 0, 0),
            ),
        ]
    )
    db_session.commit()

    payload = manager_stats_router.account_usage_trends(account=account, _={}, db=db_session)

    assert payload.storage is not None
    assert payload.storage.window == "month"
    assert payload.storage.used_bytes == 100
    assert payload.objects is not None
    assert payload.objects.window == "month"
    assert payload.objects.used_objects == 10
    assert payload.buckets is not None
    assert payload.buckets.window == "week"
    assert payload.buckets.bucket_count == 2


def test_manager_usage_trends_returns_empty_when_history_disabled(db_session, monkeypatch):
    monkeypatch.setattr(manager_stats_router, "load_app_settings", lambda: _usage_history_settings(False))
    endpoint = _ceph_endpoint("ceph-usage-trends-disabled")
    account = S3Account(
        name="trend-disabled-account",
        rgw_account_id="trend-disabled-account",
        rgw_access_key="ak",
        rgw_secret_key="sk",
        storage_endpoint=endpoint,
    )
    db_session.add_all([endpoint, account])
    db_session.commit()

    payload = manager_stats_router.account_usage_trends(account=account, _={}, db=db_session)

    assert payload.model_dump(exclude_none=True) == {}


def test_manager_usage_trends_are_scoped_to_legacy_user_subject(db_session, monkeypatch):
    monkeypatch.setattr(manager_stats_router, "load_app_settings", lambda: _usage_history_settings(True))
    monkeypatch.setattr(manager_stats_router, "utcnow", lambda: datetime(2026, 6, 9, 12, 0, 0))
    endpoint = _ceph_endpoint("ceph-usage-trends-user")
    account = S3Account(
        name="account-subject",
        rgw_account_id="account-subject",
        rgw_access_key="ak",
        rgw_secret_key="sk",
        storage_endpoint=endpoint,
    )
    s3_user = S3User(
        name="legacy-subject",
        rgw_user_uid="legacy-subject",
        rgw_access_key="uak",
        rgw_secret_key="usk",
        storage_endpoint=endpoint,
    )
    db_session.add_all([endpoint, account, s3_user])
    db_session.commit()
    db_session.refresh(s3_user)

    db_session.add_all(
        [
            QuotaUsageDaily(
                day=date(2026, 5, 10),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                last_used_bytes=999,
                last_used_objects=99,
                bucket_count=9,
                updated_at=datetime(2026, 5, 10, 12, 0, 0),
            ),
            QuotaUsageDaily(
                day=date(2026, 5, 10),
                storage_endpoint_id=endpoint.id,
                s3_user_id=s3_user.id,
                last_used_bytes=111,
                last_used_objects=11,
                bucket_count=1,
                updated_at=datetime(2026, 5, 10, 12, 0, 0),
            ),
        ]
    )
    db_session.commit()

    legacy_context = S3Account(
        id=-(100000 + int(s3_user.id)),
        name=s3_user.name,
        rgw_user_uid=s3_user.rgw_user_uid,
        rgw_access_key=s3_user.rgw_access_key,
        rgw_secret_key=s3_user.rgw_secret_key,
        storage_endpoint_id=endpoint.id,
    )
    legacy_context.s3_user_id = s3_user.id

    payload = manager_stats_router.account_usage_trends(account=legacy_context, _={}, db=db_session)

    assert payload.storage is not None
    assert payload.storage.used_bytes == 111
    assert payload.objects is not None
    assert payload.objects.used_objects == 11
    assert payload.buckets is not None
    assert payload.buckets.bucket_count == 1


def test_manager_usage_trends_return_empty_for_connection_context(db_session, monkeypatch):
    monkeypatch.setattr(manager_stats_router, "load_app_settings", lambda: _usage_history_settings(True))
    account = S3Account(
        id=-1,
        name="connection-context",
        rgw_user_uid="resolved-user",
        storage_endpoint_id=1,
    )
    account.s3_connection_id = 1

    payload = manager_stats_router.account_usage_trends(account=account, _={}, db=db_session)

    assert payload.model_dump(exclude_none=True) == {}


def test_manager_usage_history_trends_are_scoped_to_account(db_session, monkeypatch):
    monkeypatch.setattr(manager_stats_router, "load_app_settings", lambda: _usage_history_settings(True))
    monkeypatch.setattr(usage_history_service, "utcnow", lambda: datetime(2026, 6, 9, 12, 0, 0))
    endpoint = _ceph_endpoint("ceph-history-trends-account")
    account = S3Account(
        name="history-account",
        rgw_account_id="history-account",
        rgw_access_key="ak",
        rgw_secret_key="sk",
        storage_endpoint=endpoint,
    )
    other_account = S3Account(
        name="other-history-account",
        rgw_account_id="other-history-account",
        rgw_access_key="bk",
        rgw_secret_key="bs",
        storage_endpoint=endpoint,
    )
    db_session.add_all([endpoint, account, other_account])
    db_session.commit()

    db_session.add_all(
        [
            QuotaUsageHourly(
                hour_ts=datetime(2026, 6, 9, 10, 0, 0),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                used_bytes=1024,
                used_objects=10,
                bucket_count=1,
                usage_ratio_pct=10.0,
                collected_at=datetime(2026, 6, 9, 10, 5, 0),
            ),
            QuotaUsageHourly(
                hour_ts=datetime(2026, 6, 9, 11, 0, 0),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                used_bytes=2048,
                used_objects=20,
                bucket_count=2,
                usage_ratio_pct=20.0,
                collected_at=datetime(2026, 6, 9, 11, 5, 0),
            ),
            QuotaUsageHourly(
                hour_ts=datetime(2026, 6, 9, 11, 0, 0),
                storage_endpoint_id=endpoint.id,
                s3_account_id=other_account.id,
                used_bytes=8192,
                used_objects=80,
                bucket_count=8,
                usage_ratio_pct=80.0,
                collected_at=datetime(2026, 6, 9, 11, 10, 0),
            ),
        ]
    )
    db_session.commit()

    payload = manager_stats_router.account_usage_history_trends(window="day", account=account, _={}, db=db_session)

    assert payload.available is True
    assert payload.granularity == "hourly"
    assert [point.used_bytes for point in payload.points] == [1024, 2048]
    assert payload.summary.subjects_count == 1
    assert payload.summary.latest_used_objects == 20
    assert payload.summary.max_usage_ratio_pct == 20.0


def test_manager_usage_history_trends_are_scoped_to_legacy_user_subject(db_session, monkeypatch):
    monkeypatch.setattr(manager_stats_router, "load_app_settings", lambda: _usage_history_settings(True))
    monkeypatch.setattr(usage_history_service, "utcnow", lambda: datetime(2026, 6, 9, 12, 0, 0))
    endpoint = _ceph_endpoint("ceph-history-trends-user")
    account = S3Account(
        name="account-subject",
        rgw_account_id="account-subject",
        rgw_access_key="ak",
        rgw_secret_key="sk",
        storage_endpoint=endpoint,
    )
    s3_user = S3User(
        name="legacy-subject",
        rgw_user_uid="legacy-subject",
        rgw_access_key="uak",
        rgw_secret_key="usk",
        storage_endpoint=endpoint,
    )
    db_session.add_all([endpoint, account, s3_user])
    db_session.commit()
    db_session.refresh(s3_user)

    db_session.add_all(
        [
            QuotaUsageDaily(
                day=date(2026, 6, 8),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                last_used_bytes=999,
                last_used_objects=99,
                bucket_count=9,
                max_ratio_pct=90.0,
                samples_count=1,
                updated_at=datetime(2026, 6, 8, 12, 0, 0),
            ),
            QuotaUsageDaily(
                day=date(2026, 6, 8),
                storage_endpoint_id=endpoint.id,
                s3_user_id=s3_user.id,
                last_used_bytes=111,
                last_used_objects=11,
                bucket_count=1,
                max_ratio_pct=11.0,
                samples_count=2,
                updated_at=datetime(2026, 6, 8, 12, 5, 0),
            ),
        ]
    )
    db_session.commit()

    legacy_context = S3Account(
        id=-(100000 + int(s3_user.id)),
        name=s3_user.name,
        rgw_user_uid=s3_user.rgw_user_uid,
        rgw_access_key=s3_user.rgw_access_key,
        rgw_secret_key=s3_user.rgw_secret_key,
        storage_endpoint_id=endpoint.id,
    )
    legacy_context.s3_user_id = s3_user.id

    payload = manager_stats_router.account_usage_history_trends(window="month", account=legacy_context, _={}, db=db_session)

    assert payload.available is True
    assert payload.granularity == "daily"
    assert len(payload.points) == 1
    assert payload.points[0].used_bytes == 111
    assert payload.points[0].used_objects == 11
    assert payload.points[0].samples_count == 2
    assert payload.summary.subjects_count == 1


def test_manager_usage_history_trends_return_unavailable_for_connection_context(db_session, monkeypatch):
    monkeypatch.setattr(manager_stats_router, "load_app_settings", lambda: _usage_history_settings(True))
    account = S3Account(
        id=-1,
        name="connection-context",
        rgw_user_uid="resolved-user",
        storage_endpoint_id=1,
    )
    account.s3_connection_id = 1

    payload = manager_stats_router.account_usage_history_trends(window="month", account=account, _={}, db=db_session)

    assert payload.available is False
    assert "private connection contexts" in (payload.unavailable_reason or "")
    assert payload.points == []
