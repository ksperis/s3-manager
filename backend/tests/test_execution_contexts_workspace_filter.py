# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from datetime import timedelta
from types import SimpleNamespace

import pytest

from app.db import (
    AccountRole,
    S3Account,
    S3Connection,
    S3User,
    StorageEndpoint,
    UiGroup,
    UiGroupS3Account,
    User,
    UserRole,
    UserS3Account,
    UserS3Connection,
    UserS3User,
    UserUiGroup,
)
from app.routers import execution_contexts
from app.models.app_settings import AppSettings, GeneralSettings
from app.services import app_settings_service
from app.services.portal import settings as portal_settings_module
from app.services.portal_service import PortalService
from app.utils.time import utcnow


def _create_user(db_session) -> User:
    user = User(
        email="workspace-filter@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _create_account(
    db_session,
    *,
    name: str,
    rgw_account_id: str,
    storage_endpoint: StorageEndpoint | None = None,
) -> S3Account:
    account = S3Account(
        name=name,
        rgw_account_id=rgw_account_id,
        rgw_access_key=f"AK-{name}",
        rgw_secret_key=f"SK-{name}",
        storage_endpoint=storage_endpoint,
        storage_endpoint_id=storage_endpoint.id if storage_endpoint else None,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def _create_connection(
    db_session,
    *,
    created_by_user_id: int,
    name: str,
    can_manage_iam: bool,
    access_manager: bool = False,
    access_browser: bool = True,
    is_active: bool = True,
    is_shared: bool = False,
    expires_at=None,
    storage_endpoint: StorageEndpoint | None = None,
) -> S3Connection:
    connection = S3Connection(
        created_by_user_id=created_by_user_id,
        name=name,
        is_active=is_active,
        access_manager=access_manager,
        access_browser=access_browser,
        is_shared=is_shared,
        expires_at=expires_at,
        storage_endpoint=storage_endpoint,
        storage_endpoint_id=storage_endpoint.id if storage_endpoint else None,
        custom_endpoint_config=(
            None
            if storage_endpoint
            else json.dumps(
                {
                    "endpoint_url": f"https://{name}.example.test",
                    "force_path_style": False,
                    "provider": None,
                    "region": None,
                    "verify_tls": True,
                }
            )
        ),
        capabilities_json=json.dumps({"can_manage_iam": bool(can_manage_iam)}),
        access_key_id=f"CONN-AK-{name}",
        secret_access_key=f"CONN-SK-{name}",
    )
    db_session.add(connection)
    db_session.commit()
    db_session.refresh(connection)
    return connection


def _create_legacy_user(db_session, *, name: str, uid: str) -> S3User:
    s3_user = S3User(
        name=name,
        rgw_user_uid=uid,
        rgw_access_key=f"S3U-AK-{name}",
        rgw_secret_key=f"S3U-SK-{name}",
    )
    db_session.add(s3_user)
    db_session.commit()
    db_session.refresh(s3_user)
    return s3_user


def _create_endpoint(db_session, *, name: str) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider="ceph",
        features_config=(
            "features:\n"
            "  iam:\n"
            "    enabled: true\n"
            "  admin:\n"
            "    enabled: true\n"
            "  metrics:\n"
            "    enabled: true\n"
            "  usage:\n"
            "    enabled: true\n"
        ),
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def test_manager_workspace_returns_allowed_contexts_including_s3_users(db_session):
    user = _create_user(db_session)
    admin_account = _create_account(db_session, name="admin-account", rgw_account_id="RGWADMIN0001")
    portal_manager_account = _create_account(db_session, name="pm-account", rgw_account_id="RGWPM0001")
    legacy_user = _create_legacy_user(db_session, name="legacy-user", uid="legacy-uid-1")
    manager_connection = _create_connection(
        db_session,
        created_by_user_id=user.id,
        name="mgr-conn",
        can_manage_iam=True,
        access_manager=True,
    )
    browser_only_connection = _create_connection(
        db_session,
        created_by_user_id=user.id,
        name="browser-conn",
        can_manage_iam=False,
        access_manager=False,
    )

    db_session.add_all(
        [
            UserS3Account(
                user_id=user.id,
                account_id=admin_account.id,
                role=AccountRole.ACCOUNT_ADMINISTRATOR.value,
                is_root=False,
            ),
            UserS3Account(
                user_id=user.id,
                account_id=portal_manager_account.id,
                role=AccountRole.PORTAL_MANAGER.value,
                is_root=False,
            ),
            UserS3User(user_id=user.id, s3_user_id=legacy_user.id),
        ]
    )
    db_session.commit()

    contexts = execution_contexts.list_execution_contexts(workspace="manager", user=user, db=db_session)
    context_ids = {context.id for context in contexts}

    assert str(admin_account.id) in context_ids
    assert str(portal_manager_account.id) not in context_ids
    assert f"s3u-{legacy_user.id}" in context_ids
    assert f"conn-{manager_connection.id}" in context_ids
    assert f"conn-{browser_only_connection.id}" not in context_ids
    assert any(context.kind == "legacy_user" for context in contexts)


def test_manager_workspace_catalog_omits_dynamic_quota_limits(db_session):
    user = _create_user(db_session)
    account = _create_account(db_session, name="quota-account", rgw_account_id="RGWQUOTA0001")
    legacy_user = _create_legacy_user(db_session, name="quota-legacy", uid="quota-legacy-uid")
    manager_connection = _create_connection(
        db_session,
        created_by_user_id=user.id,
        name="quota-connection",
        can_manage_iam=True,
        access_manager=True,
    )

    db_session.add_all(
        [
            UserS3Account(
                user_id=user.id,
                account_id=account.id,
                role=AccountRole.ACCOUNT_ADMINISTRATOR.value,
                is_root=False,
            ),
            UserS3User(user_id=user.id, s3_user_id=legacy_user.id),
        ]
    )
    db_session.commit()

    contexts = execution_contexts.list_execution_contexts(workspace="manager", user=user, db=db_session)
    account_context = next(context for context in contexts if context.id == str(account.id))
    legacy_context = next(context for context in contexts if context.id == f"s3u-{legacy_user.id}")
    connection_context = next(context for context in contexts if context.id == f"conn-{manager_connection.id}")

    assert account_context.quota_max_size_gb is None
    assert account_context.quota_max_objects is None
    assert account_context.max_buckets is None
    assert account_context.max_users is None
    assert account_context.max_roles is None
    assert account_context.max_groups is None
    assert legacy_context.quota_max_size_gb is None
    assert legacy_context.quota_max_objects is None
    assert legacy_context.max_buckets is None
    assert legacy_context.max_users is None
    assert legacy_context.max_roles is None
    assert legacy_context.max_groups is None
    assert connection_context.quota_max_size_gb is None
    assert connection_context.quota_max_objects is None
    assert connection_context.max_buckets is None
    assert connection_context.max_users is None
    assert connection_context.max_roles is None
    assert connection_context.max_groups is None


def test_browser_workspace_returns_only_owned_private_connections(db_session):
    user = _create_user(db_session)
    account = _create_account(db_session, name="browser-account", rgw_account_id="RGWBROWSER0001")
    legacy_user = _create_legacy_user(db_session, name="browser-legacy", uid="legacy-uid-2")
    connection_a = _create_connection(db_session, created_by_user_id=user.id, name="browser-conn-a", can_manage_iam=False)
    connection_b = _create_connection(db_session, created_by_user_id=user.id, name="browser-conn-b", can_manage_iam=True)

    db_session.add_all(
        [
            UserS3Account(
                user_id=user.id,
                account_id=account.id,
                role=AccountRole.ACCOUNT_ADMINISTRATOR.value,
                is_root=False,
            ),
            UserS3User(user_id=user.id, s3_user_id=legacy_user.id),
        ]
    )
    db_session.commit()

    contexts = execution_contexts.list_execution_contexts(workspace="browser", user=user, db=db_session)
    context_ids = {context.id for context in contexts}

    assert context_ids == {f"conn-{connection_a.id}", f"conn-{connection_b.id}"}
    assert {context.kind for context in contexts} == {"connection"}


def test_browser_workspace_rejects_shared_and_expired_connections(db_session):
    user = _create_user(db_session)
    shared = _create_connection(
        db_session,
        created_by_user_id=user.id,
        name="legacy-shared-browser",
        can_manage_iam=False,
        access_manager=True,
        access_browser=True,
        is_shared=True,
    )
    expired = _create_connection(
        db_session,
        created_by_user_id=user.id,
        name="expired-private-browser",
        can_manage_iam=False,
        access_browser=True,
        expires_at=utcnow() - timedelta(minutes=1),
    )
    db_session.add(UserS3Connection(user_id=user.id, s3_connection_id=shared.id))
    db_session.commit()

    context_ids = {
        context.id
        for context in execution_contexts.list_execution_contexts(
            workspace="browser",
            user=user,
            db=db_session,
        )
    }

    assert f"conn-{shared.id}" not in context_ids
    assert f"conn-{expired.id}" not in context_ids


def _configure_portal_browser_catalog(monkeypatch, *, enabled: bool) -> AppSettings:
    settings = AppSettings(
        general=GeneralSettings(
            browser_enabled=True,
            browser_root_enabled=True,
            portal_enabled=True,
            browser_portal_enabled=True,
        )
    )
    monkeypatch.setattr(app_settings_service, "load_app_settings", lambda: settings)
    monkeypatch.setattr(
        PortalService,
        "get_effective_portal_settings",
        lambda self, account, **kwargs: SimpleNamespace(browser_access_enabled=enabled),
    )
    return settings


def test_browser_workspace_omits_portal_account_when_project_access_is_disabled(db_session, monkeypatch):
    user = _create_user(db_session)
    endpoint = _create_endpoint(db_session, name="portal-browser-endpoint")
    account = _create_account(
        db_session,
        name="portal-browser-account",
        rgw_account_id="RGWPORTALBROWSER0001",
        storage_endpoint=endpoint,
    )
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            is_root=False,
            role=AccountRole.PORTAL_USER.value,
        )
    )
    db_session.commit()

    _configure_portal_browser_catalog(monkeypatch, enabled=False)

    contexts = execution_contexts.list_execution_contexts(workspace="browser", user=user, db=db_session)

    assert contexts == []


