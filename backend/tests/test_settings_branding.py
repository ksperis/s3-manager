# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

from app.db import User, UserRole
from app.main import app
from app.models.app_settings import AppSettings
from app.routers import dependencies
from app.services import app_settings_service


def _superadmin_user() -> User:
    return User(
        id=3001,
        email="superadmin@example.com",
        full_name="Super Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )


def test_get_public_branding_settings_without_auth(client, monkeypatch, tmp_path):
    settings_path = tmp_path / "app_settings.json"
    persisted = AppSettings()
    persisted.branding.primary_color = "#123abc"
    settings_path.write_text(persisted.model_dump_json(indent=2), encoding="utf-8")
    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)

    response = client.get("/api/settings/branding")
    assert response.status_code == 200, response.text
    assert response.json() == {"primary_color": "#123abc", "login_logo_url": None}


def test_put_admin_settings_rejects_invalid_branding_color(client, monkeypatch, tmp_path):
    settings_path = tmp_path / "app_settings.json"
    settings_path.write_text(AppSettings().model_dump_json(indent=2), encoding="utf-8")
    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    app.dependency_overrides[dependencies.get_current_user] = _superadmin_user
    app.dependency_overrides.pop(dependencies.get_current_ui_superadmin, None)

    payload = AppSettings().model_dump(mode="json")
    payload["branding"]["primary_color"] = "blue"
    response = client.put("/api/admin/settings", json=payload)
    assert response.status_code == 422, response.text


def test_put_admin_settings_rejects_invalid_branding_logo_url(client, monkeypatch, tmp_path):
    settings_path = tmp_path / "app_settings.json"
    settings_path.write_text(AppSettings().model_dump_json(indent=2), encoding="utf-8")
    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    app.dependency_overrides[dependencies.get_current_user] = _superadmin_user
    app.dependency_overrides.pop(dependencies.get_current_ui_superadmin, None)

    payload = AppSettings().model_dump(mode="json")
    payload["branding"]["login_logo_url"] = "logo.svg"
    response = client.put("/api/admin/settings", json=payload)
    assert response.status_code == 422, response.text


def test_put_admin_settings_persists_branding_color(client, monkeypatch, tmp_path):
    settings_path = tmp_path / "app_settings.json"
    settings_path.write_text(AppSettings().model_dump_json(indent=2), encoding="utf-8")
    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    app.dependency_overrides[dependencies.get_current_user] = _superadmin_user
    app.dependency_overrides.pop(dependencies.get_current_ui_superadmin, None)

    payload = AppSettings().model_dump(mode="json")
    payload["branding"]["primary_color"] = "#0057b8"
    payload["branding"]["login_logo_url"] = "https://cdn.example.com/logo.svg"
    response = client.put("/api/admin/settings", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["branding"]["primary_color"] == "#0057b8"
    assert response.json()["branding"]["login_logo_url"] == "https://cdn.example.com/logo.svg"

    raw = json.loads(settings_path.read_text(encoding="utf-8"))
    assert raw["branding"]["primary_color"] == "#0057b8"
    assert raw["branding"]["login_logo_url"] == "https://cdn.example.com/logo.svg"
