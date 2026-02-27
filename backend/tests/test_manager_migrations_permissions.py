# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import User, UserRole
from app.routers.dependencies import _ensure_bucket_migration_allowed


def _user(role: str) -> User:
    return User(
        email=f"{role}@example.com",
        hashed_password="x",
        is_active=True,
        role=role,
    )


def _settings(*, enabled: bool, allow_ui_user: bool):
    return SimpleNamespace(
        general=SimpleNamespace(
            bucket_migration_enabled=enabled,
            allow_ui_user_bucket_migration=allow_ui_user,
        )
    )


def test_bucket_migration_allowed_for_admin_when_feature_enabled(monkeypatch):
    monkeypatch.setattr("app.routers.dependencies.load_app_settings", lambda: _settings(enabled=True, allow_ui_user=False))
    _ensure_bucket_migration_allowed(_user(UserRole.UI_ADMIN.value))


def test_bucket_migration_allowed_for_ui_user_when_explicitly_enabled(monkeypatch):
    monkeypatch.setattr("app.routers.dependencies.load_app_settings", lambda: _settings(enabled=True, allow_ui_user=True))
    _ensure_bucket_migration_allowed(_user(UserRole.UI_USER.value))


def test_bucket_migration_forbidden_for_ui_user_by_default(monkeypatch):
    monkeypatch.setattr("app.routers.dependencies.load_app_settings", lambda: _settings(enabled=True, allow_ui_user=False))
    with pytest.raises(HTTPException) as exc:
        _ensure_bucket_migration_allowed(_user(UserRole.UI_USER.value))
    assert exc.value.status_code == 403


def test_bucket_migration_forbidden_when_feature_disabled(monkeypatch):
    monkeypatch.setattr("app.routers.dependencies.load_app_settings", lambda: _settings(enabled=False, allow_ui_user=True))
    with pytest.raises(HTTPException) as exc:
        _ensure_bucket_migration_allowed(_user(UserRole.UI_ADMIN.value))
    assert exc.value.status_code == 403
    assert "feature is disabled" in str(exc.value.detail).lower()


def test_bucket_migration_forbidden_for_unassigned_user(monkeypatch):
    monkeypatch.setattr("app.routers.dependencies.load_app_settings", lambda: _settings(enabled=True, allow_ui_user=True))
    with pytest.raises(HTTPException) as exc:
        _ensure_bucket_migration_allowed(_user(UserRole.UI_NONE.value))
    assert exc.value.status_code == 403
