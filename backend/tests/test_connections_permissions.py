# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import User, UserRole
from app.routers.connections import _ensure_private_connections_allowed


def _user(role: str) -> User:
    return User(
        email=f"{role}@example.com",
        hashed_password="x",
        is_active=True,
        role=role,
    )


def _settings(allowed: bool):
    return SimpleNamespace(general=SimpleNamespace(allow_user_private_connections=allowed))


def test_connections_allowed_for_admin_even_if_flag_disabled(monkeypatch):
    monkeypatch.setattr("app.routers.connections.load_app_settings", lambda: _settings(False))
    _ensure_private_connections_allowed(_user(UserRole.UI_ADMIN.value))


def test_connections_allowed_for_ui_user_when_flag_enabled(monkeypatch):
    monkeypatch.setattr("app.routers.connections.load_app_settings", lambda: _settings(True))
    _ensure_private_connections_allowed(_user(UserRole.UI_USER.value))


def test_connections_forbidden_for_ui_user_when_flag_disabled(monkeypatch):
    monkeypatch.setattr("app.routers.connections.load_app_settings", lambda: _settings(False))
    with pytest.raises(HTTPException) as exc:
        _ensure_private_connections_allowed(_user(UserRole.UI_USER.value))
    assert exc.value.status_code == 403


def test_connections_forbidden_for_unassigned_user(monkeypatch):
    monkeypatch.setattr("app.routers.connections.load_app_settings", lambda: _settings(True))
    with pytest.raises(HTTPException) as exc:
        _ensure_private_connections_allowed(_user(UserRole.UI_NONE.value))
    assert exc.value.status_code == 403
