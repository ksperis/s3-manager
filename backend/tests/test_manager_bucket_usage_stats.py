# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.db import User, UserRole
from app.models.app_settings import AppSettings
from app.routers import dependencies as dependencies_router


def _manager_user(*, role: str = UserRole.UI_USER.value) -> User:
    return User(
        email="usage-stats-tool@example.com",
        hashed_password="x",
        is_active=True,
        role=role,
    )


def test_require_bucket_usage_stats_enabled_blocks_when_feature_disabled(monkeypatch):
    settings = AppSettings()
    settings.general.bucket_usage_stats_enabled = False
    monkeypatch.setattr(dependencies_router, "load_app_settings", lambda: settings)

    with pytest.raises(HTTPException) as exc:
        dependencies_router.require_bucket_usage_stats_enabled(_manager_user())

    assert exc.value.status_code == 403
    assert "bucket usage stats feature is disabled" in str(exc.value.detail).lower()


def test_require_bucket_usage_stats_enabled_blocks_non_manager_roles(monkeypatch):
    settings = AppSettings()
    settings.general.bucket_usage_stats_enabled = True
    monkeypatch.setattr(dependencies_router, "load_app_settings", lambda: settings)

    with pytest.raises(HTTPException) as exc:
        dependencies_router.require_bucket_usage_stats_enabled(_manager_user(role=UserRole.UI_NONE.value))

    assert exc.value.status_code == 403
    assert str(exc.value.detail) == "Not authorized"


def test_require_bucket_usage_stats_enabled_allows_manager_user_without_tool_access(monkeypatch):
    settings = AppSettings()
    settings.general.bucket_usage_stats_enabled = True
    monkeypatch.setattr(dependencies_router, "load_app_settings", lambda: settings)

    assert dependencies_router.require_bucket_usage_stats_enabled(_manager_user()).email == "usage-stats-tool@example.com"
