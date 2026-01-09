# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from pathlib import Path

from app.core.config import get_settings
from app.models.app_settings import AppSettings

DEFAULT_SETTINGS_PATH = Path(__file__).resolve().parents[1] / "data" / "app_settings.json"


def _settings_path() -> Path:
    settings = get_settings()
    if settings.app_settings_path:
        return Path(settings.app_settings_path)
    return DEFAULT_SETTINGS_PATH


def load_app_settings() -> AppSettings:
    settings_path = _settings_path()
    if not settings_path.exists():
        return AppSettings()
    try:
        data = json.loads(settings_path.read_text(encoding="utf-8"))
        return AppSettings(**data)
    except Exception:
        return AppSettings()


def save_app_settings(settings: AppSettings) -> AppSettings:
    settings_path = _settings_path()
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(settings.model_dump_json(indent=2), encoding="utf-8")
    return settings
