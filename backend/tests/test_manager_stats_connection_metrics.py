# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import S3Connection, StorageEndpoint, User, UserRole
from app.routers import dependencies
from app.routers.manager import stats as manager_stats_router
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


def test_manager_stats_overview_allows_connection_with_resolved_identity(db_session):
    user = User(
        email="manager-stats-conn@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    endpoint = _ceph_endpoint("ceph-stats-overview")
    connection = S3Connection(
        owner_user_id=None,
        is_public=True,
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


def test_manager_stats_traffic_allows_connection_with_resolved_identity(db_session, monkeypatch):
    user = User(
        email="manager-stats-conn-traffic@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    endpoint = _ceph_endpoint("ceph-stats-traffic")
    connection = S3Connection(
        owner_user_id=None,
        is_public=True,
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


def test_manager_stats_dependency_rejects_connection_without_resolved_identity(db_session, monkeypatch):
    user = User(
        email="manager-stats-conn-no-identity@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    endpoint = _ceph_endpoint("ceph-stats-identity-ko")
    connection = S3Connection(
        owner_user_id=None,
        is_public=True,
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
