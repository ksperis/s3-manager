# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import ipaddress
from typing import Optional

from fastapi import HTTPException, Request, status

from app.core.config import Settings, get_settings


def client_ip(request: Request, settings: Optional[Settings] = None) -> str:
    settings = settings or get_settings()
    direct = request.client.host if request.client else "unknown"
    try:
        direct_address = ipaddress.ip_address(direct)
    except ValueError:
        return direct
    trusted = any(
        direct_address in ipaddress.ip_network(cidr, strict=False)
        for cidr in settings.trusted_proxy_cidrs
    )
    if not trusted:
        return direct
    forwarded = request.headers.get("x-forwarded-for", "")
    candidates = [value.strip() for value in forwarded.split(",") if value.strip()]
    # Walk the chain from the direct peer towards the client and discard only
    # explicitly trusted proxy hops. This prevents an attacker-controlled
    # left-most value from bypassing per-IP controls when a proxy appends XFF.
    for candidate in reversed(candidates):
        try:
            address = ipaddress.ip_address(candidate)
        except ValueError:
            continue
        if any(
            address in ipaddress.ip_network(cidr, strict=False)
            for cidr in settings.trusted_proxy_cidrs
        ):
            continue
        return candidate
    return direct


def require_trusted_origin(request: Request, settings: Optional[Settings] = None) -> None:
    settings = settings or get_settings()
    origin = request.headers.get("origin")
    if origin != settings.public_origin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Untrusted request origin")
