# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi.testclient import TestClient

from app.db import AccountRole, S3Account, User, UserRole, UserS3Account
from app.main import app
from app.routers import dependencies
from app.models.access_context import AccountAccess
from app.models.account_capabilities import AccountCapabilities
from tests.s3_account_factory import make_s3_account


def _seed_account(db_session, *, name="Research Account") -> S3Account:
    account = make_s3_account(db_session, name=name, rgw_account_id="RGW00000000000000042")
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def _seed_user(db_session, *, email: str, role: str = UserRole.UI_USER.value) -> User:
    user = User(
        email=email,
        full_name=email.split("@")[0],
        display_name=email.split("@")[0],
        hashed_password="x",
        is_active=True,
        role=role,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _install_portal_access_override(
    account: S3Account,
    user: User,
    *,
    role: str = AccountRole.PORTAL_MANAGER.value,
    can_manage: bool | None = None,
) -> None:
    def override_portal_access():
        effective_can_manage = (
            role == AccountRole.PORTAL_MANAGER.value
            if can_manage is None
            else can_manage
        )
        return AccountAccess(
            account=account,
            actor=user,
            membership=None,
            role=role,
            capabilities=AccountCapabilities(
                can_manage_buckets=effective_can_manage,
                can_manage_portal_users=effective_can_manage,
            ),
        )

    app.dependency_overrides[dependencies.get_portal_account_access] = override_portal_access
    app.dependency_overrides[dependencies.require_portal_enabled] = lambda: None


def _install_admin_override(admin: User) -> None:
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: admin
    app.dependency_overrides[dependencies.require_portal_enabled] = lambda: None


def test_portal_request_routes_create_and_isolate_by_requester(client: TestClient, db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    other = _seed_user(db_session, email="other@example.org")
    _install_portal_access_override(account, requester)

    response = client.post(
        "/api/portal/requests",
        json={
            "request_type": "portal_user_access",
            "target_name": "Jane Viewer",
            "target_email": "jane@example.org",
        },
    )

    assert response.status_code == 201
    created = response.json()
    assert created["status"] == "pending"
    assert created["payload"]["target_email"] == "jane@example.org"

    list_response = client.get("/api/portal/requests")
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [created["id"]]

    _install_portal_access_override(account, other)
    denied = client.get(f"/api/portal/requests/{created['id']}")
    assert denied.status_code == 404


def test_portal_request_routes_require_manager_for_creation(client: TestClient, db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    _install_portal_access_override(account, requester, role=AccountRole.PORTAL_USER.value)

    response = client.post(
        "/api/portal/requests",
        json={
            "request_type": "portal_user_access",
            "target_name": "Jane Viewer",
            "target_email": "jane@example.org",
        },
    )

    assert response.status_code == 403


def test_portal_request_routes_use_effective_manager_role_for_creation(client: TestClient, db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="manager@example.org")
    _install_portal_access_override(
        account,
        requester,
        role=AccountRole.PORTAL_MANAGER.value,
        can_manage=False,
    )

    response = client.post(
        "/api/portal/requests",
        json={
            "request_type": "account_quota_change",
            "direction": "increase",
            "target_quota_value": 20,
            "target_quota_unit": "GiB",
        },
    )

    assert response.status_code == 201


def test_admin_request_routes_approve_and_conflict(client: TestClient, db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    _install_portal_access_override(account, requester)
    create_response = client.post(
        "/api/portal/requests",
        json={
            "request_type": "portal_user_access",
            "target_name": "Jane Viewer",
            "target_email": "jane@example.org",
        },
    )
    request_id = create_response.json()["id"]
    _install_admin_override(admin)

    list_response = client.get("/api/admin/portal-requests", params={"status": "pending"})
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [request_id]

    approve_response = client.post(
        f"/api/admin/portal-requests/{request_id}/approve",
        json={"message": "Approved"},
    )

    assert approve_response.status_code == 200
    approved = approve_response.json()
    assert approved["status"] == "approved"
    assert approved["messages"][0]["message"] == "Approved"
    target = db_session.query(User).filter(User.email == "jane@example.org").one()
    link = db_session.query(UserS3Account).filter_by(user_id=target.id, account_id=account.id).one()
    assert link.role == AccountRole.PORTAL_USER.value

    conflict = client.post(f"/api/admin/portal-requests/{request_id}/approve", json={})
    assert conflict.status_code == 409


def test_admin_request_routes_approve_user_removal(client: TestClient, db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    target = _seed_user(db_session, email="jane@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    db_session.add(
        UserS3Account(
            user_id=target.id,
            account_id=account.id,
            role=AccountRole.PORTAL_USER.value,
        )
    )
    db_session.commit()
    _install_portal_access_override(account, requester)
    create_response = client.post(
        "/api/portal/requests",
        json={
            "request_type": "portal_user_removal",
            "target_name": "Jane Viewer",
            "target_email": "jane@example.org",
        },
    )
    request_id = create_response.json()["id"]
    _install_admin_override(admin)

    approve_response = client.post(f"/api/admin/portal-requests/{request_id}/approve", json={})

    assert approve_response.status_code == 200
    approved = approve_response.json()
    assert approved["status"] == "approved"
    assert approved["result"]["target_email"] == "jane@example.org"
    assert db_session.query(UserS3Account).filter_by(user_id=target.id, account_id=account.id).first() is None


def test_admin_request_routes_reject_and_message(client: TestClient, db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    _install_portal_access_override(account, requester)
    create_response = client.post(
        "/api/portal/requests",
        json={
            "request_type": "account_quota_change",
            "direction": "increase",
            "target_quota_value": 20,
            "target_quota_unit": "GiB",
        },
    )
    request_id = create_response.json()["id"]
    _install_admin_override(admin)

    message_response = client.post(
        f"/api/admin/portal-requests/{request_id}/messages",
        json={"message": "Can you add the project code?"},
    )
    reject_response = client.post(
        f"/api/admin/portal-requests/{request_id}/reject",
        json={"message": "Missing project code"},
    )

    assert message_response.status_code == 200
    assert reject_response.status_code == 200
    rejected = reject_response.json()
    assert rejected["status"] == "rejected"
    assert [message["message"] for message in rejected["messages"]] == [
        "Can you add the project code?",
        "Missing project code",
    ]
