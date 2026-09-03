# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

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
                id=101,
                name=payload.name,
                email=payload.email,
                rgw_account_id="RGW00000000000000101",
                quota_max_size_gb=payload.quota_max_size_gb,
                quota_max_objects=payload.quota_max_objects,
                user_links=[],
                storage_endpoint_id=1,
                storage_endpoint_name="Ceph",
                storage_endpoint_url="https://s3.example.test",
                storage_endpoint_is_default=True,
                storage_endpoint_capabilities={"account": True},
            )

    app.dependency_overrides[admin_accounts_router.get_admin_accounts_service] = lambda: FakeService()
    app.dependency_overrides[admin_accounts_router.get_audit_service] = lambda: _FakeAuditService()

    response = client.post(
        "/api/admin/accounts",
        json={
            "name": "quota-acc",
            "email": "quota@example.com",
            "quota_max_size_gb": 500,
            "quota_max_objects": 1000000,
            "storage_endpoint_id": 1,
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == "quota-acc"
    assert body["quota_max_size_gb"] == 500
    assert body["quota_max_objects"] == 1000000
    assert body["storage_endpoint_id"] == 1
    assert body["storage_endpoint_name"] == "Ceph"
    assert body["storage_endpoint_is_default"] is True
    assert captured == {
        "name": "quota-acc",
        "email": "quota@example.com",
        "quota_max_size_gb": 500,
        "quota_max_objects": 1000000,
    }


def test_admin_account_response_model_rejects_obsolete_fields():
    with pytest.raises(ValidationError, match="root_user_email"):
        S3AccountSchema(
            id=101,
            name="strict-account",
            rgw_account_id="RGW-STRICT",
            root_user_email="obsolete@example.test",
            storage_endpoint_id=1,
            storage_endpoint_name="Ceph",
            storage_endpoint_url="https://s3.example.test",
            storage_endpoint_is_default=True,
            storage_endpoint_capabilities={"account": True},
        )


def test_admin_account_mutations_require_a_canonical_endpoint(client: TestClient):
    create_response = client.post(
        "/api/admin/accounts",
        json={"name": "missing-endpoint"},
    )
    import_response = client.post(
        "/api/admin/accounts/import",
        json=[{"rgw_account_id": "RGW00000000000000101"}],
    )
    invalid_import_id_response = client.post(
        "/api/admin/accounts/import",
        json=[{"rgw_account_id": "RGW123", "storage_endpoint_id": 1}],
    )
    update_response = client.put(
        "/api/admin/accounts/1",
        json={"storage_endpoint_id": None},
    )
    removed_create_fields_response = client.post(
        "/api/admin/accounts",
        json={
            "name": "legacy-endpoint-fields",
            "storage_endpoint_id": 1,
            "storage_endpoint_name": "removed",
            "storage_endpoint_url": "https://removed.example.test",
        },
    )

    assert create_response.status_code == 422
    assert import_response.status_code == 422
    assert invalid_import_id_response.status_code == 422
    assert "RGW followed by 17 digits" in invalid_import_id_response.text
    assert update_response.status_code == 422
    assert removed_create_fields_response.status_code == 422



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
    app.dependency_overrides[manager_buckets_router.get_audit_service] = lambda: _FakeAuditService()

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


def test_manager_get_bucket_versioning_returns_status(client: TestClient):
    captured: dict[str, object] = {}

    class FakeBucketService:
        def get_bucket_versioning_status(self, name, account):  # noqa: ANN001
            captured["name"] = name
            captured["account_id"] = account.id
            return "Enabled"

    account = S3Account(
        name="acc",
        rgw_account_id="RGW00000000000000012",
        rgw_access_key="AK",
        rgw_secret_key="SK",
    )
    account.id = 12

    app.dependency_overrides[manager_buckets_router.get_account_context] = lambda: account
    app.dependency_overrides[manager_buckets_router.get_bucket_configuration_service] = lambda: FakeBucketService()

    response = client.get("/api/manager/buckets/demo-bucket/versioning")

    assert response.status_code == 200, response.text
    assert response.json() == {"status": "Enabled", "enabled": True}
    assert captured == {"name": "demo-bucket", "account_id": 12}


def test_admin_create_user_requires_email_format(client: TestClient):
    response = client.post("/api/admin/users", json={"email": "not-an-email", "password": "x"})
    assert response.status_code == 422
