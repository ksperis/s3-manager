from fastapi.testclient import TestClient

from app.db import S3Account, S3User, User, UserRole
from app.main import app
from app.routers import dependencies


def _ui_admin() -> User:
    return User(
        id=2001,
        email="admin-target-grants@example.com",
        full_name="Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )


def test_ui_admin_can_grant_account_bucket_quota_target(client: TestClient, db_session):
    account = S3Account(name="privileged-account", rgw_account_id="RGW00000000000000042")
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    app.dependency_overrides[dependencies.get_current_super_admin] = _ui_admin

    response = client.put(
        f"/api/admin/accounts/{account.id}",
        json={"allow_manager_bucket_quota": True},
    )

    assert response.status_code == 200, response.text
    db_session.refresh(account)
    assert account.allow_manager_bucket_quota is True


def test_ui_admin_can_update_account_without_changing_privileged_target(client: TestClient, db_session):
    account = S3Account(name="regular-account", rgw_account_id="RGW00000000000000043")
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    app.dependency_overrides[dependencies.get_current_super_admin] = _ui_admin

    response = client.put(
        f"/api/admin/accounts/{account.id}",
        json={"name": "regular-account-renamed", "allow_manager_bucket_quota": False},
    )

    assert response.status_code == 200, response.text
    db_session.refresh(account)
    assert account.name == "regular-account-renamed"
    assert account.allow_manager_bucket_quota is False


def test_ui_admin_can_grant_s3_user_privileged_targets(client: TestClient, db_session):
    s3_user = S3User(
        name="privileged-user",
        rgw_user_uid="privileged-user",
        rgw_access_key="AKIA",
        rgw_secret_key="SECRET",
    )
    db_session.add(s3_user)
    db_session.commit()
    db_session.refresh(s3_user)

    app.dependency_overrides[dependencies.get_current_super_admin] = _ui_admin

    response = client.put(
        f"/api/admin/s3-users/{s3_user.id}",
        json={
            "allow_manager_bucket_quota": True,
            "allow_manager_ceph_s3_user_keys": True,
        },
    )

    assert response.status_code == 200, response.text
    db_session.refresh(s3_user)
    assert s3_user.allow_manager_bucket_quota is True
    assert s3_user.allow_manager_ceph_s3_user_keys is True


def test_ui_admin_can_update_s3_user_without_changing_privileged_targets(client: TestClient, db_session):
    s3_user = S3User(
        name="regular-user",
        rgw_user_uid="regular-user",
        rgw_access_key="AKIA",
        rgw_secret_key="SECRET",
    )
    db_session.add(s3_user)
    db_session.commit()
    db_session.refresh(s3_user)

    app.dependency_overrides[dependencies.get_current_super_admin] = _ui_admin

    response = client.put(
        f"/api/admin/s3-users/{s3_user.id}",
        json={
            "name": "regular-user-renamed",
            "allow_manager_bucket_quota": False,
            "allow_manager_ceph_s3_user_keys": False,
        },
    )

    assert response.status_code == 200, response.text
    db_session.refresh(s3_user)
    assert s3_user.name == "regular-user-renamed"
    assert s3_user.allow_manager_bucket_quota is False
    assert s3_user.allow_manager_ceph_s3_user_keys is False
