# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from botocore.exceptions import ClientError

from app.core.security import get_password_hash
from app.db import S3Account, UserS3Account, User, UserRole
from app.services import session_service as session_module


def _mock_external(monkeypatch, *, iam_allowed: bool, account_root: bool = False) -> None:
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
                "account_root": account_root,
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
    _mock_external(monkeypatch, iam_allowed=True)

    response = client.post(
        "/api/auth/login-s3",
        json={"access_key": "AKIA", "secret_key": "SECRET"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["session"]["capabilities"]["can_manage_iam"] is True
    assert payload["session"]["capabilities"]["can_manage_roles"] is False
    assert payload["session"]["account_id"] == "RGW00000000000000001"
    assert payload["session"]["account_name"] == "tenant-alpha"
    assert db_session.query(S3Account).filter(S3Account.rgw_account_id == "RGW00000000000000001").first() is None


def test_login_s3_disables_iam_capability_when_iam_client_denied(monkeypatch, client, db_session):
    _mock_external(monkeypatch, iam_allowed=False)

    response = client.post(
        "/api/auth/login-s3",
        json={"access_key": "AKIA", "secret_key": "SECRET"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["session"]["capabilities"]["can_manage_iam"] is False
    assert payload["session"]["capabilities"]["can_manage_roles"] is False
    assert db_session.query(S3Account).filter(S3Account.rgw_account_id == "RGW00000000000000001").first() is None


def test_login_s3_grants_role_capability_for_account_root(monkeypatch, client, db_session):
    _mock_external(monkeypatch, iam_allowed=False, account_root=True)

    response = client.post(
        "/api/auth/login-s3",
        json={"access_key": "AKIA", "secret_key": "SECRET"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["session"]["capabilities"]["can_manage_iam"] is True
    assert payload["session"]["capabilities"]["can_manage_roles"] is True
    assert db_session.query(S3Account).filter(S3Account.rgw_account_id == "RGW00000000000000001").first() is None


def _setup_account(db_session) -> S3Account:
    manager = db_session.query(User).filter(User.id == 1000).first()
    if not manager:
        manager = User(
            id=1000,
            email="manager@example.com",
            full_name="Manager",
            hashed_password="x",
            is_active=True,
            role=UserRole.ACCOUNT_ADMIN.value,
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
    password = "supersecret"
    user = User(
        email="ui-admin@example.com",
        full_name="UI Admin",
        hashed_password=get_password_hash(password),
        is_active=True,
        role=UserRole.SUPER_ADMIN.value,
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

    resp = client.get(f"/api/manager/iam/overview?account_id={account.id}")
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

    resp = client.get(f"/api/manager/iam/overview?account_id={account.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["iam_users"] == 0
    assert data["iam_groups"] == 0
    assert data["iam_roles"] == 0
    assert len(data["warnings"]) == 2
