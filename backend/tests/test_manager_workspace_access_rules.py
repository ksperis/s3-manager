# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import AccountRole, S3Connection, User, UserRole, UserS3Account
from app.models.app_settings import AppSettings
from app.routers import dependencies


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


def test_manager_workspace_rejects_non_iam_connection(db_session):
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
        iam_capable=False,
        access_key_id="AK-CONN",
        secret_access_key="SK-CONN",
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
    assert "IAM-capable S3Connection is required in manager workspace" in str(exc.value.detail)
