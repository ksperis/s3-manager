# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest

from app.db import StorageEndpoint, StorageProvider
from app.utils import s3_endpoint
from app.utils.s3_endpoint import resolve_iam_client_options, validate_custom_login_s3_endpoint
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
            "_session_region": "eu-west-1",
        },
    )()

    assert resolve_iam_client_options(account) == (AWS_IAM_ENDPOINT, "us-east-1", True)
