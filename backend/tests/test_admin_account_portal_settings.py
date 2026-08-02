# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json

from app.db import S3Account
from app.main import app
from app.models.app_settings import AppSettings
from app.routers.admin import s3_accounts as admin_accounts_router
from app.services.portal import settings as portal_settings_module


class _CapturingAuditService:
    def __init__(self) -> None:
        self.actions: list[dict] = []

    def record_action(self, **kwargs):  # noqa: ANN003
        self.actions.append(kwargs)


def _seed_account(db_session, *, overrides: dict | None = None) -> S3Account:
    account = S3Account(
        name="portal-admin-account",
        rgw_account_id="RGW-PORTAL-ADMIN",
        rgw_access_key="AK",
        rgw_secret_key="SK",
        portal_settings_override=json.dumps(overrides) if overrides else None,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def test_admin_get_account_portal_settings_returns_account_overrides(client, db_session):
    account = _seed_account(
        db_session,
        overrides={
            "admin": {"allow_private_storage_space_create": False},
            "portal_manager": {"allow_portal_user_access_key_create": True},
        },
    )

    response = client.get(f"/api/admin/accounts/{account.id}/portal-settings")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["admin_override"]["allow_private_storage_space_create"] is False
    assert "portal_manager_override" not in body
    assert "override_policy" not in body
    assert body["delegated_to_portal_managers"] is False


def test_admin_put_account_portal_settings_replaces_legacy_portal_manager_override_and_audits(client, db_session):
    audit = _CapturingAuditService()
    app.dependency_overrides[admin_accounts_router.get_audit_logger] = lambda: audit
    account = _seed_account(
        db_session,
        overrides={
            "portal_manager": {
                "allow_portal_user_access_key_create": True,
                "bucket_defaults": {"enable_cors": True},
            },
        },
    )

    response = client.put(
        f"/api/admin/accounts/{account.id}/portal-settings",
        json={
            "browser_access_enabled": True,
            "allow_private_storage_space_create": False,
            "bucket_defaults": {
                "versioning": True,
                "noncurrent_version_expiration_days": 45,
            },
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["admin_override"]["browser_access_enabled"] is True
    assert body["effective"]["browser_access_enabled"] is True
    assert body["admin_override"]["allow_private_storage_space_create"] is False
    assert body["admin_override"]["bucket_defaults"]["versioning"] is True
    assert body["admin_override"]["bucket_defaults"]["noncurrent_version_expiration_days"] == 45
    assert body["effective"]["bucket_defaults"]["noncurrent_version_expiration_days"] == 45
    assert "portal_manager_override" not in body
    assert "override_policy" not in body

    db_session.refresh(account)
    stored = json.loads(account.portal_settings_override)
    assert stored["admin"]["browser_access_enabled"] is True
    assert stored["admin"]["allow_private_storage_space_create"] is False
    assert "portal_manager" not in stored

    assert len(audit.actions) == 1
    assert audit.actions[0]["action"] == "update_account_portal_settings"
    assert audit.actions[0]["scope"] == "admin"
    assert audit.actions[0]["account_id"] == account.id
    assert audit.actions[0]["metadata"]["admin_override"]["bucket_defaults"]["versioning"] is True


def test_account_browser_override_can_disable_enabled_global_default(client, db_session, monkeypatch):
    settings = AppSettings()
    settings.portal.browser_access_enabled = True
    monkeypatch.setattr(portal_settings_module, "load_app_settings", lambda: settings)
    account = _seed_account(
        db_session,
        overrides={"admin": {"browser_access_enabled": False}},
    )

    response = client.get(f"/api/admin/accounts/{account.id}/portal-settings")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["admin_override"]["browser_access_enabled"] is False
    assert body["effective"]["browser_access_enabled"] is False


def test_admin_put_account_portal_settings_rejects_non_positive_expiration_days(client, db_session):
    account = _seed_account(db_session)

    response = client.put(
        f"/api/admin/accounts/{account.id}/portal-settings",
        json={"bucket_defaults": {"noncurrent_version_expiration_days": 0}},
    )

    assert response.status_code == 422, response.text


def test_admin_can_delegate_shared_portal_overrides(client, db_session):
    account = _seed_account(
        db_session,
        overrides={"admin": {"allow_private_storage_space_create": False}},
    )

    response = client.put(
        f"/api/admin/accounts/{account.id}/portal-settings",
        json={
            "delegated_to_portal_managers": True,
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["admin_override"]["allow_private_storage_space_create"] is False
    assert body["delegated_to_portal_managers"] is True
    db_session.refresh(account)
    assert account.portal_settings_delegated is True


def test_admin_account_portal_settings_returns_404_for_unknown_account(client):
    response = client.get("/api/admin/accounts/999999/portal-settings")

    assert response.status_code == 404