@pytest.mark.parametrize(
    ("role", "expected_portal_role"),
    [
        (AccountRole.PORTAL_USER.value, AccountRole.PORTAL_USER.value),
        (AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_MANAGER.value),
        (AccountRole.ACCOUNT_ADMINISTRATOR.value, AccountRole.PORTAL_MANAGER.value),
    ],
)
def test_browser_workspace_returns_enabled_portal_account_roles(
    db_session,
    monkeypatch,
    role,
    expected_portal_role,
):
    user = _create_user(db_session)
    endpoint = _create_endpoint(db_session, name=f"portal-browser-{role}")
    account = _create_account(
        db_session,
        name=f"portal-browser-{role}",
        rgw_account_id=f"RGW-{role}",
        storage_endpoint=endpoint,
    )
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            is_root=False,
            role=role,
        )
    )
    db_session.commit()
    _configure_portal_browser_catalog(monkeypatch, enabled=True)

    contexts = execution_contexts.list_execution_contexts(workspace="browser", user=user, db=db_session)

    assert len(contexts) == 1
    context = contexts[0]
    assert context.id == str(account.id)
    assert context.kind == "portal_account"
    assert context.role == expected_portal_role
    assert context.manager_account_is_admin is (
        role == AccountRole.ACCOUNT_ADMINISTRATOR.value
    )
    assert context.capabilities.can_manage_iam is False
    assert context.capabilities.admin_api_capable is False


