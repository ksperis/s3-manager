# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Canonical RGW account association role utilities."""

from __future__ import annotations

from typing import Annotated

from pydantic import AfterValidator

from app.db.enums import AccountRole


ACCOUNT_ROLE_RANK: dict[str, int] = {
    AccountRole.PORTAL_USER.value: 1,
    AccountRole.PORTAL_MANAGER.value: 2,
    AccountRole.ACCOUNT_ADMINISTRATOR.value: 3,
}
ACCOUNT_ROLE_VALUES = frozenset(ACCOUNT_ROLE_RANK)


def normalize_account_role(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(getattr(value, "value", value) or "").strip().lower()
    return normalized or None


def require_account_role(value: object) -> str:
    normalized = normalize_account_role(value)
    if normalized not in ACCOUNT_ROLE_VALUES:
        raise ValueError("Invalid account role")
    return normalized


CanonicalAccountRole = Annotated[str, AfterValidator(require_account_role)]


def portal_role_for(role: object) -> str | None:
    normalized = normalize_account_role(role)
    if normalized == AccountRole.ACCOUNT_ADMINISTRATOR.value:
        return AccountRole.PORTAL_MANAGER.value
    if normalized in {AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value}:
        return normalized
    return None


def max_account_role(*roles: object) -> str | None:
    normalized = [normalize_account_role(role) for role in roles]
    valid = [role for role in normalized if role in ACCOUNT_ROLE_VALUES]
    if not valid:
        return None
    return max(valid, key=lambda role: ACCOUNT_ROLE_RANK[role])
