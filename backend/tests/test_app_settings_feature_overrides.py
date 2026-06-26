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
    persisted.general.billing_enabled = False
    persisted.general.endpoint_status_enabled = True
    settings_path.write_text(persisted.model_dump_json(indent=2), encoding="utf-8")

    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(
            feature_billing_enabled=True,
            feature_endpoint_status_enabled=False,
        ),
    )

    effective = app_settings_service.load_app_settings()
    assert effective.general.billing_enabled is True
    assert effective.general.endpoint_status_enabled is False


def test_save_app_settings_keeps_persisted_value_for_locked_features(monkeypatch, tmp_path):
    settings_path = tmp_path / "app_settings.json"
    persisted = AppSettings()
    persisted.general.billing_enabled = True
    persisted.general.endpoint_status_enabled = True
    settings_path.write_text(persisted.model_dump_json(indent=2), encoding="utf-8")

    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(feature_billing_enabled=False, feature_endpoint_status_enabled=False),
    )

    payload = AppSettings()
    payload.general.billing_enabled = False
    payload.general.endpoint_status_enabled = False
    saved_effective = app_settings_service.save_app_settings(payload)

    raw = json.loads(settings_path.read_text(encoding="utf-8"))
    # Locked fields keep persisted values in storage.
    assert raw["general"]["billing_enabled"] is True
    assert raw["general"]["endpoint_status_enabled"] is True
    # Returned settings expose effective forced values.
    assert saved_effective.general.billing_enabled is False
    assert saved_effective.general.endpoint_status_enabled is False


def test_general_feature_locks_only_use_dedicated_feature_sources(monkeypatch):
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(
            feature_billing_enabled=False,
            feature_endpoint_status_enabled=True,
            billing_enabled=False,
            healthcheck_enabled=False,
        ),
    )

    locks = app_settings_service.get_general_feature_locks()
    assert locks.billing_enabled.forced is True
    assert locks.billing_enabled.value is False
    assert locks.billing_enabled.source == "FEATURE_BILLING_ENABLED"

    assert locks.endpoint_status_enabled.forced is True
    assert locks.endpoint_status_enabled.value is True
    assert locks.endpoint_status_enabled.source == "FEATURE_ENDPOINT_STATUS_ENABLED"


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


def test_manager_ceph_s3_user_keys_flag_default_enabled():
    settings = AppSettings()
    assert settings.general.manager_ceph_s3_user_keys_enabled is True


def test_bucket_integrity_check_flag_default_enabled():
    settings = AppSettings()
    assert settings.general.bucket_integrity_check_enabled is True


def test_bucket_purge_flag_default_disabled():
    settings = AppSettings()
    assert settings.general.bucket_purge_enabled is False


def test_bucket_compare_flag_default_enabled():
    settings = AppSettings()
    assert settings.general.bucket_compare_enabled is True


def test_endpoint_status_and_usage_history_default_enabled():
    settings = AppSettings()
    assert settings.general.endpoint_status_enabled is True
    assert settings.general.usage_history_enabled is True


def test_portal_manager_legacy_bucket_create_policy_normalizes_to_session_actions():
    settings = AppSettings(
        portal={
            "iam_group_manager_policy": {
                "actions": ["s3:ListAllMyBuckets", "s3:CreateBucket"],
                "advanced_policy": None,
            },
        }
    )

    assert settings.portal.iam_group_manager_policy.actions == ["s3:ListAllMyBuckets", "sts:GetSessionToken"]


def test_manager_ceph_s3_user_keys_flag_persists(monkeypatch, tmp_path):
    settings_path = tmp_path / "app_settings.json"
    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(),
    )

    payload = AppSettings()
    payload.general.manager_ceph_s3_user_keys_enabled = True
    saved = app_settings_service.save_app_settings(payload)
    loaded = app_settings_service.load_app_settings()
    raw = json.loads(settings_path.read_text(encoding="utf-8"))

    assert saved.general.manager_ceph_s3_user_keys_enabled is True
    assert loaded.general.manager_ceph_s3_user_keys_enabled is True
    assert raw["general"]["manager_ceph_s3_user_keys_enabled"] is True


def test_bucket_integrity_check_flag_persists(monkeypatch, tmp_path):
    settings_path = tmp_path / "app_settings.json"
    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(),
    )

    payload = AppSettings()
    payload.general.bucket_integrity_check_enabled = True
    saved = app_settings_service.save_app_settings(payload)
    loaded = app_settings_service.load_app_settings()
    raw = json.loads(settings_path.read_text(encoding="utf-8"))

    assert saved.general.bucket_integrity_check_enabled is True
    assert loaded.general.bucket_integrity_check_enabled is True
    assert raw["general"]["bucket_integrity_check_enabled"] is True


def test_bucket_purge_flag_persists(monkeypatch, tmp_path):
    settings_path = tmp_path / "app_settings.json"
    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(),
    )

    payload = AppSettings()
    payload.general.bucket_purge_enabled = True
    saved = app_settings_service.save_app_settings(payload)
    loaded = app_settings_service.load_app_settings()
    raw = json.loads(settings_path.read_text(encoding="utf-8"))

    assert saved.general.bucket_purge_enabled is True
    assert loaded.general.bucket_purge_enabled is True
    assert raw["general"]["bucket_purge_enabled"] is True
