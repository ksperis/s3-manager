# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.models.app_settings import AppSettings, BrandingSettings
from app.services import app_settings_service


def _runtime_settings(**overrides):
    defaults = {
        "app_settings_path": None,
        "feature_manager_enabled": None,
        "feature_browser_enabled": None,
        "feature_portal_enabled": None,
        "feature_ceph_admin_enabled": None,
        "feature_billing_enabled": None,
        "feature_endpoint_status_enabled": None,
        "billing_enabled": True,
        "healthcheck_enabled": True,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_load_app_settings_applies_feature_env_overrides(monkeypatch, tmp_path):
    settings_path = tmp_path / "app_settings.json"
    persisted = AppSettings()
    persisted.general.manager_enabled = False
    persisted.general.browser_enabled = True
    persisted.general.portal_enabled = True
    settings_path.write_text(persisted.model_dump_json(indent=2), encoding="utf-8")

    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(feature_manager_enabled=True, feature_browser_enabled=False),
    )

    effective = app_settings_service.load_app_settings()
    assert effective.general.manager_enabled is True
    assert effective.general.browser_enabled is False
    # Not forced: persisted value is preserved.
    assert effective.general.portal_enabled is True


def test_save_app_settings_keeps_persisted_value_for_locked_features(monkeypatch, tmp_path):
    settings_path = tmp_path / "app_settings.json"
    persisted = AppSettings()
    persisted.general.manager_enabled = False
    persisted.general.billing_enabled = True
    settings_path.write_text(persisted.model_dump_json(indent=2), encoding="utf-8")

    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(feature_manager_enabled=True, feature_billing_enabled=False),
    )

    payload = AppSettings()
    payload.general.manager_enabled = True
    payload.general.billing_enabled = False
    saved_effective = app_settings_service.save_app_settings(payload)

    raw = json.loads(settings_path.read_text(encoding="utf-8"))
    # Locked fields keep persisted values in storage.
    assert raw["general"]["manager_enabled"] is False
    assert raw["general"]["billing_enabled"] is True
    # Returned settings expose effective forced values.
    assert saved_effective.general.manager_enabled is True
    assert saved_effective.general.billing_enabled is False


def test_general_feature_locks_include_dedicated_and_legacy_sources(monkeypatch):
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(
            feature_portal_enabled=False,
            feature_billing_enabled=None,
            feature_endpoint_status_enabled=None,
            billing_enabled=False,
            healthcheck_enabled=False,
        ),
    )

    locks = app_settings_service.get_general_feature_locks()
    assert locks.portal_enabled.forced is True
    assert locks.portal_enabled.value is False
    assert locks.portal_enabled.source == "FEATURE_PORTAL_ENABLED"

    assert locks.billing_enabled.forced is True
    assert locks.billing_enabled.value is False
    assert locks.billing_enabled.source == "BILLING_ENABLED"

    assert locks.endpoint_status_enabled.forced is True
    assert locks.endpoint_status_enabled.value is False
    assert locks.endpoint_status_enabled.source == "HEALTHCHECK_ENABLED"


def test_branding_settings_defaults_and_normalizes_hex():
    assert BrandingSettings().primary_color == "#0ea5e9"
    assert BrandingSettings().login_logo_url is None
    assert BrandingSettings(primary_color="  #A1B2C3 ").primary_color == "#a1b2c3"
    assert BrandingSettings(login_logo_url="  https://cdn.example.com/logo.svg ").login_logo_url == "https://cdn.example.com/logo.svg"
    assert BrandingSettings(login_logo_url="   ").login_logo_url is None
    assert AppSettings(branding={"primary_color": ""}).branding.primary_color == "#0ea5e9"


def test_branding_settings_reject_invalid_hex():
    with pytest.raises(ValidationError):
        BrandingSettings(primary_color="blue")


def test_branding_settings_reject_invalid_logo_url():
    with pytest.raises(ValidationError):
        BrandingSettings(login_logo_url="logo.svg")
