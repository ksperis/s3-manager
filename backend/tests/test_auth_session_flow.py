# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from botocore.exceptions import ClientError

from app.core.security import get_password_hash
from app.db import AuditLog, S3Account, UserS3Account, User, UserRole
from app.main import app
from app.routers import dependencies
from app.routers import auth as auth_router
from app.services import session_service as session_module


def _enable_access_key_login(
    monkeypatch,
    *,
    allow_endpoint_list: bool = False,
    allow_custom_endpoint: bool = True,
) -> None:
    general = SimpleNamespace(
        allow_login_access_keys=True,
        allow_login_endpoint_list=allow_endpoint_list,
        allow_login_custom_endpoint=allow_custom_endpoint,
    )
    monkeypatch.setattr(
        "app.routers.auth.load_app_settings",
        lambda: SimpleNamespace(general=general),
    )


def _mock_external(monkeypatch, *, iam_allowed: bool) -> None:
    class FakeS3Client:
        def list_buckets(self):
            return {
                "Owner": {
                    "ID": "RGW00000000000000001",
                    "DisplayName": "tenant-alpha",
                }
            }

    def fake_s3_client(*args, **kwargs):
        return FakeS3Client()

    class FakeRGWAdmin:
        def __init__(self, *args, **kwargs):
            pass

        def get_user_by_access_key(self, *args, **kwargs):
            return {
                "account_id": "RGW00000000000000001",
                "display_name": "iam-user",
                "account_root": False,
            }

    class FakeIAMClient:
        def list_users(self, **kwargs):
            if iam_allowed:
                return {"Users": [{"UserName": "demo"}]}
            raise ClientError(
                {
                    "Error": {
                        "Code": "AccessDenied",
                        "Message": "not allowed",
                    }
                },
                "ListUsers",
            )

    monkeypatch.setattr(session_module.s3_client, "get_s3_client", fake_s3_client)
    monkeypatch.setattr(session_module, "RGWAdminClient", FakeRGWAdmin)
    monkeypatch.setattr(session_module, "get_iam_client", lambda *args, **kwargs: FakeIAMClient())


