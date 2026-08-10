# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import AccountRole, S3Account, S3Connection, StorageEndpoint, User, UserRole, UserS3Account
from app.main import app
from app.routers import dependencies
from app.routers.manager import buckets as manager_buckets_router
from app.services.s3_execution_context import S3ExecutionContext


def _quota_user(db_session) -> User:
    user = User(
        email="quota-user@example.com",
        full_name="Quota User",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _quota_account(db_session, *, allow_target: bool = True) -> S3Account:
    endpoint = StorageEndpoint(
        name="Ceph quota endpoint",
        endpoint_url="https://s3.example.test",
        admin_endpoint="https://admin.example.test",
        provider="ceph",
        admin_access_key="endpoint-admin-ak",
        admin_secret_key="endpoint-admin-sk",
        features_config='{"admin":{"enabled":true,"endpoint":"https://admin.example.test"}}',
    )
    account = S3Account(
        name="quota-account",
        rgw_account_id="RGW00000000000000033",
        rgw_access_key="account-ak",
        rgw_secret_key="account-sk",
        allow_bucket_quota_management=allow_target,
    )
    account.storage_endpoint = endpoint
    db_session.add_all([endpoint, account])
    db_session.commit()
    db_session.refresh(account)
    return account


def _grant_manager_access(db_session, user: User, account: S3Account) -> None:
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            role=AccountRole.ACCOUNT_ADMINISTRATOR.value,
        )
    )
    db_session.commit()


class _FakeAuditService:
    def record_action(self, **kwargs):  # noqa: ANN003
        self.last_action = kwargs


def test_manager_bucket_quota_update_requires_effective_manager_access(client, db_session):
    user = _quota_user(db_session)
    account = _quota_account(db_session)
    app.dependency_overrides[dependencies.get_current_user] = lambda: user
    app.dependency_overrides[dependencies.get_current_actor] = lambda: user
    try:
        response = client.put(
            "/api/manager/buckets/demo-bucket/quota",
            params={"account_id": account.id},
            json={"max_size_gb": 1, "max_objects": 1000},
        )
    finally:
        app.dependency_overrides.pop(dependencies.get_current_user, None)
        app.dependency_overrides.pop(dependencies.get_current_actor, None)

    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized for this account"


def test_manager_bucket_quota_update_requires_target_grant(client, db_session):
    user = _quota_user(db_session)
    account = _quota_account(db_session, allow_target=False)
    _grant_manager_access(db_session, user, account)
    app.dependency_overrides[dependencies.get_current_user] = lambda: user
    app.dependency_overrides[dependencies.get_current_actor] = lambda: user
    try:
        response = client.put(
            "/api/manager/buckets/demo-bucket/quota",
            params={"account_id": account.id},
            json={"max_size_gb": 1, "max_objects": 1000},
        )
    finally:
        app.dependency_overrides.pop(dependencies.get_current_user, None)
        app.dependency_overrides.pop(dependencies.get_current_actor, None)

    assert response.status_code == 403
    assert response.json()["detail"] == "Bucket quota management is not enabled for this resource"


def test_manager_bucket_quota_update_succeeds_with_privileged_access(client, db_session):
    user = _quota_user(db_session)
    account = _quota_account(db_session)
    _grant_manager_access(db_session, user, account)
    captured: dict[str, object] = {}

    class FakeBucketsService:
        def set_bucket_quota(self, name, account_arg, payload):  # noqa: ANN001
            captured["bucket"] = name
            captured["account"] = account_arg
            captured["payload"] = payload
            return {"updated": True, "bucket": name}

    app.dependency_overrides[dependencies.get_current_user] = lambda: user
    app.dependency_overrides[dependencies.get_current_actor] = lambda: user
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
        app.dependency_overrides.pop(manager_buckets_router.get_buckets_service, None)
        app.dependency_overrides.pop(manager_buckets_router.get_audit_service, None)

    assert response.status_code == 200, response.text
    assert response.json() == {"message": "Bucket quota updated"}
    assert captured["bucket"] == "demo-bucket"
    assert captured["account"].id == account.id
    assert captured["payload"].max_size_gb == 2


def test_browser_bucket_quota_forgery_is_always_forbidden(client, db_session):
    user = _quota_user(db_session)
    app.dependency_overrides[dependencies.require_portal_browser_basic_route] = lambda: None
    app.dependency_overrides[dependencies.get_current_actor] = lambda: user
    try:
        response = client.put(
            "/api/browser/buckets/config/demo-bucket/quota",
            json={"max_size_gb": 1},
        )
    finally:
        app.dependency_overrides.pop(dependencies.require_portal_browser_basic_route, None)
        app.dependency_overrides.pop(dependencies.get_current_actor, None)

    assert response.status_code == 403
    assert response.json()["detail"] == "Bucket quota management is only available in Manager"


def test_embedded_browser_private_connection_cannot_forge_manager_quota_update(client, db_session):
    user = _quota_user(db_session)
    ceph_calls: list[str] = []

    def fail_if_ceph_service_is_resolved():
        ceph_calls.append("resolved")
        raise AssertionError("Ceph service must not be resolved for an ineligible Browser context")

    connection = S3Connection(
        id=44,
        name="private-browser",
        access_key_id="AK",
        secret_access_key="SK",
        is_shared=False,
        access_browser=True,
        custom_endpoint_config=(
            '{"endpoint_url":"https://private.example.test",'
            '"force_path_style":true,"provider":null,"region":null,"verify_tls":true}'
        ),
    )
    context = S3ExecutionContext.from_connection(connection)
    app.dependency_overrides[dependencies.get_current_user] = lambda: user
    app.dependency_overrides[dependencies.get_current_actor] = lambda: user
    app.dependency_overrides[dependencies.get_account_context] = lambda: context
    app.dependency_overrides[manager_buckets_router.get_buckets_service] = fail_if_ceph_service_is_resolved
    try:
        response = client.put(
            "/api/manager/buckets/demo-bucket/quota",
            params={"account_id": "conn-44"},
            json={"max_size_gb": 1},
        )
    finally:
        app.dependency_overrides.pop(dependencies.get_current_user, None)
        app.dependency_overrides.pop(dependencies.get_current_actor, None)
        app.dependency_overrides.pop(dependencies.get_account_context, None)
        app.dependency_overrides.pop(manager_buckets_router.get_buckets_service, None)

    assert response.status_code == 403
    assert response.json()["detail"] == "Bucket quota management is not available for this context"
    assert ceph_calls == []
