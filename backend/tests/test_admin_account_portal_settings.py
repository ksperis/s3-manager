# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json

from app.db import S3Account
from app.main import app
from app.routers.admin import s3_accounts as admin_accounts_router


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
            "admin": {"allow_portal_user_bucket_create": False},
            "portal_manager": {"allow_portal_user_access_key_create": True},
        },
    )

    response = client.get(f"/api/admin/accounts/{account.id}/portal-settings")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["admin_override"]["allow_portal_user_bucket_create"] is False
    assert body["portal_manager_override"]["allow_portal_user_access_key_create"] is True


def test_admin_put_account_portal_settings_preserves_portal_manager_override_and_audits(client, db_session):
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
            "allow_portal_user_bucket_create": False,
            "bucket_defaults": {"versioning": True},
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["admin_override"]["allow_portal_user_bucket_create"] is False
    assert body["admin_override"]["bucket_defaults"]["versioning"] is True
    assert body["portal_manager_override"]["allow_portal_user_access_key_create"] is True
    assert body["portal_manager_override"]["bucket_defaults"]["enable_cors"] is True

    db_session.refresh(account)
    stored = json.loads(account.portal_settings_override)
    assert stored["admin"]["allow_portal_user_bucket_create"] is False
    assert stored["portal_manager"]["allow_portal_user_access_key_create"] is True

    assert len(audit.actions) == 1
    assert audit.actions[0]["action"] == "update_account_portal_settings"
    assert audit.actions[0]["scope"] == "admin"
    assert audit.actions[0]["account_id"] == account.id
    assert audit.actions[0]["metadata"]["admin_override"]["bucket_defaults"]["versioning"] is True


def test_admin_account_portal_settings_returns_404_for_unknown_account(client):
    response = client.get("/api/admin/accounts/999999/portal-settings")

    assert response.status_code == 404
