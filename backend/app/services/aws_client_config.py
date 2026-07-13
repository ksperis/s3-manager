# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from botocore.config import Config

from app.core.config import get_settings


def build_interactive_aws_config(
    *,
    signature_version: str = "s3v4",
    s3: Optional[dict[str, Any]] = None,
    user_agent_extra: Optional[str] = None,
) -> Config:
    """Return the bounded Botocore profile used by interactive UI requests."""

    settings = get_settings()
    kwargs: dict[str, Any] = {
        "signature_version": signature_version,
        "connect_timeout": float(settings.storage_interactive_connect_timeout_seconds),
        "read_timeout": float(settings.storage_interactive_read_timeout_seconds),
        "retries": {
            "mode": "standard",
            "total_max_attempts": int(settings.storage_interactive_max_attempts),
        },
    }
    if s3:
        kwargs["s3"] = s3
    if user_agent_extra:
        kwargs["user_agent_extra"] = user_agent_extra
    return Config(**kwargs)
