# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

from app.db import (
    AccountRole,
    S3Account,
    S3Connection,
    S3User,
    StorageEndpoint,
    User,
    UserRole,
    UserS3Account,
    UserS3User,
)
from app.models.app_settings import AppSettings
from app.routers import execution_contexts


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


def _create_account(db_session, *, name: str, rgw_account_id: str) -> S3Account:
    account = S3Account(
        name=name,
        rgw_account_id=rgw_account_id,
        rgw_access_key=f"AK-{name}",
        rgw_secret_key=f"SK-{name}",
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def _create_connection(
    db_session,
    *,
    owner_user_id: int,
    name: str,
    can_manage_iam: bool,
    access_manager: bool = False,
    access_browser: bool = True,
    is_active: bool = True,
    storage_endpoint: StorageEndpoint | None = None,
) -> S3Connection:
    connection = S3Connection(
        owner_user_id=owner_user_id,
        name=name,
        is_active=is_active,
        access_manager=access_manager,
        access_browser=access_browser,
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
        owner_user_id=user.id,
        name="mgr-conn",
        can_manage_iam=True,
        access_manager=True,
    )
    browser_only_connection = _create_connection(
        db_session,
        owner_user_id=user.id,
        name="browser-conn",
        can_manage_iam=False,
        access_manager=False,
    )

    db_session.add_all(
        [
            UserS3Account(
                user_id=user.id,
                account_id=admin_account.id,
                account_role=AccountRole.PORTAL_NONE.value,
                account_admin=True,
                is_root=False,
            ),
            UserS3Account(
                user_id=user.id,
                account_id=portal_manager_account.id,
                account_role=AccountRole.PORTAL_MANAGER.value,
                account_admin=False,
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


def test_manager_workspace_includes_portal_manager_accounts_when_enabled(db_session, monkeypatch):
    user = _create_user(db_session)
    portal_manager_account = _create_account(db_session, name="pm-account-enabled", rgw_account_id="RGWPM0002")
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=portal_manager_account.id,
            account_role=AccountRole.PORTAL_MANAGER.value,
            account_admin=False,
            is_root=False,
        )
    )
    db_session.commit()

    settings = AppSettings()
    settings.general.allow_portal_manager_workspace = True
    monkeypatch.setattr(execution_contexts, "load_app_settings", lambda: settings)

    contexts = execution_contexts.list_execution_contexts(workspace="manager", user=user, db=db_session)
    context_ids = {context.id for context in contexts}
    assert str(portal_manager_account.id) in context_ids


def test_browser_workspace_returns_connections_and_s3_users(db_session):
    user = _create_user(db_session)
    account = _create_account(db_session, name="browser-account", rgw_account_id="RGWBROWSER0001")
    legacy_user = _create_legacy_user(db_session, name="browser-legacy", uid="legacy-uid-2")
    connection_a = _create_connection(db_session, owner_user_id=user.id, name="browser-conn-a", can_manage_iam=False)
    connection_b = _create_connection(db_session, owner_user_id=user.id, name="browser-conn-b", can_manage_iam=True)

    db_session.add_all(
        [
            UserS3Account(
                user_id=user.id,
                account_id=account.id,
                account_role=AccountRole.PORTAL_MANAGER.value,
                account_admin=True,
                is_root=False,
            ),
            UserS3User(user_id=user.id, s3_user_id=legacy_user.id),
        ]
    )
    db_session.commit()

    contexts = execution_contexts.list_execution_contexts(workspace="browser", user=user, db=db_session)
    context_ids = {context.id for context in contexts}

    assert context_ids == {f"s3u-{legacy_user.id}", f"conn-{connection_a.id}", f"conn-{connection_b.id}"}
    assert {context.kind for context in contexts} == {"legacy_user", "connection"}


def test_connection_context_includes_endpoint_capabilities_when_bound_to_endpoint(db_session):
    user = _create_user(db_session)
    endpoint = _create_endpoint(db_session, name="ceph-conn-caps")
    connection = _create_connection(
        db_session,
        owner_user_id=user.id,
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
        owner_user_id=user.id,
        name="active-conn",
        can_manage_iam=False,
        access_manager=True,
        access_browser=True,
        is_active=True,
    )
    inactive_connection = _create_connection(
        db_session,
        owner_user_id=user.id,
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
