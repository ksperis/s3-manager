# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import S3Account, S3Connection, S3User, StorageEndpoint, User, UserRole, UserS3Account, UserS3User
from app.models.app_settings import AppSettings
from app.routers.ceph_admin import dependencies as ceph_admin_dependencies
from app.routers import dependencies
from app.routers.manager import context as manager_context_router
from app.services.connection_identity_service import ConnectionIdentityResolution


def _request(path: str, headers: dict | None = None):
    return SimpleNamespace(
        url=SimpleNamespace(path=path),
        headers=headers or {},
    )


def _ceph_metrics_endpoint(*, name: str, provider: str = "ceph") -> StorageEndpoint:
    metrics_enabled = provider == "ceph"
    usage_enabled = provider == "ceph"
    return StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.com",
        admin_endpoint=f"https://{name}.example.com/admin",
        provider=provider,
        supervision_access_key="SUP-AK",
        supervision_secret_key="SUP-SK",
        features_config=(
            "features:\n"
            "  admin:\n"
            f"    enabled: {'true' if provider == 'ceph' else 'false'}\n"
            "  metrics:\n"
            f"    enabled: {'true' if metrics_enabled else 'false'}\n"
            "  usage:\n"
            f"    enabled: {'true' if usage_enabled else 'false'}\n"
        ),
    )


def _ceph_s3_user_management_endpoint(
    *,
    name: str,
    provider: str = "ceph",
    endpoint_url: str | None = None,
    admin_enabled: bool = True,
    admin_access_key: str | None = "AK-ADMIN",
    admin_secret_key: str | None = "SK-ADMIN",
) -> StorageEndpoint:
    normalized_endpoint_url = endpoint_url if endpoint_url is not None else f"https://{name}.example.com"
    return StorageEndpoint(
        name=name,
        endpoint_url=normalized_endpoint_url,
        provider=provider,
        admin_endpoint=f"https://{name}.example.com/admin",
        admin_access_key=admin_access_key,
        admin_secret_key=admin_secret_key,
        features_config=(
            "features:\n"
            "  admin:\n"
            f"    enabled: {'true' if admin_enabled else 'false'}\n"
        ),
    )


def _build_linked_s3_user_context(
    db_session,
    *,
    endpoint: StorageEndpoint,
    email: str = "manager-ceph-keys-s3u@example.com",
):
    user = User(
        email=email,
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    s3_user = S3User(
        name="managed-s3-user",
        rgw_user_uid=f"uid-{endpoint.name}",
        rgw_access_key="AK-S3U",
        rgw_secret_key="SK-S3U",
        storage_endpoint=endpoint,
    )
    db_session.add_all([user, endpoint, s3_user])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(s3_user)
    db_session.add(UserS3User(user_id=user.id, s3_user_id=s3_user.id))
    db_session.commit()

    account = dependencies.get_account_context(
        request=_request("/api/manager/context"),
        account_ref=f"s3u-{s3_user.id}",
        actor=user,
        db=db_session,
    )
    return user, account


def test_manager_membership_without_admin_is_forbidden():
    link = UserS3Account(
        user_id=1,
        account_id=1,
        account_admin=False,
        is_root=False,
    )
    with pytest.raises(HTTPException) as exc:
        dependencies._manager_membership_capabilities(link)
    assert exc.value.status_code == 403


def test_manager_membership_account_admin_uses_root_key_capabilities():
    link = UserS3Account(
        user_id=1,
        account_id=1,
        account_admin=True,
        is_root=False,
    )
    caps = dependencies._manager_membership_capabilities(link)
    assert caps.using_root_key is True
    assert caps.can_manage_buckets is True
    assert caps.can_manage_iam is True
    assert caps.can_view_root_key is True


def test_manager_context_ignores_legacy_access_mode_header(db_session):
    user = User(
        email="manager-access-toggle-disabled@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    account = S3Account(
        name="manager-toggle-account",
        rgw_account_id="RGWTOGGLE0001",
        rgw_access_key="AK-TOGGLE",
        rgw_secret_key="SK-TOGGLE",
    )
    db_session.add_all([user, account])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(account)

    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            account_admin=True,
            is_root=False,
        )
    )
    db_session.commit()

    account_ctx = dependencies.get_account_context(
        request=_request("/api/manager/context", headers={"X-Manager-Access-Mode": "portal"}),
        account_ref=str(account.id),
        actor=user,
        db=db_session,
    )
    payload = manager_context_router.get_manager_context(account=account_ctx, actor=user, db=db_session)
    assert payload.access_mode == "admin"
    assert "can_switch_access" not in payload.model_dump()


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


