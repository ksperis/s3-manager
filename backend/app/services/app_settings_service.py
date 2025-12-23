# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from pathlib import Path

from app.models.app_settings import AppSettings

SETTINGS_PATH = Path(__file__).resolve().parents[1] / "data" / "app_settings.json"
SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)


def load_app_settings() -> AppSettings:
    if not SETTINGS_PATH.exists():
        return AppSettings()
    try:
        data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        return AppSettings(**data)
    except Exception:
        return AppSettings()


def save_app_settings(settings: AppSettings) -> AppSettings:
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(settings.model_dump_json(indent=2), encoding="utf-8")
    return settings
