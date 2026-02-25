# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

import json
from typing import Any, Optional


def parse_s3_connection_capabilities(raw: Optional[str]) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def s3_connection_can_manage_iam(raw: Optional[str]) -> bool:
    caps = parse_s3_connection_capabilities(raw)
    current = caps.get("can_manage_iam")
    if isinstance(current, bool):
        return current
    return False


def dump_s3_connection_capabilities(
    raw: Optional[str],
    *,
    can_manage_iam: bool,
) -> str:
    caps = parse_s3_connection_capabilities(raw)
    caps["can_manage_iam"] = bool(can_manage_iam)
    caps.pop("iam_capable", None)
    return json.dumps(caps)
