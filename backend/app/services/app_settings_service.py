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
from app.models.app_settings import AppSettings

DEFAULT_SETTINGS_PATH = Path(__file__).resolve().parents[1] / "data" / "app_settings.json"


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


def load_app_settings() -> AppSettings:
    settings_path = _settings_path()
    lock_path = _settings_lock_path(settings_path)
    with _settings_lock(lock_path, shared=True):
        if not settings_path.exists():
            return AppSettings()
        try:
            data = json.loads(settings_path.read_text(encoding="utf-8"))
            return AppSettings(**data)
        except Exception:
            return AppSettings()


def save_app_settings(settings: AppSettings) -> AppSettings:
    settings_path = _settings_path()
    lock_path = _settings_lock_path(settings_path)
    with _settings_lock(lock_path, shared=False):
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
    return settings
