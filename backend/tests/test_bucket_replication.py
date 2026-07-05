# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.db import S3Account, StorageEndpoint
from app.main import app
from app.models.bucket import BucketReplicationConfiguration
from app.routers.ceph_admin import buckets as ceph_admin_buckets_router
from app.routers.manager import buckets as manager_buckets_router
from app.services.buckets_service import BucketsService


class _FakeAuditService:
    def record_action(self, **kwargs):  # noqa: ANN003
        return None


def _build_endpoint(endpoint_id: int = 1, *, replication_enabled: bool = True) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="endpoint",
        endpoint_url="https://ceph.example.test",
        provider="ceph",
        features_config=(
            "features:\n"
            "  replication:\n"
            f"    enabled: {'true' if replication_enabled else 'false'}\n"
            "    endpoint: https://replication.example.test\n"
        ),
    )
    endpoint.id = endpoint_id
    return endpoint


def _build_account(*, replication_enabled: bool = True) -> S3Account:
    account = S3Account(
        name="acc",
        rgw_account_id="RGW00000000000000011",
        rgw_access_key="AK",
        rgw_secret_key="SK",
    )
    account.id = 11
    account.storage_endpoint = _build_endpoint(replication_enabled=replication_enabled)
    return account


def test_manager_put_bucket_replication_returns_200(client: TestClient):
    captured: dict[str, object] = {}

    class FakeService:
        def set_bucket_replication(self, name: str, account: S3Account, payload: BucketReplicationConfiguration):
            captured["name"] = name
            captured["account_id"] = account.id
            captured["configuration"] = payload.configuration
            return BucketReplicationConfiguration(configuration=payload.configuration)

    app.dependency_overrides[manager_buckets_router.get_account_context] = _build_account
    app.dependency_overrides[manager_buckets_router.get_buckets_service] = lambda: FakeService()
    app.dependency_overrides[manager_buckets_router.get_audit_logger] = lambda: _FakeAuditService()

    payload = {
        "configuration": {
            "Role": "arn:aws:iam::123456789012:role/replication",
            "Rules": [
                {
                    "ID": "rule-1",
                    "Status": "Enabled",
                    "Priority": 1,
                    "Filter": {"Prefix": "logs/"},
                    "Destination": {"Bucket": "arn:aws:s3:::target-bucket"},
                    "DeleteMarkerReplication": {"Status": "Disabled"},
                }
            ],
        }
    }
    response = client.put("/api/manager/buckets/demo-bucket/replication", json=payload)

    assert response.status_code == 200, response.text
    assert response.json() == payload
    assert captured == {
        "name": "demo-bucket",
        "account_id": 11,
        "configuration": payload["configuration"],
    }


def test_manager_put_bucket_replication_rejects_zone(client: TestClient):
    class FakeService:
        def set_bucket_replication(self, name: str, account: S3Account, payload: BucketReplicationConfiguration):
            raise ValueError("Destination.Zone is not supported in V1.")

    app.dependency_overrides[manager_buckets_router.get_account_context] = _build_account
    app.dependency_overrides[manager_buckets_router.get_buckets_service] = lambda: FakeService()
    app.dependency_overrides[manager_buckets_router.get_audit_logger] = lambda: _FakeAuditService()

    payload = {
        "configuration": {
            "Role": "arn:aws:iam::123456789012:role/replication",
            "Rules": [
                {
                    "Status": "Enabled",
                    "Destination": {
                        "Bucket": "arn:aws:s3:::target-bucket",
                        "Zone": "us-east-1a",
                    },
                }
            ],
        }
    }
    response = client.put("/api/manager/buckets/demo-bucket/replication", json=payload)

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Destination.Zone is not supported in V1."


def test_manager_put_bucket_replication_requires_endpoint_feature(client: TestClient):
    class FakeService:
        def set_bucket_replication(self, name: str, account: S3Account, payload: BucketReplicationConfiguration):
            raise AssertionError("service should not be called")

    app.dependency_overrides[manager_buckets_router.get_account_context] = lambda: _build_account(replication_enabled=False)
    app.dependency_overrides[manager_buckets_router.get_buckets_service] = lambda: FakeService()
    app.dependency_overrides[manager_buckets_router.get_audit_logger] = lambda: _FakeAuditService()

    payload = {
        "configuration": {
            "Role": "arn:aws:iam::123456789012:role/replication",
            "Rules": [{"Status": "Enabled", "Destination": {"Bucket": "arn:aws:s3:::target-bucket"}}],
        }
    }
    response = client.put("/api/manager/buckets/demo-bucket/replication", json=payload)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "Bucket replication is disabled for this endpoint"


def test_manager_delete_bucket_replication_returns_204(client: TestClient):
    captured: dict[str, object] = {}

    class FakeService:
        def delete_bucket_replication(self, name: str, account: S3Account) -> None:
            captured["name"] = name
            captured["account_id"] = account.id

    app.dependency_overrides[manager_buckets_router.get_account_context] = _build_account
    app.dependency_overrides[manager_buckets_router.get_buckets_service] = lambda: FakeService()
    app.dependency_overrides[manager_buckets_router.get_audit_logger] = lambda: _FakeAuditService()

    response = client.delete("/api/manager/buckets/demo-bucket/replication")

    assert response.status_code == 204, response.text
    assert captured == {"name": "demo-bucket", "account_id": 11}