def test_browser_workspace_returns_enabled_group_portal_account(db_session, monkeypatch):
    user = _create_user(db_session)
    endpoint = _create_endpoint(db_session, name="portal-browser-group")
    account = _create_account(
        db_session,
        name="portal-browser-group",
        rgw_account_id="RGW-PORTAL-GROUP",
        storage_endpoint=endpoint,
    )
    group = UiGroup(name="Portal Browser members")
    db_session.add(group)
    db_session.flush()
    db_session.add_all(
        [
            UserUiGroup(user_id=user.id, group_id=group.id),
            UiGroupS3Account(
                group_id=group.id,
                account_id=account.id,
                role=AccountRole.PORTAL_USER.value,
            ),
        ]
    )
    db_session.commit()
    _configure_portal_browser_catalog(monkeypatch, enabled=True)

    contexts = execution_contexts.list_execution_contexts(workspace="browser", user=user, db=db_session)

    assert [(context.id, context.kind, context.role) for context in contexts] == [
        (str(account.id), "portal_account", AccountRole.PORTAL_USER.value)
    ]


@pytest.mark.parametrize(
    ("global_enabled", "account_override", "expected"),
    [
        (False, True, True),
        (True, False, False),
        (False, None, False),
        (True, None, True),
    ],
)
def test_browser_workspace_applies_effective_project_override(
    db_session,
    monkeypatch,
    global_enabled,
    account_override,
    expected,
):
    user = _create_user(db_session)
    endpoint = _create_endpoint(db_session, name=f"portal-override-{global_enabled}-{account_override}")
    account = _create_account(
        db_session,
        name="portal-override-account",
        rgw_account_id="RGW-PORTAL-OVERRIDE",
        storage_endpoint=endpoint,
    )
    if account_override is not None:
        account.portal_settings_override = json.dumps(
            {"browser_access_enabled": account_override}
        )
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            role=AccountRole.PORTAL_USER.value,
        )
    )
    db_session.commit()

    settings = AppSettings(
        general=GeneralSettings(
            browser_enabled=True,
            browser_root_enabled=True,
            portal_enabled=True,
            browser_portal_enabled=True,
        )
    )
    settings.portal.browser_access_enabled = global_enabled
    monkeypatch.setattr(app_settings_service, "load_app_settings", lambda: settings)
    monkeypatch.setattr(portal_settings_module, "load_app_settings", lambda: settings)

    contexts = execution_contexts.list_execution_contexts(workspace="browser", user=user, db=db_session)

    assert (str(account.id) in {context.id for context in contexts}) is expected


