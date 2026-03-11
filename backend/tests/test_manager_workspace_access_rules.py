# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import AccountRole, S3Connection, S3User, StorageEndpoint, User, UserRole, UserS3Account, UserS3User
from app.models.app_settings import AppSettings
from app.routers import dependencies
from app.routers.manager import context as manager_context_router


def _request(path: str):
    return SimpleNamespace(
        url=SimpleNamespace(path=path),
        headers={},
    )


def test_manager_membership_portal_manager_disabled_by_default():
    link = UserS3Account(
        user_id=1,
        account_id=1,
        account_role=AccountRole.PORTAL_MANAGER.value,
        account_admin=False,
        is_root=False,
    )
    _, caps = dependencies._manager_membership_capabilities(link, requested_mode=None)
    assert caps.can_manage_buckets is False
    assert caps.can_manage_iam is False


def test_manager_membership_portal_manager_enabled_with_setting(monkeypatch):
    link = UserS3Account(
        user_id=1,
        account_id=1,
        account_role=AccountRole.PORTAL_MANAGER.value,
        account_admin=False,
        is_root=False,
    )
    settings = AppSettings()
    settings.general.allow_portal_manager_workspace = True
    monkeypatch.setattr(dependencies, "load_app_settings", lambda: settings)

    _, caps = dependencies._manager_membership_capabilities(link, requested_mode=None)
    assert caps.can_manage_buckets is True
    assert caps.can_manage_iam is True


def test_manager_workspace_accepts_non_iam_connection_when_access_manager_enabled(db_session):
    user = User(
        email="manager-connection-check@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    connection = S3Connection(
        owner_user_id=None,
        is_public=True,
        name="non-iam-connection",
        access_manager=True,
        access_browser=True,
        capabilities_json=json.dumps({"can_manage_iam": False}),
        access_key_id="AK-CONN",
        secret_access_key="SK-CONN",
    )
    db_session.add_all([user, connection])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(connection)

    account = dependencies.get_account_context(
        request=_request("/api/manager/buckets"),
        account_ref=f"conn-{connection.id}",
        actor=user,
        db=db_session,
    )
    caps = getattr(account, "_manager_capabilities", None)
    assert caps is not None
    assert caps.can_manage_iam is False


def test_manager_workspace_touch_connection_last_used_timestamp(db_session):
    user = User(
        email="manager-connection-touch@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    connection = S3Connection(
        owner_user_id=None,
        is_public=True,
        name="touch-connection",
        access_manager=True,
        access_browser=True,
        capabilities_json=json.dumps({"can_manage_iam": False}),
        access_key_id="AK-TOUCH",
        secret_access_key="SK-TOUCH",
    )
    db_session.add_all([user, connection])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(connection)
    assert connection.last_used_at is None

    dependencies.get_account_context(
        request=_request("/api/manager/buckets"),
        account_ref=f"conn-{connection.id}",
        actor=user,
        db=db_session,
    )
    db_session.refresh(connection)
    assert connection.last_used_at is not None


def test_storage_ops_workspace_does_not_touch_connection_last_used_timestamp(db_session):
    user = User(
        email="storage-ops-connection-no-touch@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    connection = S3Connection(
        owner_user_id=None,
        is_public=True,
        name="no-touch-connection",
        access_manager=True,
        access_browser=True,
        capabilities_json=json.dumps({"can_manage_iam": False}),
        access_key_id="AK-NO-TOUCH",
        secret_access_key="SK-NO-TOUCH",
    )
    db_session.add_all([user, connection])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(connection)
    assert connection.last_used_at is None

    dependencies.get_account_context(
        request=_request("/api/storage-ops/buckets"),
        account_ref=f"conn-{connection.id}",
        actor=user,
        db=db_session,
    )
    db_session.refresh(connection)
    assert connection.last_used_at is None


def test_manager_workspace_rejects_connection_without_manager_access(db_session):
    user = User(
        email="manager-connection-no-access@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    connection = S3Connection(
        owner_user_id=None,
        is_public=True,
        name="manager-disabled-connection",
        access_manager=False,
        access_browser=True,
        capabilities_json=json.dumps({"can_manage_iam": True}),
        access_key_id="AK-CONN2",
        secret_access_key="SK-CONN2",
    )
    db_session.add_all([user, connection])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(connection)

    with pytest.raises(HTTPException) as exc:
        dependencies.get_account_context(
            request=_request("/api/manager/buckets"),
            account_ref=f"conn-{connection.id}",
            actor=user,
            db=db_session,
        )
    assert exc.value.status_code == 403
    assert "cannot be used in manager workspace" in str(exc.value.detail)


