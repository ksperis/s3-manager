# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
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
    UserS3User,
)
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
    storage_endpoint: StorageEndpoint | None = None,
) -> S3Connection:
    connection = S3Connection(
        created_by_user_id=created_by_user_id,
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
                account_admin=True,
                is_root=False,
            ),
            UserS3Account(
                user_id=user.id,
                account_id=portal_manager_account.id,
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


def test_manager_workspace_exposes_quota_limits_for_kpi_cards(db_session, monkeypatch):
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
                account_admin=True,
                is_root=False,
            ),
            UserS3User(user_id=user.id, s3_user_id=legacy_user.id),
        ]
    )
    db_session.commit()

    class _FakeAccountLimitsService:
        def get_account_limits(self, target_account):
            assert target_account.id == account.id
            return 10, 2_000, 8, 20, 12, 6

    class _FakeS3UsersService:
        def __init__(self, db):
            self.db = db

        def get_user_limits(self, target_user):
            assert target_user.id == legacy_user.id
            return 2.5, 600, 3

    monkeypatch.setattr(
        execution_contexts,
        "get_s3_accounts_service",
        lambda db, allow_missing_admin=False: _FakeAccountLimitsService(),
    )
    monkeypatch.setattr(execution_contexts, "S3UsersService", _FakeS3UsersService)

    contexts = execution_contexts.list_execution_contexts(workspace="manager", user=user, db=db_session)
    account_context = next(context for context in contexts if context.id == str(account.id))
    legacy_context = next(context for context in contexts if context.id == f"s3u-{legacy_user.id}")
    connection_context = next(context for context in contexts if context.id == f"conn-{manager_connection.id}")

    assert account_context.quota_max_size_gb == 10
    assert account_context.quota_max_objects == 2_000
    assert account_context.max_buckets == 8
    assert account_context.max_users == 20
    assert account_context.max_roles == 12
    assert account_context.max_groups == 6
    assert legacy_context.quota_max_size_gb == 2.5
    assert legacy_context.quota_max_objects == 600
    assert legacy_context.max_buckets == 3
    assert legacy_context.max_users is None
    assert legacy_context.max_roles is None
    assert legacy_context.max_groups is None
    assert connection_context.quota_max_size_gb is None
    assert connection_context.quota_max_objects is None
    assert connection_context.max_buckets is None
    assert connection_context.max_users is None
    assert connection_context.max_roles is None
    assert connection_context.max_groups is None


def test_browser_workspace_returns_connections_and_s3_users(db_session):
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


def test_browser_workspace_returns_portal_account_context_when_portal_browser_enabled(db_session, monkeypatch):
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
            account_admin=False,
            is_root=False,
            account_role=AccountRole.PORTAL_USER.value,
        )
    )
    db_session.commit()

    class _FakeAccountLimitsService:
        def get_account_limits(self, target_account):
            assert target_account.id == account.id
            return 12, 1_500, 7, 0, 0, 0

    monkeypatch.setattr(
        execution_contexts,
        "get_s3_accounts_service",
        lambda db, allow_missing_admin=False: _FakeAccountLimitsService(),
    )
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
    assert context.display_name == account.name
    assert context.account_role == AccountRole.PORTAL_USER.value
    assert context.manager_account_is_admin is False
    assert context.quota_max_size_gb == 12
    assert context.quota_max_objects == 1_500
    assert context.max_buckets == 7
    assert context.capabilities.can_manage_iam is False
    assert context.capabilities.admin_api_capable is False


def test_browser_workspace_marks_portal_context_when_account_is_available_in_manager(db_session, monkeypatch):
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
            account_admin=True,
            is_root=False,
            account_role=AccountRole.PORTAL_MANAGER.value,
        )
    )
    db_session.commit()

    class _FakeAccountLimitsService:
        def get_account_limits(self, target_account):
            assert target_account.id == account.id
            return None, None, None, None, None, None

    monkeypatch.setattr(
        execution_contexts,
        "get_s3_accounts_service",
        lambda db, allow_missing_admin=False: _FakeAccountLimitsService(),
    )
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
    assert context.manager_account_is_admin is True


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