def test_buckets_service_set_bucket_replication_rejects_destination_zone():
    service = BucketsService()
    payload = BucketReplicationConfiguration(
        configuration={
            "Role": "arn:aws:iam::123456789012:role/replication",
            "Rules": [
                {
                    "Status": "Enabled",
                    "Destination": {
                        "Bucket": "arn:aws:s3:::target-bucket",
                        "Zone": "us-east-1a",
                    },
                }
            ],
        }
    )

    with pytest.raises(ValueError, match="Destination.Zone is not supported in V1."):
        service.set_bucket_replication("demo-bucket", _build_account(), payload)


def test_buckets_service_account_admin_replication_uses_stored_account_credentials(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, object] = {}

    def fake_put_bucket_replication(name: str, **kwargs):  # noqa: ANN003
        captured["put"] = {"name": name, **kwargs}

    monkeypatch.setattr("app.services.buckets_service.s3_client.put_bucket_replication", fake_put_bucket_replication)

    service = BucketsService()
    account = _build_account()
    account.set_session_credentials("PORTAL-AK", "PORTAL-SK")
    account._session_token = "PORTAL-TOKEN"  # type: ignore[attr-defined]
    payload = BucketReplicationConfiguration(
        configuration={
            "Role": "arn:aws:iam::123456789012:role/replication",
            "Rules": [{"Status": "Enabled", "Destination": {"Bucket": "arn:aws:s3:::target-bucket"}}],
        }
    )
    result = service.set_bucket_replication_as_account_admin("demo-bucket", account, payload)

    assert result.configuration == payload.configuration
    assert captured["put"]["access_key"] == "AK"
    assert captured["put"]["secret_key"] == "SK"
    assert captured["put"]["configuration"] == payload.configuration
    assert captured["put"]["endpoint"] == "https://replication.example.test"
    assert captured["put"]["session_token"] is None


def test_ceph_admin_put_bucket_replication_invalidates_listing_cache(monkeypatch: pytest.MonkeyPatch):
    invalidated: list[int] = []

    monkeypatch.setattr(
        ceph_admin_buckets_router,
        "_invalidate_bucket_listing_cache",
        lambda endpoint_id: invalidated.append(endpoint_id),
    )

    def fake_set_bucket_replication(self, name: str, account: S3Account, payload: BucketReplicationConfiguration):
        assert name == "demo-bucket"
        return BucketReplicationConfiguration(configuration=payload.configuration)

    monkeypatch.setattr(BucketsService, "set_bucket_replication", fake_set_bucket_replication)

    ctx = SimpleNamespace(endpoint=_build_endpoint(endpoint_id=99), access_key="AK", secret_key="SK")
    payload = BucketReplicationConfiguration(
        configuration={
            "Role": "arn:aws:iam::123456789012:role/replication",
            "Rules": [{"Status": "Enabled", "Destination": {"Bucket": "arn:aws:s3:::target-bucket"}}],
        }
    )

    result = ceph_admin_buckets_router.put_replication("demo-bucket", payload, ctx=ctx)

    assert result.configuration == payload.configuration
    assert invalidated == [99]


def test_ceph_admin_put_bucket_replication_requires_endpoint_feature(monkeypatch: pytest.MonkeyPatch):
    calls = {"count": 0}

    def fake_set_bucket_replication(self, name: str, account: S3Account, payload: BucketReplicationConfiguration):
        calls["count"] += 1
        return BucketReplicationConfiguration(configuration=payload.configuration)

    monkeypatch.setattr(BucketsService, "set_bucket_replication", fake_set_bucket_replication)

    ctx = SimpleNamespace(
        endpoint=_build_endpoint(endpoint_id=99, replication_enabled=False),
        access_key="AK",
        secret_key="SK",
    )
    payload = BucketReplicationConfiguration(
        configuration={
            "Role": "arn:aws:iam::123456789012:role/replication",
            "Rules": [{"Status": "Enabled", "Destination": {"Bucket": "arn:aws:s3:::target-bucket"}}],
        }
    )

    with pytest.raises(HTTPException) as exc:
        ceph_admin_buckets_router.put_replication("demo-bucket", payload, ctx=ctx)

    assert exc.value.status_code == 403
    assert exc.value.detail == "Bucket replication is disabled for this endpoint"
    assert calls["count"] == 0


def test_ceph_admin_delete_bucket_replication_invalidates_listing_cache(monkeypatch: pytest.MonkeyPatch):
    invalidated: list[int] = []
    deleted: dict[str, str] = {}

    monkeypatch.setattr(
        ceph_admin_buckets_router,
        "_invalidate_bucket_listing_cache",
        lambda endpoint_id: invalidated.append(endpoint_id),
    )

    def fake_delete_bucket_replication(self, name: str, account: S3Account) -> None:
        deleted["name"] = name

    monkeypatch.setattr(BucketsService, "delete_bucket_replication", fake_delete_bucket_replication)

    ctx = SimpleNamespace(endpoint=_build_endpoint(endpoint_id=100), access_key="AK", secret_key="SK")
    response = ceph_admin_buckets_router.delete_replication("demo-bucket", ctx=ctx)

    assert response.status_code == 204
    assert deleted == {"name": "demo-bucket"}
    assert invalidated == [100]