@pytest.mark.parametrize("account_ref", ["-1", "null", "-42", "0"])
def test_workspace_rejects_legacy_account_selectors(db_session, account_ref: str):
    user = User(
        email="legacy-account-selector@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    with pytest.raises(HTTPException) as exc:
        dependencies.get_account_context(
            request=_request("/api/manager/buckets"),
            account_ref=account_ref,
            actor=user,
            db=db_session,
        )

    assert exc.value.status_code == 400
    assert "Invalid account identifier" in str(exc.value.detail)


def test_manager_context_exposes_browser_access_flag_for_connection(db_session):
    user = User(
        email="manager-context-connection-browser-flag@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    connection = S3Connection(
        owner_user_id=None,
        is_public=True,
        name="manager-connection-browser-disabled",
        access_manager=True,
        access_browser=False,
        capabilities_json=json.dumps({"can_manage_iam": False}),
        access_key_id="AK-CONN3",
        secret_access_key="SK-CONN3",
    )
    db_session.add_all([user, connection])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(connection)

    account = dependencies.get_account_context(
        request=_request("/api/manager/context"),
        account_ref=f"conn-{connection.id}",
        actor=user,
        db=db_session,
    )
    payload = manager_context_router.get_manager_context(account=account, actor=user, db=db_session)
    assert payload.access_mode == "connection"
    assert payload.manager_browser_enabled is False


@pytest.mark.parametrize("path", ["/api/manager/buckets", "/api/browser/buckets"])
def test_manager_and_browser_workspace_accept_s3_user_context(db_session, path):
    user = User(
        email="s3-user-context-ok@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    s3_user = S3User(
        name="legacy-s3-user",
        rgw_user_uid="legacy-user-uid",
        rgw_access_key="AK-S3U",
        rgw_secret_key="SK-S3U",
    )
    db_session.add_all([user, s3_user])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(s3_user)

    db_session.add(UserS3User(user_id=user.id, s3_user_id=s3_user.id))
    db_session.commit()

    account = dependencies.get_account_context(
        request=_request(path),
        account_ref=f"s3u-{s3_user.id}",
        actor=user,
        db=db_session,
    )

    assert getattr(account, "s3_user_id", None) == s3_user.id
    assert account.effective_rgw_credentials() == ("AK-S3U", "SK-S3U")
    caps = getattr(account, "_manager_capabilities", None)
    assert caps is not None
    assert caps.can_manage_buckets is True
    assert caps.can_manage_iam is False


def test_workspace_rejects_unlinked_s3_user_context(db_session):
    user = User(
        email="s3-user-context-ko@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    s3_user = S3User(
        name="legacy-s3-user-ko",
        rgw_user_uid="legacy-user-ko",
        rgw_access_key="AK-S3U-KO",
        rgw_secret_key="SK-S3U-KO",
    )
    db_session.add_all([user, s3_user])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(s3_user)

    with pytest.raises(HTTPException) as exc:
        dependencies.get_account_context(
            request=_request("/api/manager/buckets"),
            account_ref=f"s3u-{s3_user.id}",
            actor=user,
            db=db_session,
        )
    assert exc.value.status_code == 403
    assert "Not authorized for this S3 user" in str(exc.value.detail)


def test_browser_workspace_accepts_ceph_admin_selector_for_authorized_user(db_session, monkeypatch):
    settings = AppSettings()
    settings.general.ceph_admin_enabled = True
    settings.general.browser_ceph_admin_enabled = True
    monkeypatch.setattr(dependencies, "load_app_settings", lambda: settings)

    user = User(
        email="ceph-admin-browser-ok@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
        can_access_ceph_admin=True,
    )
    endpoint = StorageEndpoint(
        name="ceph-endpoint-a",
        endpoint_url="https://rgw-a.example.com",
        provider="ceph",
        ceph_admin_access_key="AK-CEPH-ADMIN",
        ceph_admin_secret_key="SK-CEPH-ADMIN",
        features_config="features:\n  admin:\n    enabled: true\n",
    )
    db_session.add_all([user, endpoint])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(endpoint)

    account = dependencies.get_account_context(
        request=_request("/api/browser/buckets"),
        account_ref=f"ceph-admin-{endpoint.id}",
        actor=user,
        db=db_session,
    )

    assert account.storage_endpoint_id == endpoint.id
    assert account.effective_rgw_credentials() == ("AK-CEPH-ADMIN", "SK-CEPH-ADMIN")


def test_browser_workspace_rejects_ceph_admin_selector_for_non_admin_user(db_session, monkeypatch):
    settings = AppSettings()
    settings.general.ceph_admin_enabled = True
    settings.general.browser_ceph_admin_enabled = True
    monkeypatch.setattr(dependencies, "load_app_settings", lambda: settings)

    user = User(
        email="ceph-admin-browser-ko@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
        can_access_ceph_admin=False,
    )
    endpoint = StorageEndpoint(
        name="ceph-endpoint-b",
        endpoint_url="https://rgw-b.example.com",
        provider="ceph",
        ceph_admin_access_key="AK-CEPH-ADMIN-B",
        ceph_admin_secret_key="SK-CEPH-ADMIN-B",
        features_config="features:\n  admin:\n    enabled: true\n",
    )
    db_session.add_all([user, endpoint])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(endpoint)

    with pytest.raises(HTTPException) as exc:
        dependencies.get_account_context(
            request=_request("/api/browser/buckets"),
            account_ref=f"ceph-admin-{endpoint.id}",
            actor=user,
            db=db_session,
        )
    assert exc.value.status_code == 403
    assert "Not authorized for Ceph Admin browser workspace" in str(exc.value.detail)
