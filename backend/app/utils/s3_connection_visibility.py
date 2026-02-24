# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Helpers to normalize S3 connection visibility semantics."""

from __future__ import annotations

from typing import Literal, Optional

ConnectionVisibility = Literal["private", "shared", "public"]


def normalize_visibility(
    *,
    visibility: Optional[str] = None,
    is_public: Optional[bool] = None,
    is_shared: Optional[bool] = None,
    default: ConnectionVisibility = "private",
) -> ConnectionVisibility:
    if visibility is not None:
        normalized = visibility.strip().lower()
        if normalized in {"private", "shared", "public"}:
            return normalized  # type: ignore[return-value]
        raise ValueError("visibility must be one of: private, shared, public")
    if is_public is True:
        return "public"
    if is_shared is True:
        return "shared"
    if is_public is False or is_shared is False:
        return "private"
    return default


def visibility_from_flags(*, is_public: bool, is_shared: bool) -> ConnectionVisibility:
    if is_public:
        return "public"
    if is_shared:
        return "shared"
    return "private"
