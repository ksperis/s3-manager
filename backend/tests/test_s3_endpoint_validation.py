# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest

from app.utils.s3_endpoint import validate_custom_login_s3_endpoint


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://s3.example.test/", "https://s3.example.test"),
        ("http://localhost:9000", "http://localhost:9000"),
        ("https://127.0.0.1:7480/custom/path/", "https://127.0.0.1:7480/custom/path"),
    ],
)
def test_validate_custom_login_s3_endpoint_accepts_expected_urls(raw: str, expected: str):
    assert validate_custom_login_s3_endpoint(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "ftp://s3.example.test",
        "https://user:pass@s3.example.test",
        "https://s3.example.test?x=1",
        "https://s3.example.test#frag",
        "https:///missing-host",
    ],
)
def test_validate_custom_login_s3_endpoint_rejects_unsafe_urls(raw: str):
    with pytest.raises(ValueError):
        validate_custom_login_s3_endpoint(raw)
