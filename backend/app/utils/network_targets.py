# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import ipaddress
import socket
from typing import Iterable, Optional
from urllib.parse import urlparse

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


def resolve_hostname_ips(host: str) -> set[IPAddress]:
    normalized_host = str(host or "").strip().lower().rstrip(".")
    if not normalized_host:
        return set()

    resolved: set[IPAddress] = set()
    for _, _, _, _, sockaddr in socket.getaddrinfo(normalized_host, None):
        try:
            resolved.add(ipaddress.ip_address(sockaddr[0]))
        except Exception:  # noqa: BLE001
            continue
    return resolved


def is_private_or_local_ip(address: IPAddress) -> bool:
    return bool(
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_unspecified
        or address.is_reserved
    )


def validate_outbound_url(
    url: str,
    *,
    field_name: str,
    allowed_schemes: Iterable[str] = ("https",),
    scheme_label: Optional[str] = None,
    allowed_hosts: Optional[set[str]] = None,
    allow_private_targets: bool = False,
    private_target_hint: Optional[str] = None,
) -> None:
    parsed = urlparse(url)
    normalized_schemes = {str(scheme).strip().lower() for scheme in allowed_schemes if str(scheme).strip()}
    if not normalized_schemes:
        normalized_schemes = {"https"}
    display_scheme = scheme_label or "/".join(sorted(normalized_schemes))

    if parsed.scheme not in normalized_schemes or not parsed.netloc or not parsed.hostname:
        raise ValueError(f"{field_name} must be a valid {display_scheme} URL")
    if parsed.username or parsed.password:
        raise ValueError(f"{field_name} must not include user credentials")

    host = parsed.hostname.strip().lower().rstrip(".")
    if allowed_hosts and not _host_allowed(host, allowed_hosts):
        raise ValueError(f"{field_name} host is not allowed by policy")

    try:
        resolved_ips = resolve_hostname_ips(host)
    except socket.gaierror as exc:
        raise ValueError(f"{field_name} host cannot be resolved: {exc}") from exc
    if not resolved_ips:
        raise ValueError(f"{field_name} host cannot be resolved")

    if not allow_private_targets and any(is_private_or_local_ip(address) for address in resolved_ips):
        raise ValueError(f"{field_name} resolves to a private or local network address{private_target_hint or ''}")


def _host_allowed(host: str, allowed_hosts: set[str]) -> bool:
    normalized_host = str(host or "").strip().lower().rstrip(".")
    if not normalized_host:
        return False
    for allowed in allowed_hosts:
        normalized_allowed = str(allowed or "").strip().lower().rstrip(".")
        if not normalized_allowed:
            continue
        if normalized_host == normalized_allowed or normalized_host.endswith(f".{normalized_allowed}"):
            return True
    return False
