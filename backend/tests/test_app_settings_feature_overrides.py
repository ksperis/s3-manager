# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.db import AppSetting
from app.models.app_settings import AppSettings, BrandingSettings
from app.services import app_settings_service


def _runtime_settings(**overrides):
    defaults = {
        "app_settings_path": None,
        "feature_manager_enabled": None,
        "feature_browser_enabled": None,
        "feature_portal_enabled": None,
        "feature_ceph_admin_enabled": None,
        "feature_storage_ops_enabled": None,
        "feature_billing_enabled": None,
        "feature_endpoint_status_enabled": None,
        "billing_enabled": True,
        "healthcheck_enabled": True,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _use_settings_db(monkeypatch, db_session) -> None:
    @contextmanager
    def _session():
        yield db_session

    monkeypatch.setattr(app_settings_service, "_open_settings_session", _session)


def _raw_db_settings(db_session) -> dict:
    row = db_session.query(AppSetting).filter(AppSetting.key == app_settings_service.APP_SETTINGS_DB_KEY).one()
    return json.loads(row.payload_json)


def test_load_app_settings_applies_feature_env_overrides(monkeypatch, tmp_path, db_session):
    settings_path = tmp_path / "app_settings.json"
    persisted = AppSettings()
    persisted.general.manager_enabled = False
    persisted.general.browser_enabled = True
    persisted.general.portal_enabled = False
    persisted.general.ceph_admin_enabled = True
    settings_path.write_text(persisted.model_dump_json(indent=2), encoding="utf-8")

    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    _use_settings_db(monkeypatch, db_session)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(
            feature_manager_enabled=True,
            feature_browser_enabled=False,
            feature_portal_enabled=True,
        ),
    )

    effective = app_settings_service.load_app_settings()
    assert effective.general.manager_enabled is True
    assert effective.general.browser_enabled is False
    assert effective.general.portal_enabled is True
    # Not forced: persisted value is preserved.
    assert effective.general.ceph_admin_enabled is True
    assert _raw_db_settings(db_session)["general"]["ceph_admin_enabled"] is True


def test_save_app_settings_keeps_persisted_value_for_locked_features(monkeypatch, tmp_path, db_session):
    settings_path = tmp_path / "app_settings.json"
    persisted = AppSettings()
    persisted.general.manager_enabled = False
    persisted.general.billing_enabled = True
    settings_path.write_text(persisted.model_dump_json(indent=2), encoding="utf-8")

    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    _use_settings_db(monkeypatch, db_session)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(feature_manager_enabled=True, feature_billing_enabled=False),
    )

    payload = AppSettings()
    payload.general.manager_enabled = True
    payload.general.billing_enabled = False
    saved_effective = app_settings_service.save_app_settings(payload)

    raw = _raw_db_settings(db_session)
    # Locked fields keep persisted values in storage.
    assert raw["general"]["manager_enabled"] is False
    assert raw["general"]["billing_enabled"] is True
    # Returned settings expose effective forced values.
    assert saved_effective.general.manager_enabled is True
    assert saved_effective.general.billing_enabled is False


def test_app_settings_json_bootstrap_imports_once_to_db(monkeypatch, tmp_path, db_session):
    settings_path = tmp_path / "app_settings.json"
    legacy = AppSettings()
    legacy.general.browser_enabled = False
    settings_path.write_text(legacy.model_dump_json(indent=2), encoding="utf-8")

    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    _use_settings_db(monkeypatch, db_session)
    monkeypatch.setattr(app_settings_service, "get_settings", lambda: _runtime_settings())

    imported = app_settings_service.load_persisted_app_settings()
    assert imported.general.browser_enabled is False

    settings_path.unlink()
    loaded_again = app_settings_service.load_persisted_app_settings()
    assert loaded_again.general.browser_enabled is False
    assert db_session.query(AppSetting).count() == 1


def test_app_settings_db_errors_are_not_hidden_by_disk_fallback(monkeypatch):
    def _broken_session():
        raise RuntimeError("settings db unavailable")

    monkeypatch.setattr(app_settings_service, "_open_settings_session", _broken_session)

    with pytest.raises(RuntimeError, match="settings db unavailable"):
        app_settings_service.load_persisted_app_settings()
    with pytest.raises(RuntimeError, match="settings db unavailable"):
        app_settings_service.save_app_settings(AppSettings())