@pytest.mark.parametrize(
    "disabled_gate",
    ["browser_enabled", "browser_root_enabled", "portal_enabled", "browser_portal_enabled"],
)
def test_browser_workspace_global_gates_override_enabled_project(
    db_session,
    monkeypatch,
    disabled_gate,
):
    user = _create_user(db_session)
    endpoint = _create_endpoint(db_session, name=f"portal-gate-{disabled_gate}")
    account = _create_account(
        db_session,
        name="portal-gated-account",
        rgw_account_id="RGW-PORTAL-GATED",
        storage_endpoint=endpoint,
    )
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            role=AccountRole.PORTAL_USER.value,
        )
    )
    db_session.commit()
    settings = _configure_portal_browser_catalog(monkeypatch, enabled=True)
    setattr(settings.general, disabled_gate, False)

    contexts = execution_contexts.list_execution_contexts(workspace="browser", user=user, db=db_session)

    assert contexts == []


def test_browser_workspace_never_reuses_manager_account_context(db_session, monkeypatch):
    user = _create_user(db_session)
    endpoint = _create_endpoint(db_session, name="portal-manager-endpoint")
    account = _create_account(
        db_session,
        name="portal-manager-account",
        rgw_account_id="RGWPORTALMANAGER0001",
        storage_endpoint=endpoint,
    )
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            is_root=False,
            role=AccountRole.ACCOUNT_ADMINISTRATOR.value,
        )
    )
    db_session.commit()

    monkeypatch.setattr(
        execution_contexts,
        "load_app_settings",
        lambda: SimpleNamespace(
            general=SimpleNamespace(
                browser_enabled=True,
                portal_enabled=True,
                browser_portal_enabled=True,
            )
        ),
    )

    contexts = execution_contexts.list_execution_contexts(workspace="browser", user=user, db=db_session)

    assert len(contexts) == 1
    context = contexts[0]
    assert context.kind == "portal_account"
    assert context.id == str(account.id)
    assert context.role == AccountRole.PORTAL_MANAGER.value
    assert context.manager_account_is_admin is True
    assert all(candidate.kind != "account" for candidate in contexts)


