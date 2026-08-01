# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Canonical RGW account association roles and the temporary legacy adapter."""

from __future__ import annotations

from typing import Any

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


def legacy_role_to_canonical(
    *,
    account_admin: object = None,
    account_role: object = None,
) -> str | None:
    legacy_role = normalize_account_role(account_role)
    if legacy_role == "portal_none":
        legacy_role = None
    if legacy_role not in {None, AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value}:
        raise ValueError("Invalid legacy account role")
    if account_admin is True:
        return AccountRole.ACCOUNT_ADMINISTRATOR.value
    if account_admin not in {None, False}:
        raise ValueError("Invalid legacy account_admin value")
    return legacy_role


def adapt_legacy_role_payload(
    payload: Any,
    *,
    require_explicit: bool,
) -> Any:
    """Convert legacy association fields at the API boundary.

    Canonical and legacy fields may coexist only when they resolve to the same
    role. The legacy fields remain in the payload for deprecated response
    compatibility, but application services consume only ``role``.
    """

    if not isinstance(payload, dict):
        return payload
    data = dict(payload)
    has_role = "role" in data and data.get("role") is not None
    has_legacy = "account_admin" in data or "account_role" in data
    canonical = require_account_role(data.get("role")) if has_role else None
    legacy = (
        legacy_role_to_canonical(
            account_admin=data.get("account_admin"),
            account_role=data.get("account_role"),
        )
        if has_legacy
        else None
    )
    if canonical is not None and has_legacy and canonical != legacy:
        raise ValueError("Canonical and legacy account roles are contradictory")
    resolved = canonical or legacy
    if resolved is None and require_explicit:
        raise ValueError("An explicit account role is required")
    if resolved is not None:
        data["role"] = resolved
    return data


def legacy_fields_for_role(role: object) -> tuple[bool, str]:
    normalized = require_account_role(role)
    if normalized == AccountRole.ACCOUNT_ADMINISTRATOR.value:
        return True, AccountRole.PORTAL_MANAGER.value
    return False, normalized