def test_login_s3_grants_iam_capability_when_iam_client_succeeds(monkeypatch, client, db_session):
    _enable_access_key_login(monkeypatch)
    _mock_external(monkeypatch, iam_allowed=True)
    monkeypatch.setattr(auth_router, "validate_custom_login_s3_endpoint", lambda value: value.rstrip("/"))

    response = client.post(
        "/api/auth/login-s3",
        json={"access_key": "AKIA", "secret_key": "SECRET", "endpoint_url": "https://s3.example.test"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["session"]["capabilities"]["can_manage_iam"] is True
    assert payload["session"]["capabilities"]["access_browser"] is True
    assert payload["session"]["account_id"] == "RGW00000000000000001"
    assert payload["session"]["account_name"] == "tenant-alpha"
    assert db_session.query(S3Account).filter(S3Account.rgw_account_id == "RGW00000000000000001").first() is None


def test_login_s3_disables_iam_capability_when_iam_client_denied(monkeypatch, client, db_session):
    _enable_access_key_login(monkeypatch)
    _mock_external(monkeypatch, iam_allowed=False)
    monkeypatch.setattr(auth_router, "validate_custom_login_s3_endpoint", lambda value: value.rstrip("/"))

    response = client.post(
        "/api/auth/login-s3",
        json={"access_key": "AKIA", "secret_key": "SECRET", "endpoint_url": "https://s3.example.test"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["session"]["capabilities"]["can_manage_iam"] is False
    assert payload["session"]["capabilities"]["access_browser"] is True
    assert db_session.query(S3Account).filter(S3Account.rgw_account_id == "RGW00000000000000001").first() is None


@pytest.mark.parametrize(
    "endpoint_url",
    [
        "ftp://s3.example.test",
        "http://localhost:9000",
        "https://user:pass@s3.example.test",
        "https://s3.example.test?foo=1",
        "https://s3.example.test#fragment",
    ],
)
def test_login_s3_rejects_invalid_custom_endpoint(monkeypatch, client, endpoint_url):
    _enable_access_key_login(monkeypatch, allow_custom_endpoint=True)

    response = client.post(
        "/api/auth/login-s3",
        json={"access_key": "AKIA", "secret_key": "SECRET", "endpoint_url": endpoint_url},
    )

    assert response.status_code == 400
    assert "Custom endpoint URL" in response.json()["detail"]


def test_login_s3_records_custom_endpoint_audit_event(monkeypatch, client, db_session):
    _enable_access_key_login(monkeypatch, allow_custom_endpoint=True)
    _mock_external(monkeypatch, iam_allowed=True)
    monkeypatch.setattr(auth_router, "validate_custom_login_s3_endpoint", lambda value: value.rstrip("/"))

    response = client.post(
        "/api/auth/login-s3",
        json={"access_key": "AKIA", "secret_key": "SECRET", "endpoint_url": "https://s3.example.test/"},
        headers={"X-Forwarded-For": "198.51.100.20", "User-Agent": "pytest-agent"},
    )
    assert response.status_code == 200, response.text

    event = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "login_s3_custom_endpoint")
        .order_by(AuditLog.id.desc())
        .first()
    )
    assert event is not None
    assert event.ip_address == "198.51.100.20"
    assert event.user_agent == "pytest-agent"
    assert "https://s3.example.test" in (event.metadata_json or "")


def _setup_account(db_session) -> S3Account:
    manager = db_session.query(User).filter(User.id == 1000).first()
    if not manager:
        manager = User(
            id=1000,
            email="manager@example.com",
            full_name="Manager",
            hashed_password="x",
            is_active=True,
            role=UserRole.UI_USER.value,
        )
        db_session.add(manager)
        db_session.commit()

    account = (
        db_session.query(S3Account)
        .filter(S3Account.rgw_account_id == "RGW00000000000000001")
        .first()
    )
    if not account:
        account = S3Account(
            name="tenant-alpha",
            rgw_account_id="RGW00000000000000001",
            rgw_access_key="AKIA",
            rgw_secret_key="SECRET",
        )
        db_session.add(account)
        db_session.commit()
    else:
        account.rgw_access_key = account.rgw_access_key or "AKIA"
        account.rgw_secret_key = account.rgw_secret_key or "SECRET"
        db_session.add(account)
        db_session.commit()
    link = (
        db_session.query(UserS3Account)
        .filter(UserS3Account.user_id == manager.id, UserS3Account.account_id == account.id)
        .first()
    )
    if not link:
        db_session.add(UserS3Account(user_id=manager.id, account_id=account.id, is_root=True))
        db_session.commit()
    return account


def test_ui_login_updates_last_login_timestamp(client, db_session):
    password = "supersecret123"
    user = User(
        email="ui-admin@example.com",
        full_name="UI Admin",
        hashed_password=get_password_hash(password),
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    db_session.add(user)
    db_session.commit()

    response = client.post(
        "/api/auth/login",
        data={"username": user.email, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["user"]["last_login_at"] is not None
    db_session.refresh(user)
    assert user.last_login_at is not None


def test_login_rate_limit_returns_429_after_max_failed_attempts(monkeypatch, client, db_session):
    user = User(
        email="ratelimit@example.com",
        full_name="Rate Limited",
        hashed_password=get_password_hash("valid-password-123"),
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    db_session.add(user)
    db_session.commit()

    monkeypatch.setattr(auth_router.settings, "login_rate_limit_max_attempts", 2)
    monkeypatch.setattr(auth_router.settings, "login_rate_limit_window_seconds", 3600)

    common_headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Forwarded-For": "198.51.100.25",
        "User-Agent": "pytest-rate-limit",
    }

    first = client.post(
        "/api/auth/login",
        data={"username": user.email, "password": "wrong-password"},
        headers=common_headers,
    )
    second = client.post(
        "/api/auth/login",
        data={"username": user.email, "password": "wrong-password"},
        headers=common_headers,
    )
    third = client.post(
        "/api/auth/login",
        data={"username": user.email, "password": "wrong-password"},
        headers=common_headers,
    )
    assert first.status_code == 401
    assert second.status_code == 401
    assert third.status_code == 429

    event = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "login_rate_limited")
        .order_by(AuditLog.id.desc())
        .first()
    )
    assert event is not None
    assert event.ip_address == "198.51.100.25"
    assert event.user_agent == "pytest-rate-limit"


def test_iam_overview_success(monkeypatch, client, db_session):
    account = _setup_account(db_session)

    class FakeService:
        def __init__(self, *args, **kwargs):
            pass

        def list_users(self):
            return [{"name": "a"}, {"name": "b"}]

        def list_groups(self):
            return [{"name": "grp"}]

        def list_roles(self):
            return []

        def list_policies(self):
            return []

    monkeypatch.setattr("app.routers.manager.iam_overview.get_iam_service", lambda *args, **kwargs: FakeService())
    previous_account_context = app.dependency_overrides.get(dependencies.get_account_context)
    previous_iam_guard = app.dependency_overrides.get(dependencies.require_iam_capable_manager)
    app.dependency_overrides[dependencies.get_account_context] = lambda: account
    app.dependency_overrides[dependencies.require_iam_capable_manager] = lambda: {"ok": True}
    try:
        resp = client.get(f"/api/manager/iam/overview?account_id={account.id}")
    finally:
        if previous_account_context is not None:
            app.dependency_overrides[dependencies.get_account_context] = previous_account_context
        else:
            app.dependency_overrides.pop(dependencies.get_account_context, None)
        if previous_iam_guard is not None:
            app.dependency_overrides[dependencies.require_iam_capable_manager] = previous_iam_guard
        else:
            app.dependency_overrides.pop(dependencies.require_iam_capable_manager, None)
    assert resp.status_code == 200
    data = resp.json()
    assert data["iam_users"] == 2
    assert data["iam_groups"] == 1
    assert data["iam_roles"] == 0
    assert data["warnings"] == []


def test_iam_overview_handles_partial_failures(monkeypatch, client, db_session):
    account = _setup_account(db_session)

    class PartialService:
        def __init__(self, *args, **kwargs):
            pass

        def list_users(self):
            return []

        def list_groups(self):
            raise RuntimeError("groups disabled")

        def list_roles(self):
            raise RuntimeError("roles disabled")

        def list_policies(self):
            return []

    monkeypatch.setattr("app.routers.manager.iam_overview.get_iam_service", lambda *args, **kwargs: PartialService())
    previous_account_context = app.dependency_overrides.get(dependencies.get_account_context)
    previous_iam_guard = app.dependency_overrides.get(dependencies.require_iam_capable_manager)
    app.dependency_overrides[dependencies.get_account_context] = lambda: account
    app.dependency_overrides[dependencies.require_iam_capable_manager] = lambda: {"ok": True}
    try:
        resp = client.get(f"/api/manager/iam/overview?account_id={account.id}")
    finally:
        if previous_account_context is not None:
            app.dependency_overrides[dependencies.get_account_context] = previous_account_context
        else:
            app.dependency_overrides.pop(dependencies.get_account_context, None)
        if previous_iam_guard is not None:
            app.dependency_overrides[dependencies.require_iam_capable_manager] = previous_iam_guard
        else:
            app.dependency_overrides.pop(dependencies.require_iam_capable_manager, None)
    assert resp.status_code == 200
    data = resp.json()
    assert data["iam_users"] == 0
    assert data["iam_groups"] == 0
    assert data["iam_roles"] == 0
    assert len(data["warnings"]) == 2
