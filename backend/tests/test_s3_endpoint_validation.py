# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import ipaddress

import pytest

from app.db import StorageEndpoint, StorageProvider
from app.utils import s3_endpoint
from app.utils.s3_endpoint import (
    resolve_iam_client_options,
    resolve_s3_client_kwargs,
    resolve_s3_client_options,
    validate_custom_login_s3_endpoint,
    validate_user_supplied_s3_endpoint,
)
from app.utils.storage_endpoint_features import AWS_IAM_ENDPOINT, AWS_S3_ENDPOINT


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("https://s3.example.test/", "https://s3.example.test")],
)
def test_validate_custom_login_s3_endpoint_accepts_expected_urls(monkeypatch, raw: str, expected: str):
    monkeypatch.setattr(s3_endpoint, "validate_outbound_url", lambda *args, **kwargs: None)
    assert validate_custom_login_s3_endpoint(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "ftp://s3.example.test",
        "http://localhost:9000",
        "https://user:pass@s3.example.test",
        "https://s3.example.test?x=1",
        "https://s3.example.test#frag",
        "https:///missing-host",
    ],
)
def test_validate_custom_login_s3_endpoint_rejects_unsafe_urls(monkeypatch, raw: str):
    monkeypatch.setattr(s3_endpoint, "validate_outbound_url", lambda *args, **kwargs: None)
    with pytest.raises(ValueError):
        validate_custom_login_s3_endpoint(raw)


def test_production_user_supplied_endpoint_requires_operator_allowlist(monkeypatch):
    monkeypatch.setattr(s3_endpoint.settings, "app_env", "production")
    monkeypatch.setattr(s3_endpoint.settings, "user_supplied_s3_endpoint_allowed_hosts", [])
    monkeypatch.setattr(
        "app.utils.network_targets.resolve_hostname_ips",
        lambda _host: {ipaddress.ip_address("93.184.216.34")},
    )

    with pytest.raises(ValueError, match="host is not allowed by policy"):
        validate_user_supplied_s3_endpoint("https://s3.example.test")


def test_production_user_supplied_endpoint_accepts_exact_operator_allowlist(monkeypatch):
    monkeypatch.setattr(s3_endpoint.settings, "app_env", "production")
    monkeypatch.setattr(
        s3_endpoint.settings,
        "user_supplied_s3_endpoint_allowed_hosts",
        ["s3.example.test"],
    )
    monkeypatch.setattr(
        "app.utils.network_targets.resolve_hostname_ips",
        lambda _host: {ipaddress.ip_address("93.184.216.34")},
    )

    assert validate_user_supplied_s3_endpoint("https://s3.example.test/") == "https://s3.example.test"


def test_development_user_supplied_endpoint_keeps_public_https_policy(monkeypatch):
    monkeypatch.setattr(s3_endpoint.settings, "app_env", "development")
    monkeypatch.setattr(s3_endpoint.settings, "user_supplied_s3_endpoint_allowed_hosts", [])
    monkeypatch.setattr(
        "app.utils.network_targets.resolve_hostname_ips",
        lambda _host: {ipaddress.ip_address("93.184.216.34")},
    )

    assert validate_user_supplied_s3_endpoint("https://public.example.test") == "https://public.example.test"


def test_resolve_iam_client_options_uses_aws_iam_endpoint_for_aws_storage_endpoint():
    endpoint = StorageEndpoint(
        name="AWS",
        endpoint_url=AWS_S3_ENDPOINT,
        provider=StorageProvider.AWS.value,
        region="eu-west-1",
        verify_tls=True,
    )
    account = type("Account", (), {"storage_endpoint": endpoint})()

    assert resolve_iam_client_options(account) == (AWS_IAM_ENDPOINT, "us-east-1", True)


def test_resolve_s3_client_options_uses_storage_endpoint_force_path_style():
    endpoint = StorageEndpoint(
        name="Path Style",
        endpoint_url="https://s3.path-style.example.test",
        provider=StorageProvider.OTHER.value,
        region="eu-west-1",
        force_path_style=True,
        verify_tls=True,
    )
    account = type("Account", (), {"storage_endpoint": endpoint})()

    assert resolve_s3_client_options(account) == (
        "https://s3.path-style.example.test",
        "eu-west-1",
        True,
        True,
    )
    assert resolve_s3_client_kwargs(account) == {
        "endpoint": "https://s3.path-style.example.test",
        "region": "eu-west-1",
        "force_path_style": True,
        "verify_tls": True,
    }


def test_resolve_s3_client_options_uses_explicitsession_endpoint_override():
    endpoint = StorageEndpoint(
        name="Configured",
        endpoint_url="https://configured.example.test",
        provider=StorageProvider.OTHER.value,
        region="eu-west-1",
        force_path_style=True,
        verify_tls=True,
    )
    account = type(
        "Account",
        (),
        {
            "storage_endpoint": endpoint,
            "session_endpoint": "https://session.example.test",
        },
    )()

    assert resolve_s3_client_options(account) == (
        "https://session.example.test",
        "eu-west-1",
        True,
        True,
    )


def test_resolve_s3_client_optionssession_force_path_style_overrides_endpoint():
    endpoint = StorageEndpoint(
        name="Path Style",
        endpoint_url="https://s3.path-style.example.test",
        provider=StorageProvider.OTHER.value,
        region="eu-west-1",
        force_path_style=True,
        verify_tls=True,
    )
    account = type(
        "Account",
        (),
        {
            "storage_endpoint": endpoint,
            "session_force_path_style": False,
        },
    )()

    assert resolve_s3_client_options(account) == (
        "https://s3.path-style.example.test",
        "eu-west-1",
        False,
        True,
    )


def test_resolve_iam_client_options_uses_aws_iam_signing_region_for_connection_context():
    endpoint = StorageEndpoint(
        name="AWS",
        endpoint_url="https://s3.eu-west-1.amazonaws.com",
        provider=StorageProvider.AWS.value,
        region="eu-west-1",
        verify_tls=True,
    )
    account = type(
        "Account",
        (),
        {
            "storage_endpoint": endpoint,
            "session_region": "eu-west-1",
        },
    )()

    assert resolve_iam_client_options(account) == (AWS_IAM_ENDPOINT, "us-east-1", True)
