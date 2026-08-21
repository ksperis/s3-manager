# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Shared helpers for Ceph Admin RGW profile routes."""

from typing import Any

from fastapi import HTTPException, status


def nullable_update(value: Any, field: str, field_set: set[str], cleared_value: Any) -> Any:
    """Map omitted values to no-op and explicit nulls to the RGW clearing value."""

    if field not in field_set:
        return None
    return value if value is not None else cleared_value


def raise_if_unsupported(result: object, detail: str) -> None:
    """Translate RGW capability sentinel responses into the API error contract."""

    if isinstance(result, dict) and (result.get("not_found") or result.get("not_implemented")):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)