@pytest.mark.parametrize("path", ["/api/manager/buckets", "/api/browser/buckets"])
def test_manager_and_browser_workspace_reject_inactive_connection(db_session, path: str):
    user = User(
        email="connection-inactive-rejected@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    connection = S3Connection(
        owner_user_id=None,
        is_public=True,
        is_active=False,
        name="inactive-connection",
        access_manager=True,
        access_browser=True,
        capabilities_json=json.dumps({"can_manage_iam": False}),
        access_key_id="AK-INACTIVE",
        secret_access_key="SK-INACTIVE",
    )
    db_session.add_all([user, connection])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(connection)

    with pytest.raises(HTTPException) as exc:
        dependencies.get_account_context(
            request=_request(path),
            account_ref=f"conn-{connection.id}",
            actor=user,
            db=db_session,
        )
    assert exc.value.status_code == 403
    assert "disabled" in str(exc.value.detail).lower()


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
    assert payload.manager_ceph_keys_enabled is False


def test_manager_context_connection_exposes_detected_identity_and_stats_enabled(db_session):
    user = User(
        email="manager-context-connection-identity@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    endpoint = _ceph_metrics_endpoint(name="ceph-conn-identity")
    connection = S3Connection(
        owner_user_id=None,
        is_public=True,
        name="manager-connection-identity",
        access_manager=True,
        access_browser=True,
        storage_endpoint=endpoint,
        credential_owner_type="s3_user",
        credential_owner_identifier="rgw-account$analytics-user",
        capabilities_json=json.dumps({"can_manage_iam": False}),
        access_key_id="AK-CONN-IDENTITY",
        secret_access_key="SK-CONN-IDENTITY",
    )
    db_session.add_all([user, endpoint, connection])
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
    assert payload.iam_identity == "rgw-account$analytics-user"
    assert payload.manager_stats_enabled is True
    assert payload.manager_stats_message is None
    assert payload.manager_ceph_keys_enabled is False


def test_manager_context_connection_reports_reason_when_identity_cannot_be_resolved(db_session, monkeypatch):
    user = User(
        email="manager-context-connection-identity-ko@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    endpoint = _ceph_metrics_endpoint(name="ceph-conn-identity-ko")
    connection = S3Connection(
        owner_user_id=None,
        is_public=True,
        name="manager-connection-identity-ko",
        access_manager=True,
        access_browser=True,
        storage_endpoint=endpoint,
        capabilities_json=json.dumps({"can_manage_iam": False}),
        access_key_id="AK-CONN-IDENTITY-KO",
        secret_access_key="SK-CONN-IDENTITY-KO",
    )
    db_session.add_all([user, endpoint, connection])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(connection)

    monkeypatch.setattr(
        manager_context_router.ConnectionIdentityService,
        "resolve_metrics_identity",
        lambda self, conn: ConnectionIdentityResolution(
            rgw_user_uid=None,
            rgw_account_id=None,
            metrics_enabled=True,
            usage_enabled=True,
            reason="Metrics are unavailable: unable to resolve RGW identity for this connection.",
        ),
    )

    account = dependencies.get_account_context(
        request=_request("/api/manager/context"),
        account_ref=f"conn-{connection.id}",
        actor=user,
        db=db_session,
    )
    payload = manager_context_router.get_manager_context(account=account, actor=user, db=db_session)
    assert payload.access_mode == "connection"
    assert payload.iam_identity is None
    assert payload.manager_stats_enabled is False
    assert payload.manager_stats_message is not None
    assert "unable to resolve rgw identity" in payload.manager_stats_message.lower()


def test_manager_context_connection_reports_reason_for_non_ceph_endpoint(db_session):
    user = User(
        email="manager-context-connection-non-ceph@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    endpoint = _ceph_metrics_endpoint(name="other-conn-endpoint", provider="other")
    connection = S3Connection(
        owner_user_id=None,
        is_public=True,
        name="manager-connection-non-ceph",
        access_manager=True,
        access_browser=True,
        storage_endpoint=endpoint,
        credential_owner_type="s3_user",
        credential_owner_identifier="rgw-account$reporter",
        capabilities_json=json.dumps({"can_manage_iam": False}),
        access_key_id="AK-CONN-NON-CEPH",
        secret_access_key="SK-CONN-NON-CEPH",
    )
    db_session.add_all([user, endpoint, connection])
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
    assert payload.manager_stats_enabled is False
    assert payload.manager_stats_message is not None
    assert "not a ceph provider" in payload.manager_stats_message.lower()


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


def test_manager_context_s3_user_enables_ceph_keys_when_management_possible(db_session, monkeypatch):
    settings = AppSettings()
    settings.general.manager_ceph_s3_user_keys_enabled = True
    monkeypatch.setattr(dependencies, "load_app_settings", lambda: settings)
    monkeypatch.setattr(manager_context_router, "load_app_settings", lambda: settings)

    endpoint = _ceph_s3_user_management_endpoint(name="ceph-s3u-keys-ok")
    user, account = _build_linked_s3_user_context(
        db_session,
        endpoint=endpoint,
        email="manager-ceph-keys-ok@example.com",
    )

    payload = manager_context_router.get_manager_context(account=account, actor=user, db=db_session)
    assert payload.access_mode == "s3_user"
    assert payload.manager_ceph_keys_enabled is True


@pytest.mark.parametrize(
    ("endpoint", "feature_enabled"),
    [
        (_ceph_s3_user_management_endpoint(name="ceph-s3u-keys-missing-admin-keys", admin_access_key=None, admin_secret_key=None), True),
        (_ceph_s3_user_management_endpoint(name="ceph-s3u-keys-non-ceph", provider="other"), True),
        (_ceph_s3_user_management_endpoint(name="ceph-s3u-keys-admin-feature-off", admin_enabled=False), True),
        (_ceph_s3_user_management_endpoint(name="ceph-s3u-keys-admin-endpoint-missing", endpoint_url=""), True),
        (_ceph_s3_user_management_endpoint(name="ceph-s3u-keys-flag-off"), False),
    ],
)
def test_manager_context_s3_user_disables_ceph_keys_when_management_not_possible(
    db_session,
    monkeypatch,
    endpoint: StorageEndpoint,
    feature_enabled: bool,
):
    settings = AppSettings()
    settings.general.manager_ceph_s3_user_keys_enabled = feature_enabled
    monkeypatch.setattr(dependencies, "load_app_settings", lambda: settings)
    monkeypatch.setattr(manager_context_router, "load_app_settings", lambda: settings)

    user, account = _build_linked_s3_user_context(
        db_session,
        endpoint=endpoint,
        email=f"manager-ceph-keys-ko-{endpoint.name}@example.com",
    )

    payload = manager_context_router.get_manager_context(account=account, actor=user, db=db_session)
    assert payload.access_mode == "s3_user"
    assert payload.manager_ceph_keys_enabled is False


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
        features_config="features:\n  admin:\n    enabled: false\n",
    )
    db_session.add_all([user, endpoint])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(endpoint)

    monkeypatch.setattr(ceph_admin_dependencies, "validate_ceph_admin_service_identity", lambda _endpoint: None)

    account = dependencies.get_account_context(
        request=_request("/api/browser/buckets"),
        account_ref=f"ceph-admin-{endpoint.id}",
        actor=user,
        db=db_session,
    )

    assert account.storage_endpoint_id == endpoint.id
    assert account.effective_rgw_credentials() == ("AK-CEPH-ADMIN", "SK-CEPH-ADMIN")


def test_browser_workspace_rejects_ceph_admin_selector_for_invalid_ceph_admin_identity(db_session, monkeypatch):
    settings = AppSettings()
    settings.general.ceph_admin_enabled = True
    settings.general.browser_ceph_admin_enabled = True
    monkeypatch.setattr(dependencies, "load_app_settings", lambda: settings)

    user = User(
        email="ceph-admin-browser-invalid@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
        can_access_ceph_admin=True,
    )
    endpoint = StorageEndpoint(
        name="ceph-endpoint-invalid",
        endpoint_url="https://rgw-invalid.example.com",
        provider="ceph",
        ceph_admin_access_key="AK-CEPH-INVALID",
        ceph_admin_secret_key="SK-CEPH-INVALID",
        features_config="features:\n  admin:\n    enabled: false\n",
    )
    db_session.add_all([user, endpoint])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(endpoint)

    monkeypatch.setattr(
        ceph_admin_dependencies,
        "validate_ceph_admin_service_identity",
        lambda _endpoint: "Ceph Admin workspace is unavailable for endpoint 'ceph-endpoint-invalid': access key does not map to an RGW user.",
    )

    with pytest.raises(HTTPException) as exc:
        dependencies.get_account_context(
            request=_request("/api/browser/buckets"),
            account_ref=f"ceph-admin-{endpoint.id}",
            actor=user,
            db=db_session,
        )

    assert exc.value.status_code == 403
    assert "access key does not map to an RGW user" in str(exc.value.detail)


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
