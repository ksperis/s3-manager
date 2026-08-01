# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from datetime import timedelta
from types import SimpleNamespace

from app.db import (
    AccountRole,
    S3Account,
    S3Connection,
    S3User,
    StorageEndpoint,
    User,
    UserRole,
    UserS3Account,
    UserS3Connection,
    UserS3User,
)
from app.routers import execution_contexts
from app.models.app_settings import AppSettings, GeneralSettings
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


def test_browser_workspace_never_returns_portal_account_context(db_session, monkeypatch):
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

    assert contexts == []


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
    monkeypatch.setattr(
        execution_contexts,
        "load_app_settings",
        lambda: AppSettings(
            general=GeneralSettings(
                manager_enabled=False,
                browser_enabled=True,
                browser_root_enabled=True,
                portal_enabled=True,
            )
        ),
    )

    access = execution_contexts.get_workspace_access(user=user, db=db_session)

    assert access.portal.available is False
    assert access.portal.context_count == 0
    assert access.default_workspace is None
