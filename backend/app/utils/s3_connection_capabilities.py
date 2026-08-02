# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

import json
from typing import Any


DEFAULT_S3_CONNECTION_CAPABILITIES_JSON = '{"can_manage_iam":false}'


def parse_s3_connection_capabilities(raw: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ValueError("S3 connection capabilities must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise ValueError("S3 connection capabilities must be a JSON object")
    if not isinstance(parsed.get("can_manage_iam"), bool):
        raise ValueError("S3 connection capabilities must define boolean can_manage_iam")
    return parsed


def s3_connection_can_manage_iam(raw: str) -> bool:
    return parse_s3_connection_capabilities(raw)["can_manage_iam"]


def dump_s3_connection_capabilities(
    raw: str,
    *,
    can_manage_iam: bool,
) -> str:
    caps = parse_s3_connection_capabilities(raw)
    caps["can_manage_iam"] = bool(can_manage_iam)
    return json.dumps(caps)
