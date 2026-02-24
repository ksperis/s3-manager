# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import (
    AccountRole,
    S3Account,
    S3Connection,
    S3User,
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


def _create_connection(db_session, *, owner_user_id: int, name: str, iam_capable: bool) -> S3Connection:
    connection = S3Connection(
        owner_user_id=owner_user_id,
        name=name,
        iam_capable=iam_capable,
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


def test_manager_workspace_returns_only_allowed_contexts(db_session):
    user = _create_user(db_session)
    admin_account = _create_account(db_session, name="admin-account", rgw_account_id="RGWADMIN0001")
    portal_manager_account = _create_account(db_session, name="pm-account", rgw_account_id="RGWPM0001")
    legacy_user = _create_legacy_user(db_session, name="legacy-user", uid="legacy-uid-1")
    manager_connection = _create_connection(db_session, owner_user_id=user.id, name="mgr-conn", iam_capable=True)
    browser_only_connection = _create_connection(db_session, owner_user_id=user.id, name="browser-conn", iam_capable=False)

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
    assert f"conn-{manager_connection.id}" in context_ids
    assert f"conn-{browser_only_connection.id}" not in context_ids
    assert all(context.kind != "legacy_user" for context in contexts)


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


def test_browser_workspace_returns_only_connections(db_session):
    user = _create_user(db_session)
    account = _create_account(db_session, name="browser-account", rgw_account_id="RGWBROWSER0001")
    legacy_user = _create_legacy_user(db_session, name="browser-legacy", uid="legacy-uid-2")
    connection_a = _create_connection(db_session, owner_user_id=user.id, name="browser-conn-a", iam_capable=False)
    connection_b = _create_connection(db_session, owner_user_id=user.id, name="browser-conn-b", iam_capable=True)

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

    assert context_ids == {f"conn-{connection_a.id}", f"conn-{connection_b.id}"}
    assert all(context.kind == "connection" for context in contexts)
