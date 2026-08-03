# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import re
from urllib.parse import urlparse


LDAP_PROVIDER_ID_PATTERN = re.compile(r"^[a-z0-9_-]+$")
LDAP_PROVIDER_DEFAULT_USER_FILTER = (
    "(|(mail={username})(uid={username})(sAMAccountName={username})"
    "(userPrincipalName={username}))"
)


def normalize_required_ldap_string(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("LDAP provider fields must be strings")
    normalized = value.strip()
    if not normalized:
        raise ValueError("LDAP provider fields cannot be empty")
    return normalized


def normalize_optional_ldap_string(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("LDAP provider fields must be strings")
    normalized = value.strip()
    return normalized or None


def validate_ldap_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in {"ldap", "ldaps"} or not parsed.hostname:
        raise ValueError("LDAP provider url must be an ldap:// or ldaps:// URL")
    return value


def validate_ldap_user_filter(value: str) -> str:
    if "{username}" not in value:
        raise ValueError("LDAP provider user_filter must contain {username}")
    return value
