# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest

from app.utils import s3_endpoint
from app.utils.s3_endpoint import validate_custom_login_s3_endpoint


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
