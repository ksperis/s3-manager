# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi.testclient import TestClient

from app.db import AccountRole, AuditLog, S3Account, User, UserRole, UserS3Account
from app.main import app
from app.models.portal import PortalStorageSpaceSettings
from app.routers import dependencies
from app.routers.dependencies import AccountAccess, AccountCapabilities
from app.routers.dependencies_internal.portal_access import _portal_membership_capabilities
from app.services.portal_service import PortalService
from tests.s3_account_factory import make_s3_account


def _seed(db_session, *, delegated: bool = False):
    account = make_s3_account(
        db_session,
        name="portal-settings-project",
        rgw_account_id="RGW-PORTAL-SETTINGS",
        portal_settings_delegated=delegated,
    )
    user = User(
        email="portal-settings@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add_all([account, user])
    db_session.commit()
    return account, user


def _install_access(account: S3Account, user: User, role: str) -> None:
    is_manager = role == AccountRole.PORTAL_MANAGER.value
    app.dependency_overrides[dependencies.require_portal_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_portal_account_access] = lambda: AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=role,
        capabilities=AccountCapabilities(
            can_manage_buckets=is_manager,
            can_manage_portal_users=is_manager,
        ),
    )


def test_project_settings_are_read_only_without_delegation(client: TestClient, db_session):
    account, manager = _seed(db_session)
    _install_access(account, manager, AccountRole.PORTAL_MANAGER.value)

    fetched = client.get(f"/api/portal/settings?account_id={account.id}")
    updated = client.put(
        f"/api/portal/settings?account_id={account.id}",
        json={"allow_private_storage_space_create": False},
    )

    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["can_update"] is False
    assert fetched.json()["delegated_to_portal_managers"] is False
    assert updated.status_code == 403
    assert "delegation" in updated.json()["detail"].lower()


def test_account_administrator_projects_to_portal_manager_for_settings():
    role, capabilities = _portal_membership_capabilities(
        UserS3Account(role=AccountRole.ACCOUNT_ADMINISTRATOR.value)
    )

    assert role == AccountRole.PORTAL_MANAGER.value
    assert capabilities.can_manage_buckets is True
    assert capabilities.can_manage_portal_users is True


def test_portal_user_cannot_update_delegated_project_settings(client: TestClient, db_session):
    account, user = _seed(db_session, delegated=True)
    _install_access(account, user, AccountRole.PORTAL_USER.value)

    response = client.put(
        f"/api/portal/settings?account_id={account.id}",
        json={"allow_private_storage_space_create": False},
    )

    assert response.status_code == 403
    assert "manager" in response.json()["detail"].lower()


def test_delegated_manager_updates_shared_override_and_audits(
    client: TestClient,
    db_session,
    monkeypatch,
):
    account, manager = _seed(db_session, delegated=True)
    _install_access(account, manager, AccountRole.PORTAL_MANAGER.value)
    monkeypatch.setattr(
        PortalService,
        "reconcile_portal_server_access_logging",
        lambda *_args, **_kwargs: None,
    )

    response = client.put(
        f"/api/portal/settings?account_id={account.id}",
        json={
            "allow_private_storage_space_create": False,
            "bucket_defaults": {"noncurrent_version_expiration_days": 45},
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["can_update"] is True
    assert body["project_override"]["allow_private_storage_space_create"] is False
    assert body["project_override"]["bucket_defaults"]["noncurrent_version_expiration_days"] == 45
    audit = db_session.query(AuditLog).filter(AuditLog.action == "update_project_portal_settings").one()
    assert audit.scope == "portal"
    assert audit.account_id == account.id
    assert audit.user_id == manager.id


def test_storage_space_settings_routes_return_capability_and_audit_updates(
    client: TestClient,
    db_session,
    monkeypatch,
):
    account, manager = _seed(db_session)
    _install_access(account, manager, AccountRole.PORTAL_MANAGER.value)
    current = PortalStorageSpaceSettings(
        versioning_enabled=True,
        versioning_status="Enabled",
        lifecycle_enabled=True,
        version_history_retention_days=90,
        can_update=True,
    )
    monkeypatch.setattr(PortalService, "get_storage_space_settings", lambda *_args, **_kwargs: current)
    monkeypatch.setattr(PortalService, "update_storage_space_settings", lambda *_args, **_kwargs: current)

    fetched = client.get(
        f"/api/portal/storage-spaces/research-data/settings?account_id={account.id}"
    )
    updated = client.put(
        f"/api/portal/storage-spaces/research-data/settings?account_id={account.id}",
        json={
            "versioning_enabled": True,
            "lifecycle_enabled": True,
            "version_history_retention_days": 90,
        },
    )

    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["can_update"] is True
    assert updated.status_code == 200, updated.text
    audit = db_session.query(AuditLog).filter(AuditLog.action == "update_storage_space_settings").one()
    assert audit.entity_id == "research-data"
    assert "version_history_retention_days" in (audit.metadata_json or "")
