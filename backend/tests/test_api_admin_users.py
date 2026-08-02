# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from app.main import app
from app.db import S3Account, UiGroup, User, UserRole
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


def test_assign_user_to_account_api(client: TestClient, seed_user_account):
    usr, acc = seed_user_account

    resp = client.post(
        f"/api/admin/users/{usr.id}/assign-account",
        json={"account_id": acc.id, "role": "account_administrator"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert acc.id in data.get("accounts", [])


def test_assign_user_to_account_requires_a_canonical_role(
    client: TestClient,
    seed_user_account,
):
    usr, acc = seed_user_account

    missing = client.post(
        f"/api/admin/users/{usr.id}/assign-account",
        json={"account_id": acc.id},
    )
    assert missing.status_code == 422

    removed_legacy = client.post(
        f"/api/admin/users/{usr.id}/assign-account",
        json={
            "account_id": acc.id,
            "account_admin": False,
            "account_role": "portal_manager",
        },
    )
    assert removed_legacy.status_code == 422


def test_assign_user_to_account_rejects_removed_legacy_fields(
    client: TestClient,
    seed_user_account,
):
    usr, acc = seed_user_account

    response = client.post(
        f"/api/admin/users/{usr.id}/assign-account",
        json={
            "account_id": acc.id,
            "role": "portal_user",
            "account_admin": True,
            "account_role": "portal_none",
        },
    )

    assert response.status_code == 422


def test_assign_user_to_account_rejects_internal_root_flag(
    client: TestClient,
    seed_user_account,
):
    usr, acc = seed_user_account

    response = client.post(
        f"/api/admin/users/{usr.id}/assign-account",
        json={
            "account_id": acc.id,
            "role": "account_administrator",
            "account_root": True,
        },
    )

    assert response.status_code == 422


def test_update_user_replaces_account_links_atomically(client: TestClient, db_session, seed_user_account):
    usr, first_account = seed_user_account
    second_account = S3Account(name="api-acc-2", rgw_account_id="RGW00000000000000003")
    db_session.add(second_account)
    db_session.commit()

    response = client.put(
        f"/api/admin/users/{usr.id}",
        json={
            "account_links": [
                {
                    "account_id": second_account.id,
                    "role": "account_administrator",
                }
            ]
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["accounts"] == [second_account.id]
    assert payload["account_links"] == [
        {
            "account_id": second_account.id,
            "role": "account_administrator",
        }
    ]
    assert first_account.id not in payload["accounts"]


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
            "password": "secret-pass-01",
            "role": UserRole.UI_SUPERADMIN.value,
        },
    )
    assert resp.status_code == 403, resp.text

    resp = client.post(
        "/api/admin/users",
        json={
            "email": "new-admin@example.com",
            "password": "secret-pass-02",
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
            "password": "secret-pass-03",
            "role": UserRole.UI_SUPERADMIN.value,
        },
    )
    assert create_superadmin.status_code == 201, create_superadmin.text
    assert create_superadmin.json()["role"] == UserRole.UI_SUPERADMIN.value

    create_admin_with_ceph = client.post(
        "/api/admin/users",
        json={
            "email": "new-admin@example.com",
            "password": "secret-pass-04",
            "role": UserRole.UI_ADMIN.value,
            "can_access_ceph_admin": True,
        },
    )
    assert create_admin_with_ceph.status_code == 201, create_admin_with_ceph.text
    payload = create_admin_with_ceph.json()
    assert payload["role"] == UserRole.UI_ADMIN.value
    assert payload["can_access_ceph_admin"] is True
    assert payload["browser_advanced_features_enabled"] is False
    assert payload["manager_tool_access"] == {
        "bucket_compare": False,
        "bucket_integrity_check": False,
        "bucket_migration": False,
        "bucket_purge": False,
        "feature_rules": False,
        "bucket_quota": False,
        "ceph_s3_user_keys": False,
    }


def test_admin_can_configure_manager_tool_access_on_update(client: TestClient, db_session):
    target = User(
        email="target-manager-tools@example.com",
        full_name="Target Manager Tools",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    db_session.add(target)
    db_session.commit()

    admin_user = User(
        id=1007,
        email="admin-tools@example.com",
        full_name="Admin Tools",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: admin_user

    response = client.put(
        f"/api/admin/users/{target.id}",
        json={
            "manager_tool_access": {
                "bucket_compare": True,
                "bucket_integrity_check": True,
                "bucket_migration": False,
                "bucket_purge": True,
                "feature_rules": True,
                "bucket_quota": False,
                "ceph_s3_user_keys": True,
            },
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["manager_tool_access"] == {
        "bucket_compare": True,
        "bucket_integrity_check": True,
        "bucket_migration": False,
        "bucket_purge": True,
        "feature_rules": True,
        "bucket_quota": False,
        "ceph_s3_user_keys": True,
    }


def test_admin_cannot_grant_bucket_quota_access(client: TestClient, db_session):
    target = User(
        email="target-bucket-quota@example.com",
        full_name="Target Bucket Quota",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    db_session.add(target)
    db_session.commit()

    admin_user = User(
        id=1011,
        email="admin-bucket-quota@example.com",
        full_name="Admin Bucket Quota",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: admin_user

    response = client.put(
        f"/api/admin/users/{target.id}",
        json={
            "manager_tool_access": {
                "bucket_quota": True,
            },
        },
    )

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "Only superadmin users can promote superadmins or grant privileged Ceph access"


def test_admin_cannot_assign_group_that_grants_bucket_quota(client: TestClient, db_session):
    group = UiGroup(
        name="Privileged quota group",
        can_access_manager_bucket_quota=True,
    )
    db_session.add(group)
    db_session.commit()

    admin_user = User(
        id=1012,
        email="admin-bucket-quota-group@example.com",
        full_name="Admin Bucket Quota Group",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: admin_user

    response = client.post(
        "/api/admin/users",
        json={
            "email": "new-user-with-quota-group@example.com",
            "password": "secret-pass-05",
            "role": UserRole.UI_USER.value,
            "group_ids": [group.id],
        },
    )

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "Only superadmin users can assign groups that grant privileged Ceph access"


def test_admin_can_configure_browser_advanced_features_on_update(client: TestClient, db_session):
    target = User(
        email="target-browser-advanced@example.com",
        full_name="Target Browser Advanced",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(target)
    db_session.commit()

    admin_user = User(
        id=1010,
        email="admin-browser-advanced@example.com",
        full_name="Admin Browser Advanced",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: admin_user

    response = client.put(
        f"/api/admin/users/{target.id}",
        json={"browser_advanced_features_enabled": True},
    )

    assert response.status_code == 200, response.text
    assert response.json()["browser_advanced_features_enabled"] is True
    assert response.json()["effective_access"]["browser_advanced_features_enabled"] is True


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


def test_admin_can_grant_and_revoke_storage_ops_on_update(client: TestClient, db_session):
    target = User(
        email="target-storage-ops@example.com",
        full_name="Target Storage Ops",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    db_session.add(target)
    db_session.commit()

    admin_user = User(
        id=1006,
        email="admin@example.com",
        full_name="Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: admin_user

    grant_resp = client.put(
        f"/api/admin/users/{target.id}",
        json={"can_access_storage_ops": True},
    )
    assert grant_resp.status_code == 200, grant_resp.text
    assert grant_resp.json()["can_access_storage_ops"] is True

    revoke_resp = client.put(
        f"/api/admin/users/{target.id}",
        json={"can_access_storage_ops": False},
    )
    assert revoke_resp.status_code == 200, revoke_resp.text
    assert revoke_resp.json()["can_access_storage_ops"] is False


def test_admin_create_user_rejects_short_password(client: TestClient):
    response = client.post(
        "/api/admin/users",
        json={
            "email": "short-password@example.com",
            "password": "short123",
            "role": UserRole.UI_USER.value,
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Password must be at least 12 characters long"


def test_admin_update_user_rejects_short_password(client: TestClient, db_session):
    target = User(
        email="update-short-password@example.com",
        full_name="Target",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(target)
    db_session.commit()

    response = client.put(
        f"/api/admin/users/{target.id}",
        json={"password": "short123"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Password must be at least 12 characters long"


def test_admin_cannot_delete_own_user(client: TestClient):
    admin_user = User(
        id=1005,
        email="self-delete-admin@example.com",
        full_name="Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: admin_user

    response = client.delete(f"/api/admin/users/{admin_user.id}")
    assert response.status_code == 400
    assert response.json()["detail"] == "You cannot delete your own user"
