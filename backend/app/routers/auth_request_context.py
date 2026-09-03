# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from fastapi import Request

from app.core.config import Settings
from app.utils.request_security import client_ip


def request_context(
    request: Request,
    *,
    settings: Settings,
) -> tuple[str, Optional[str], Optional[str]]:
    return (
        client_ip(request, settings),
        request.headers.get("user-agent"),
        request.headers.get("x-request-id"),
    )
