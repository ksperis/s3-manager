# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import re

_ACCOUNT_ID_PATTERN = re.compile(r"^RGW\d{17}$", re.IGNORECASE)


def is_rgw_account_id(identifier: str | None) -> bool:
    if not identifier:
        return False
    value = identifier.strip()
    return bool(value and _ACCOUNT_ID_PATTERN.match(value))


def normalize_rgw_identifier(identifier: str | None) -> str | None:
    if identifier is None:
        return None
    value = str(identifier).strip()
    if not value:
        return None
    if is_rgw_account_id(value):
        return value.upper()
    return value.lower()


def resolve_account_scope(identifier: str | None) -> tuple[str | None, str | None]:
    if not identifier:
        return None, None
    value = identifier.strip()
    if not value:
        return None, None
    if is_rgw_account_id(value):
        return value, None
    return None, value


def resolve_admin_uid(account_id: str | None, user_uid: str | None) -> str | None:
    if user_uid:
        normalized = user_uid.strip()
        return normalized or None
    if account_id:
        normalized = normalize_rgw_identifier(account_id)
        if normalized:
            return f"{normalized}-admin"
    return None
