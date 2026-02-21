# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from app.main import app
from app.db import S3Account, User, UserRole
from app.routers import dependencies
from fastapi.testclient import TestClient


@pytest.fixture
def seed_user_account(db_session):
    acc = S3Account(name="api-acc", rgw_account_id="RGW00000000000000002")
    db_session.add(acc)
    db_session.flush()
    usr = User(
        email="api-user@example.com",
        full_name="API",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(usr)
    db_session.commit()
    return usr, acc


def test_assign_user_to_account_api(client: TestClient, db_session, seed_user_account, monkeypatch):
    usr, acc = seed_user_account

    # Monkeypatch RGW call inside UsersService
    from app.services import users_service

    resp = client.post(f"/api/admin/users/{usr.id}/assign-account", json={"account_id": acc.id})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert acc.id in data.get("accounts", [])


def test_admin_cannot_create_superadmin_or_grant_ceph_admin(client: TestClient):
    admin_user = User(
        id=1001,
        email="admin@example.com",
        full_name="Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: admin_user

    resp = client.post(
        "/api/admin/users",
        json={
            "email": "new-superadmin@example.com",
            "password": "secret",
            "role": UserRole.UI_SUPERADMIN.value,
        },
    )
    assert resp.status_code == 403, resp.text

    resp = client.post(
        "/api/admin/users",
        json={
            "email": "new-admin@example.com",
            "password": "secret",
            "role": UserRole.UI_ADMIN.value,
            "can_access_ceph_admin": True,
        },
    )
    assert resp.status_code == 403, resp.text


def test_superadmin_can_create_superadmin_and_grant_ceph_admin(client: TestClient):
    super_admin_user = User(
        id=1002,
        email="superadmin@example.com",
        full_name="Super Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: super_admin_user

    create_superadmin = client.post(
        "/api/admin/users",
        json={
            "email": "new-superadmin@example.com",
            "password": "secret",
            "role": UserRole.UI_SUPERADMIN.value,
        },
    )
    assert create_superadmin.status_code == 201, create_superadmin.text
    assert create_superadmin.json()["role"] == UserRole.UI_SUPERADMIN.value

    create_admin_with_ceph = client.post(
        "/api/admin/users",
        json={
            "email": "new-admin@example.com",
            "password": "secret",
            "role": UserRole.UI_ADMIN.value,
            "can_access_ceph_admin": True,
        },
    )
    assert create_admin_with_ceph.status_code == 201, create_admin_with_ceph.text
    payload = create_admin_with_ceph.json()
    assert payload["role"] == UserRole.UI_ADMIN.value
    assert payload["can_access_ceph_admin"] is True


def test_admin_cannot_promote_or_grant_ceph_admin_on_update(client: TestClient, db_session):
    target = User(
        email="target@example.com",
        full_name="Target",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(target)
    db_session.commit()

    admin_user = User(
        id=1003,
        email="admin@example.com",
        full_name="Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: admin_user

    promote_resp = client.put(
        f"/api/admin/users/{target.id}",
        json={"role": UserRole.UI_SUPERADMIN.value},
    )
    assert promote_resp.status_code == 403, promote_resp.text

    grant_resp = client.put(
        f"/api/admin/users/{target.id}",
        json={"role": UserRole.UI_ADMIN.value, "can_access_ceph_admin": True},
    )
    assert grant_resp.status_code == 403, grant_resp.text


def test_superadmin_can_promote_and_grant_ceph_admin_on_update(client: TestClient, db_session):
    target = User(
        email="target-super@example.com",
        full_name="Target",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(target)
    db_session.commit()

    super_admin_user = User(
        id=1004,
        email="superadmin@example.com",
        full_name="Super Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: super_admin_user

    promote_resp = client.put(
        f"/api/admin/users/{target.id}",
        json={"role": UserRole.UI_SUPERADMIN.value},
    )
    assert promote_resp.status_code == 200, promote_resp.text
    assert promote_resp.json()["role"] == UserRole.UI_SUPERADMIN.value

    grant_resp = client.put(
        f"/api/admin/users/{target.id}",
        json={"role": UserRole.UI_ADMIN.value, "can_access_ceph_admin": True},
    )
    assert grant_resp.status_code == 200, grant_resp.text
    payload = grant_resp.json()
    assert payload["role"] == UserRole.UI_ADMIN.value
    assert payload["can_access_ceph_admin"] is True
