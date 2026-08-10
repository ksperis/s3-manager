from fastapi.testclient import TestClient

from app.db import S3User, StorageEndpoint, StorageProvider, User, UserRole
from app.main import app
from app.routers import dependencies
from tests.s3_account_factory import make_s3_account


def _ui_admin() -> User:
    return User(
        id=2001,
        email="admin-target-grants@example.com",
        full_name="Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )


def _s3_user_endpoint(db_session, *, name: str) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider=StorageProvider.CEPH.value,
        is_default=True,
    )
    db_session.add(endpoint)
    db_session.flush()
    return endpoint


def test_ui_admin_can_grant_account_bucket_quota_target(client: TestClient, db_session):
    account = make_s3_account(db_session, name="privileged-account", rgw_account_id="RGW00000000000000042")
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    app.dependency_overrides[dependencies.get_current_super_admin] = _ui_admin

    response = client.put(
        f"/api/admin/accounts/{account.id}",
        json={"allow_bucket_quota_management": True},
    )

    assert response.status_code == 200, response.text
    db_session.refresh(account)
    assert account.allow_bucket_quota_management is True


def test_ui_admin_can_update_account_without_changing_privileged_target(client: TestClient, db_session):
    account = make_s3_account(db_session, name="regular-account", rgw_account_id="RGW00000000000000043")
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    app.dependency_overrides[dependencies.get_current_super_admin] = _ui_admin

    response = client.put(
        f"/api/admin/accounts/{account.id}",
        json={"name": "regular-account-renamed", "allow_bucket_quota_management": False},
    )

    assert response.status_code == 200, response.text
    db_session.refresh(account)
    assert account.name == "regular-account-renamed"
    assert account.allow_bucket_quota_management is False


def test_ui_admin_can_grant_s3_user_privileged_targets(client: TestClient, db_session):
    endpoint = _s3_user_endpoint(db_session, name="privileged-user-ceph")
    s3_user = S3User(
        name="privileged-user",
        rgw_user_uid="privileged-user",
        rgw_access_key="AKIA",
        rgw_secret_key="SECRET",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(s3_user)
    db_session.commit()
    db_session.refresh(s3_user)

    app.dependency_overrides[dependencies.get_current_super_admin] = _ui_admin

    response = client.put(
        f"/api/admin/s3-users/{s3_user.id}",
        json={
            "allow_bucket_quota_management": True,
            "allow_access_key_management": True,
        },
    )

    assert response.status_code == 200, response.text
    db_session.refresh(s3_user)
    assert s3_user.allow_bucket_quota_management is True
    assert s3_user.allow_access_key_management is True


def test_ui_admin_can_update_s3_user_without_changing_privileged_targets(client: TestClient, db_session):
    endpoint = _s3_user_endpoint(db_session, name="regular-user-ceph")
    s3_user = S3User(
        name="regular-user",
        rgw_user_uid="regular-user",
        rgw_access_key="AKIA",
        rgw_secret_key="SECRET",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(s3_user)
    db_session.commit()
    db_session.refresh(s3_user)

    app.dependency_overrides[dependencies.get_current_super_admin] = _ui_admin

    response = client.put(
        f"/api/admin/s3-users/{s3_user.id}",
        json={
            "name": "regular-user-renamed",
            "allow_bucket_quota_management": False,
            "allow_access_key_management": False,
        },
    )

    assert response.status_code == 200, response.text
    db_session.refresh(s3_user)
    assert s3_user.name == "regular-user-renamed"
    assert s3_user.allow_bucket_quota_management is False
    assert s3_user.allow_access_key_management is False
