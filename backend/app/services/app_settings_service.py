# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from contextlib import contextmanager
from pathlib import Path
import os
import tempfile
import fcntl

from app.core.config import get_settings
from app.models.app_settings import AppSettings, GeneralFeatureLock, GeneralFeatureLocks

DEFAULT_SETTINGS_PATH = Path(__file__).resolve().parents[1] / "data" / "app_settings.json"
_GENERAL_FEATURE_FIELDS = (
    "manager_enabled",
    "ceph_admin_enabled",
    "browser_enabled",
    "portal_enabled",
    "billing_enabled",
    "endpoint_status_enabled",
)


def _settings_path() -> Path:
    settings = get_settings()
    if settings.app_settings_path:
        return Path(settings.app_settings_path)
    return DEFAULT_SETTINGS_PATH


def _settings_lock_path(settings_path: Path) -> Path:
    return settings_path.with_suffix(settings_path.suffix + ".lock")


@contextmanager
def _settings_lock(lock_path: Path, shared: bool) -> None:
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_SH if shared else fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _load_persisted_settings_from_disk(settings_path: Path) -> AppSettings:
    if not settings_path.exists():
        return AppSettings()
    try:
        data = json.loads(settings_path.read_text(encoding="utf-8"))
        return AppSettings(**data)
    except Exception:
        return AppSettings()


def _write_settings_to_disk(settings_path: Path, settings: AppSettings) -> None:
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_file = None
    try:
        tmp_file = tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=str(settings_path.parent),
            prefix=f"{settings_path.name}.",
            suffix=".tmp",
            delete=False,
        )
        tmp_file.write(settings.model_dump_json(indent=2))
        tmp_file.flush()
        os.fsync(tmp_file.fileno())
        tmp_file.close()
        os.replace(tmp_file.name, settings_path)
    finally:
        if tmp_file and os.path.exists(tmp_file.name):
            os.unlink(tmp_file.name)


def get_general_feature_locks() -> GeneralFeatureLocks:
    settings = get_settings()
    locks = GeneralFeatureLocks()

    dedicated_sources = {
        "manager_enabled": ("feature_manager_enabled", "FEATURE_MANAGER_ENABLED"),
        "ceph_admin_enabled": ("feature_ceph_admin_enabled", "FEATURE_CEPH_ADMIN_ENABLED"),
        "browser_enabled": ("feature_browser_enabled", "FEATURE_BROWSER_ENABLED"),
        "portal_enabled": ("feature_portal_enabled", "FEATURE_PORTAL_ENABLED"),
        "billing_enabled": ("feature_billing_enabled", "FEATURE_BILLING_ENABLED"),
        "endpoint_status_enabled": ("feature_endpoint_status_enabled", "FEATURE_ENDPOINT_STATUS_ENABLED"),
    }
    for field_name, (settings_attr, env_name) in dedicated_sources.items():
        forced_value = getattr(settings, settings_attr)
        if forced_value is not None:
            setattr(
                locks,
                field_name,
                GeneralFeatureLock(forced=True, value=bool(forced_value), source=env_name),
            )

    # Backward compatibility: legacy technical flags still force-disable when dedicated
    # feature overrides are not explicitly set.
    if not locks.billing_enabled.forced and not bool(settings.billing_enabled):
        locks.billing_enabled = GeneralFeatureLock(forced=True, value=False, source="BILLING_ENABLED")
    if not locks.endpoint_status_enabled.forced and not bool(settings.healthcheck_enabled):
        locks.endpoint_status_enabled = GeneralFeatureLock(
            forced=True, value=False, source="HEALTHCHECK_ENABLED"
        )

    return locks


def _apply_general_feature_overrides(settings: AppSettings) -> AppSettings:
    effective = settings.model_copy(deep=True)
    locks = get_general_feature_locks()
    for field_name in _GENERAL_FEATURE_FIELDS:
        lock = getattr(locks, field_name)
        if lock.forced and lock.value is not None:
            setattr(effective.general, field_name, bool(lock.value))
    return effective


def load_persisted_app_settings() -> AppSettings:
    settings_path = _settings_path()
    lock_path = _settings_lock_path(settings_path)
    with _settings_lock(lock_path, shared=True):
        return _load_persisted_settings_from_disk(settings_path)


def load_default_app_settings() -> AppSettings:
    return _apply_general_feature_overrides(AppSettings())


def load_app_settings() -> AppSettings:
    return _apply_general_feature_overrides(load_persisted_app_settings())


def save_app_settings(settings: AppSettings) -> AppSettings:
    settings_path = _settings_path()
    lock_path = _settings_lock_path(settings_path)
    with _settings_lock(lock_path, shared=False):
        persisted = _load_persisted_settings_from_disk(settings_path)
        to_save = settings.model_copy(deep=True)
        locks = get_general_feature_locks()
        for field_name in _GENERAL_FEATURE_FIELDS:
            lock = getattr(locks, field_name)
            if lock.forced:
                setattr(to_save.general, field_name, getattr(persisted.general, field_name))
        _write_settings_to_disk(settings_path, to_save)
    return _apply_general_feature_overrides(to_save)
