# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import re
from typing import Any, Optional, Tuple

_ACCOUNT_ID_PATTERN = re.compile(r"^RGW\d{17}$", re.IGNORECASE)


def is_rgw_account_id(identifier: Optional[str]) -> bool:
    """Return True when the identifier matches the RGW account-id format."""
    if not identifier:
        return False
    value = identifier.strip()
    if not value:
        return False
    return bool(_ACCOUNT_ID_PATTERN.match(value))


def normalize_rgw_identifier(identifier: Optional[str]) -> Optional[str]:
    if identifier is None:
        return None
    value = str(identifier).strip()
    if not value:
        return None
    if is_rgw_account_id(value):
        return value.upper()
    return value.lower()


def resolve_account_scope(identifier: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """
    Split an RGW identifier into either (account_id, tenant).

    Returns a tuple ``(account_id, tenant)`` where only one of the values is set.
    """
    if not identifier:
        return None, None
    value = identifier.strip()
    if not value:
        return None, None
    if is_rgw_account_id(value):
        return value, None
    return None, value


def extract_bucket_list(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return [entry for entry in payload if isinstance(entry, dict)]
    if isinstance(payload, dict):
        buckets = payload.get("buckets")
        if isinstance(buckets, list):
            return [entry for entry in buckets if isinstance(entry, dict)]
    return []


def resolve_admin_uid(account_id: Optional[str], user_uid: Optional[str]) -> Optional[str]:
    if user_uid:
        normalized = user_uid.strip()
        return normalized or None
    if account_id:
        normalized = normalize_rgw_identifier(account_id)
        if not normalized:
            return None
        return f"{normalized}-admin"
    return None