def test_general_feature_locks_only_use_dedicated_feature_sources(monkeypatch):
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(
            feature_manager_enabled=False,
            feature_portal_enabled=True,
            feature_billing_enabled=None,
            feature_endpoint_status_enabled=None,
            billing_enabled=False,
            healthcheck_enabled=False,
        ),
    )

    locks = app_settings_service.get_general_feature_locks()
    assert locks.manager_enabled.forced is True
    assert locks.manager_enabled.value is False
    assert locks.manager_enabled.source == "FEATURE_MANAGER_ENABLED"

    assert locks.portal_enabled.forced is True
    assert locks.portal_enabled.value is True
    assert locks.portal_enabled.source == "FEATURE_PORTAL_ENABLED"

    assert locks.billing_enabled.forced is False
    assert locks.billing_enabled.value is None
    assert locks.billing_enabled.source is None

    assert locks.endpoint_status_enabled.forced is False
    assert locks.endpoint_status_enabled.value is None
    assert locks.endpoint_status_enabled.source is None


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


def test_portal_feature_flag_default_disabled():
    settings = AppSettings()
    assert settings.general.portal_enabled is False


def test_bucket_integrity_check_flag_default_enabled():
    settings = AppSettings()
    assert settings.general.bucket_integrity_check_enabled is True


def test_bucket_purge_flag_default_disabled():
    settings = AppSettings()
    assert settings.general.bucket_purge_enabled is False


def test_portal_storage_space_version_cleanup_default_enabled():
    settings = AppSettings()
    assert settings.portal.storage_space_version_cleanup_enabled is True


def test_bucket_compare_flag_default_enabled():
    settings = AppSettings()
    assert settings.general.bucket_compare_enabled is True


def test_endpoint_status_and_usage_history_default_enabled():
    settings = AppSettings()
    assert settings.general.endpoint_status_enabled is True
    assert settings.general.usage_history_enabled is True


def test_portal_manager_bucket_create_policy_normalizes_to_session_actions():
    settings = AppSettings(
        portal={
            "iam_group_manager_policy": {
                "actions": ["s3:ListAllMyBuckets", "s3:CreateBucket"],
                "advanced_policy": None,
            },
        }
    )

    assert settings.portal.iam_group_manager_policy.actions == ["s3:ListAllMyBuckets", "sts:GetSessionToken"]


def test_portal_manager_create_bucket_only_policy_normalizes_to_session_actions():
    settings = AppSettings(
        portal={
            "iam_group_manager_policy": {
                "actions": ["s3:CreateBucket"],
                "advanced_policy": None,
            },
        }
    )

    assert settings.portal.iam_group_manager_policy.actions == ["s3:ListAllMyBuckets", "sts:GetSessionToken"]


def test_portal_browser_flag_default_enabled():
    settings = AppSettings()
    assert settings.general.browser_portal_enabled is True


def test_manager_ceph_s3_user_keys_flag_persists(monkeypatch, tmp_path, db_session):
    settings_path = tmp_path / "app_settings.json"
    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    _use_settings_db(monkeypatch, db_session)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(),
    )

    payload = AppSettings()
    payload.general.manager_ceph_s3_user_keys_enabled = True
    saved = app_settings_service.save_app_settings(payload)
    loaded = app_settings_service.load_app_settings()
    raw = _raw_db_settings(db_session)

    assert saved.general.manager_ceph_s3_user_keys_enabled is True
    assert loaded.general.manager_ceph_s3_user_keys_enabled is True
    assert raw["general"]["manager_ceph_s3_user_keys_enabled"] is True


def test_bucket_integrity_check_flag_persists(monkeypatch, tmp_path, db_session):
    settings_path = tmp_path / "app_settings.json"
    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    _use_settings_db(monkeypatch, db_session)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(),
    )

    payload = AppSettings()
    payload.general.bucket_integrity_check_enabled = True
    saved = app_settings_service.save_app_settings(payload)
    loaded = app_settings_service.load_app_settings()
    raw = _raw_db_settings(db_session)

    assert saved.general.bucket_integrity_check_enabled is True
    assert loaded.general.bucket_integrity_check_enabled is True
    assert raw["general"]["bucket_integrity_check_enabled"] is True


def test_bucket_purge_flag_persists(monkeypatch, tmp_path, db_session):
    settings_path = tmp_path / "app_settings.json"
    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    _use_settings_db(monkeypatch, db_session)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(),
    )

    payload = AppSettings()
    payload.general.bucket_purge_enabled = True
    saved = app_settings_service.save_app_settings(payload)
    loaded = app_settings_service.load_app_settings()
    raw = _raw_db_settings(db_session)

    assert saved.general.bucket_purge_enabled is True
    assert loaded.general.bucket_purge_enabled is True
    assert raw["general"]["bucket_purge_enabled"] is True
