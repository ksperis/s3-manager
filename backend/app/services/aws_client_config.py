# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Literal, Optional

from botocore.config import Config

from app.core.config import get_settings


StorageRequestProfile = Literal["interactive", "long_running"]


def build_aws_config(
    *,
    request_profile: StorageRequestProfile = "interactive",
    signature_version: str = "s3v4",
    s3: Optional[dict[str, Any]] = None,
    user_agent_extra: Optional[str] = None,
) -> Config:
    """Return the bounded Botocore profile selected for the storage operation."""

    settings = get_settings()
    kwargs: dict[str, Any] = {
        "signature_version": signature_version,
        "connect_timeout": float(settings.storage_interactive_connect_timeout_seconds),
        "read_timeout": float(
            settings.storage_long_running_read_timeout_seconds
            if request_profile == "long_running"
            else settings.storage_interactive_read_timeout_seconds
        ),
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


def build_interactive_aws_config(
    *,
    signature_version: str = "s3v4",
    s3: Optional[dict[str, Any]] = None,
    user_agent_extra: Optional[str] = None,
) -> Config:
    return build_aws_config(
        request_profile="interactive",
        signature_version=signature_version,
        s3=s3,
        user_agent_extra=user_agent_extra,
    )


def build_long_running_aws_config(
    *,
    signature_version: str = "s3v4",
    s3: Optional[dict[str, Any]] = None,
    user_agent_extra: Optional[str] = None,
) -> Config:
    return build_aws_config(
        request_profile="long_running",
        signature_version=signature_version,
        s3=s3,
        user_agent_extra=user_agent_extra,
    )
