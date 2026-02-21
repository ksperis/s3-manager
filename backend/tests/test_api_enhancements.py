# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi.testclient import TestClient

from app.db import S3Account
from app.main import app
from app.models.s3_account import S3Account as S3AccountSchema
from app.routers.admin import s3_accounts as admin_accounts_router
from app.routers.manager import buckets as manager_buckets_router


class _FakeAuditService:
    def record_action(self, **kwargs):  # noqa: ANN003
        return None


def test_admin_create_account_delegates_to_service(client: TestClient):
    captured: dict[str, object] = {}

    class FakeService:
        def create_account_with_manager(self, payload):  # noqa: ANN001
            captured["name"] = payload.name
            captured["email"] = payload.email
            captured["quota_max_size_gb"] = payload.quota_max_size_gb
            captured["quota_max_objects"] = payload.quota_max_objects
            return S3AccountSchema(
                id="101",
                db_id=101,
                name=payload.name,
                email=payload.email,
                rgw_account_id="RGW00000000000000101",
                rgw_user_uid="RGW00000000000000101-admin",
                root_user_email="RGW00000000000000101-admin",
                quota_max_size_gb=payload.quota_max_size_gb,
                quota_max_objects=payload.quota_max_objects,
                user_ids=[],
                user_links=[],
            )

    app.dependency_overrides[admin_accounts_router.get_admin_accounts_service] = lambda: FakeService()
    app.dependency_overrides[admin_accounts_router.get_audit_logger] = lambda: _FakeAuditService()

    response = client.post(
        "/api/admin/accounts",
        json={
            "name": "quota-acc",
            "email": "quota@example.com",
            "quota_max_size_gb": 500,
            "quota_max_objects": 1000000,
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == "quota-acc"
    assert body["quota_max_size_gb"] == 500
    assert body["quota_max_objects"] == 1000000
    assert captured == {
        "name": "quota-acc",
        "email": "quota@example.com",
        "quota_max_size_gb": 500,
        "quota_max_objects": 1000000,
    }


def test_admin_unlink_account_endpoint_calls_service(client: TestClient):
    called: dict[str, int] = {}

    class FakeService:
        def unlink_account(self, account_id: int) -> None:
            called["id"] = account_id

    app.dependency_overrides[admin_accounts_router.get_admin_accounts_service] = lambda: FakeService()
    app.dependency_overrides[admin_accounts_router.get_audit_logger] = lambda: _FakeAuditService()

    response = client.post("/api/admin/accounts/42/unlink")

    assert response.status_code == 204
    assert called["id"] == 42


def test_manager_create_bucket_passes_versioning_and_location(client: TestClient):
    captured: dict[str, object] = {}

    class FakeBucketService:
        def create_bucket(self, name, account, versioning=False, location_constraint=None):  # noqa: ANN001
            captured["name"] = name
            captured["account_id"] = account.id
            captured["versioning"] = versioning
            captured["location_constraint"] = location_constraint

    account = S3Account(
        name="acc",
        rgw_account_id="RGW00000000000000011",
        rgw_access_key="AK",
        rgw_secret_key="SK",
    )
    account.id = 11

    app.dependency_overrides[manager_buckets_router.get_account_context] = lambda: account
    app.dependency_overrides[manager_buckets_router.get_buckets_service] = lambda: FakeBucketService()
    app.dependency_overrides[manager_buckets_router.get_audit_logger] = lambda: _FakeAuditService()

    response = client.post(
        "/api/manager/buckets",
        json={
            "name": "demo-bucket",
            "versioning": True,
            "location_constraint": "eu-west-1",
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == "demo-bucket"
    assert body["versioning"] is True
    assert body["location_constraint"] == "eu-west-1"
    assert captured == {
        "name": "demo-bucket",
        "account_id": 11,
        "versioning": True,
        "location_constraint": "eu-west-1",
    }


def test_admin_create_user_requires_email_format(client: TestClient):
    response = client.post("/api/admin/users", json={"email": "not-an-email", "password": "x"})
    assert response.status_code == 422