def test_connection_context_includes_endpoint_capabilities_when_bound_to_endpoint(db_session):
    user = _create_user(db_session)
    endpoint = _create_endpoint(db_session, name="ceph-conn-caps")
    connection = _create_connection(
        db_session,
        created_by_user_id=user.id,
        name="endpoint-backed-conn",
        can_manage_iam=True,
        access_manager=True,
        storage_endpoint=endpoint,
    )

    contexts = execution_contexts.list_execution_contexts(workspace="manager", user=user, db=db_session)
    connection_context = next((context for context in contexts if context.id == f"conn-{connection.id}"), None)

    assert connection_context is not None
    assert connection_context.endpoint_id == endpoint.id
    assert connection_context.storage_endpoint_capabilities is not None
    assert connection_context.storage_endpoint_capabilities.get("metrics") is True
    assert connection_context.storage_endpoint_capabilities.get("usage") is True
    assert connection_context.storage_endpoint_capabilities.get("iam") is True


def test_execution_contexts_exclude_inactive_connections(db_session):
    user = _create_user(db_session)
    active_connection = _create_connection(
        db_session,
        created_by_user_id=user.id,
        name="active-conn",
        can_manage_iam=False,
        access_manager=True,
        access_browser=True,
        is_active=True,
    )
    inactive_connection = _create_connection(
        db_session,
        created_by_user_id=user.id,
        name="inactive-conn",
        can_manage_iam=False,
        access_manager=True,
        access_browser=True,
        is_active=False,
    )

    browser_contexts = execution_contexts.list_execution_contexts(workspace="browser", user=user, db=db_session)
    browser_ids = {context.id for context in browser_contexts}
    assert f"conn-{active_connection.id}" in browser_ids
    assert f"conn-{inactive_connection.id}" not in browser_ids

    manager_contexts = execution_contexts.list_execution_contexts(workspace="manager", user=user, db=db_session)
    manager_ids = {context.id for context in manager_contexts}
    assert f"conn-{active_connection.id}" in manager_ids
    assert f"conn-{inactive_connection.id}" not in manager_ids


def test_workspace_access_defaults_to_browser_for_private_connection_only(db_session, monkeypatch):
    user = _create_user(db_session)
    _create_connection(
        db_session,
        created_by_user_id=user.id,
        name="private-browser-only",
        can_manage_iam=False,
        access_manager=False,
        access_browser=True,
    )
    monkeypatch.setattr(
        execution_contexts,
        "load_app_settings",
        lambda: AppSettings(
            general=GeneralSettings(
                manager_enabled=True,
                browser_enabled=True,
                browser_root_enabled=True,
                portal_enabled=True,
            )
        ),
    )

    access = execution_contexts.get_workspace_access(user=user, db=db_session)

    assert access.manager.available is False
    assert access.browser.available is True
    assert access.browser.context_count == 1
    assert access.portal.available is False
    assert access.default_workspace == "browser"


def test_workspace_access_counts_enabled_portal_project_and_keeps_portal_default(db_session, monkeypatch):
    user = _create_user(db_session)
    endpoint = _create_endpoint(db_session, name="portal-workspace-access")
    account = _create_account(
        db_session,
        name="portal-workspace-access",
        rgw_account_id="RGW-PORTAL-WORKSPACE",
        storage_endpoint=endpoint,
    )
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            role=AccountRole.PORTAL_USER.value,
        )
    )
    db_session.commit()
    settings = _configure_portal_browser_catalog(monkeypatch, enabled=True)
    monkeypatch.setattr(execution_contexts, "load_app_settings", lambda: settings)

    access = execution_contexts.get_workspace_access(user=user, db=db_session)

    assert access.portal.available is True
    assert access.browser.available is True
    assert access.browser.context_count == 1
    assert access.default_workspace == "portal"


def test_workspace_access_excludes_portal_role_on_incompatible_account(db_session, monkeypatch):
    user = _create_user(db_session)
    account = _create_account(
        db_session,
        name="portal-without-endpoint",
        rgw_account_id="RGWINCOMPATIBLEPORTAL0001",
    )
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            role=AccountRole.ACCOUNT_ADMINISTRATOR.value,
            is_root=False,
        )
    )
    db_session.commit()
    settings = _configure_portal_browser_catalog(monkeypatch, enabled=True)
    settings.general.manager_enabled = False
    monkeypatch.setattr(execution_contexts, "load_app_settings", lambda: settings)

    access = execution_contexts.get_workspace_access(user=user, db=db_session)

    assert access.portal.available is False
    assert access.portal.context_count == 0
    assert access.browser.available is False
    assert access.browser.context_count == 0
    assert access.default_workspace is None
