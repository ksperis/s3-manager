# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional
from urllib.parse import urlparse

from fastapi import Request


def normalize_origin(value: Optional[str]) -> Optional[str]:
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if not candidate or candidate.lower() == "null":
        return None
    parsed = urlparse(candidate)
    scheme = (parsed.scheme or "").lower()
    netloc = (parsed.netloc or "").strip()
    if scheme not in {"http", "https"} or not netloc:
        return None
    return f"{scheme}://{netloc}"


def resolve_request_origin(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    direct = normalize_origin(request.headers.get("origin"))
    if direct:
        return direct
    referer = request.headers.get("referer")
    if not isinstance(referer, str):
        return None
    parsed = urlparse(referer.strip())
    if not parsed.scheme or not parsed.netloc:
        return None
    return normalize_origin(f"{parsed.scheme}://{parsed.netloc}")
