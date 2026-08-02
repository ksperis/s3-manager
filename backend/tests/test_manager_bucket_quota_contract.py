# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import S3Account, StorageEndpoint, User, UserRole
from app.main import app
from app.routers import dependencies
from app.routers.manager import buckets as manager_buckets_router


def _quota_user(*, allowed: bool) -> User:
    return User(
        id=1201 if allowed else 1200,
        email="quota-user@example.com",
        full_name="Quota User",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
        can_access_manager_bucket_quota=allowed,
    )


def _quota_account(*, allow_target: bool = True) -> S3Account:
    endpoint = StorageEndpoint(
        id=22,
        name="Ceph quota endpoint",
        endpoint_url="https://s3.example.test",
        admin_endpoint="https://admin.example.test",
        provider="ceph",
        admin_access_key="endpoint-admin-ak",
        admin_secret_key="endpoint-admin-sk",
        features_config='{"admin":{"enabled":true,"endpoint":"https://admin.example.test"}}',
    )
    account = S3Account(
        id=33,
        name="quota-account",
        rgw_account_id="RGW00000000000000033",
        rgw_access_key="account-ak",
        rgw_secret_key="account-sk",
        allow_manager_bucket_quota=allow_target,
    )
    account.storage_endpoint = endpoint
    return account


class _FakeAuditService:
    def record_action(self, **kwargs):  # noqa: ANN003
        self.last_action = kwargs


def test_manager_bucket_quota_update_requires_privileged_access(client, db_session):
    user = _quota_user(allowed=False)
    account = _quota_account()
    app.dependency_overrides[dependencies.get_current_user] = lambda: user
    app.dependency_overrides[dependencies.get_current_actor] = lambda: user
    app.dependency_overrides[dependencies.get_account_context] = lambda: account
    try:
        response = client.put(
            "/api/manager/buckets/demo-bucket/quota",
            params={"account_id": account.id},
            json={"max_size_gb": 1, "max_objects": 1000},
        )
    finally:
        app.dependency_overrides.pop(dependencies.get_current_user, None)
        app.dependency_overrides.pop(dependencies.get_current_actor, None)
        app.dependency_overrides.pop(dependencies.get_account_context, None)

    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized"


def test_manager_bucket_quota_update_requires_target_grant(client, db_session):
    user = _quota_user(allowed=True)
    account = _quota_account(allow_target=False)
    app.dependency_overrides[dependencies.get_current_user] = lambda: user
    app.dependency_overrides[dependencies.get_current_actor] = lambda: user
    app.dependency_overrides[dependencies.get_account_context] = lambda: account
    try:
        response = client.put(
            "/api/manager/buckets/demo-bucket/quota",
            params={"account_id": account.id},
            json={"max_size_gb": 1, "max_objects": 1000},
        )
    finally:
        app.dependency_overrides.pop(dependencies.get_current_user, None)
        app.dependency_overrides.pop(dependencies.get_current_actor, None)
        app.dependency_overrides.pop(dependencies.get_account_context, None)

    assert response.status_code == 403
    assert response.json()["detail"] == "Bucket quota management is not available for this context"


def test_manager_bucket_quota_update_succeeds_with_privileged_access(client, db_session):
    user = _quota_user(allowed=True)
    account = _quota_account()
    captured: dict[str, object] = {}

    class FakeBucketsService:
        def set_bucket_quota(self, name, account_arg, payload):  # noqa: ANN001
            captured["bucket"] = name
            captured["account"] = account_arg
            captured["payload"] = payload
            return {"updated": True, "bucket": name}

    app.dependency_overrides[dependencies.get_current_user] = lambda: user
    app.dependency_overrides[dependencies.get_current_actor] = lambda: user
    app.dependency_overrides[dependencies.get_account_context] = lambda: account
    app.dependency_overrides[manager_buckets_router.get_buckets_service] = lambda: FakeBucketsService()
    app.dependency_overrides[manager_buckets_router.get_audit_service] = lambda: _FakeAuditService()
    try:
        response = client.put(
            "/api/manager/buckets/demo-bucket/quota",
            params={"account_id": account.id},
            json={"max_size_gb": 2, "max_size_unit": "GiB", "max_objects": 2000},
        )
    finally:
        app.dependency_overrides.pop(dependencies.get_current_user, None)
        app.dependency_overrides.pop(dependencies.get_current_actor, None)
        app.dependency_overrides.pop(dependencies.get_account_context, None)
        app.dependency_overrides.pop(manager_buckets_router.get_buckets_service, None)
        app.dependency_overrides.pop(manager_buckets_router.get_audit_service, None)

    assert response.status_code == 200, response.text
    assert response.json() == {"message": "Bucket quota updated"}
    assert captured["bucket"] == "demo-bucket"
    assert captured["account"] is account
    assert captured["payload"].max_size_gb == 2
