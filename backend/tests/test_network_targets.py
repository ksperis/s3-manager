# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import socket

import pytest

from app.utils.network_targets import validate_outbound_url


def _set_resolved_ips(monkeypatch, ips: list[str]) -> None:
    def fake_getaddrinfo(host: str, port: object):
        _ = host, port
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443))
            for ip in ips
        ]

    monkeypatch.setattr("app.utils.network_targets.socket.getaddrinfo", fake_getaddrinfo)


def test_validate_outbound_url_accepts_public_https_url(monkeypatch):
    _set_resolved_ips(monkeypatch, ["93.184.216.34"])

    validate_outbound_url(
        "https://s3.example.test",
        field_name="Endpoint URL",
        allowed_schemes=("https",),
        scheme_label="https",
    )


def test_validate_outbound_url_rejects_http_scheme(monkeypatch):
    _set_resolved_ips(monkeypatch, ["93.184.216.34"])

    with pytest.raises(ValueError, match="valid https URL"):
        validate_outbound_url(
            "http://s3.example.test",
            field_name="Endpoint URL",
            allowed_schemes=("https",),
            scheme_label="https",
        )


def test_validate_outbound_url_rejects_credentials(monkeypatch):
    _set_resolved_ips(monkeypatch, ["93.184.216.34"])

    with pytest.raises(ValueError, match="must not include user credentials"):
        validate_outbound_url(
            "https://user:pass@s3.example.test",
            field_name="Endpoint URL",
            allowed_schemes=("https",),
            scheme_label="https",
        )


def test_validate_outbound_url_rejects_unresolved_host(monkeypatch):
    def raise_gaierror(host: str, port: object):
        _ = host, port
        raise socket.gaierror("Name or service not known")

    monkeypatch.setattr("app.utils.network_targets.socket.getaddrinfo", raise_gaierror)

    with pytest.raises(ValueError, match="host cannot be resolved"):
        validate_outbound_url(
            "https://missing.example.test",
            field_name="Endpoint URL",
            allowed_schemes=("https",),
            scheme_label="https",
        )


@pytest.mark.parametrize("ip_address", ["127.0.0.1", "10.0.0.12", "169.254.10.20"])
def test_validate_outbound_url_rejects_private_or_local_targets(monkeypatch, ip_address: str):
    _set_resolved_ips(monkeypatch, [ip_address])

    with pytest.raises(ValueError, match="private or local network address"):
        validate_outbound_url(
            "https://unsafe.example.test",
            field_name="Endpoint URL",
            allowed_schemes=("https",),
            scheme_label="https",
        )
