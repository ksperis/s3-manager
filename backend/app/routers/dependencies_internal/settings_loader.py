# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import sys

from app.services.app_settings_service import load_app_settings as _load_app_settings


def load_app_settings():
    facade = sys.modules.get("app.routers.dependencies")
    if facade is not None:
        loader = getattr(facade, "load_app_settings", None)
        if callable(loader) and loader is not load_app_settings:
            return loader()
    return _load_app_settings()
