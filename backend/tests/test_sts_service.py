# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from botocore.exceptions import ClientError

from app.services import sts_service


def _client_error(code: str, message: str = "boom") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, "AssumeRole")


class _FakeStsClient:
    def __init__(self, *, assume_payload=None, session_payload=None, error: Exception | None = None):
        self.assume_payload = assume_payload
        self.session_payload = session_payload
        self.error = error

    def assume_role(self, **kwargs):
        if self.error:
            raise self.error
        return self.assume_payload or {}

    def get_session_token(self, **kwargs):
        if self.error:
            raise self.error
        return self.session_payload or {}


def test_get_sts_client_requires_endpoint():
    with pytest.raises(RuntimeError, match="STS endpoint is not configured"):
        sts_service.get_sts_client("ak", "sk", endpoint=None)


def test_assume_role_success_with_datetime_expiration(monkeypatch):
    expiration = datetime(2026, 1, 1, tzinfo=timezone.utc)
    fake = _FakeStsClient(
        assume_payload={
            "Credentials": {
                "AccessKeyId": "ASSUME_AK",
                "SecretAccessKey": "ASSUME_SK",
                "SessionToken": "ASSUME_TOKEN",
                "Expiration": expiration,
            }
        }
    )
    monkeypatch.setattr(sts_service, "get_sts_client", lambda *args, **kwargs: fake)

    access, secret, token, exp = sts_service.assume_role(
        "arn:aws:iam::123:role/test",
        "sess",
        900,
        "AK",
        "SK",
        endpoint="https://sts.example.test",
    )
    assert access == "ASSUME_AK"
    assert secret == "ASSUME_SK"
    assert token == "ASSUME_TOKEN"
    assert exp == expiration


def test_assume_role_parses_iso_expiration(monkeypatch):
    fake = _FakeStsClient(
        assume_payload={
            "Credentials": {
                "AccessKeyId": "ASSUME_AK",
                "SecretAccessKey": "ASSUME_SK",
                "SessionToken": "ASSUME_TOKEN",
                "Expiration": "2026-03-05T10:20:30+00:00",
            }
        }
    )
    monkeypatch.setattr(sts_service, "get_sts_client", lambda *args, **kwargs: fake)

    _, _, _, exp = sts_service.assume_role(
        "arn:aws:iam::123:role/test",
        "sess",
        900,
        "AK",
        "SK",
        endpoint="https://sts.example.test",
    )
    assert exp.isoformat().startswith("2026-03-05T10:20:30")


def test_assume_role_raises_when_credentials_missing(monkeypatch):
    fake = _FakeStsClient(assume_payload={"Credentials": {"AccessKeyId": "AK_ONLY"}})
    monkeypatch.setattr(sts_service, "get_sts_client", lambda *args, **kwargs: fake)

    with pytest.raises(RuntimeError, match="did not return credentials"):
        sts_service.assume_role(
            "arn:aws:iam::123:role/test",
            "sess",
            900,
            "AK",
            "SK",
            endpoint="https://sts.example.test",
        )


def test_assume_role_wraps_client_error(monkeypatch):
    fake = _FakeStsClient(error=_client_error("AccessDenied"))
    monkeypatch.setattr(sts_service, "get_sts_client", lambda *args, **kwargs: fake)

    with pytest.raises(RuntimeError, match="Unable to assume role"):
        sts_service.assume_role(
            "arn:aws:iam::123:role/test",
            "sess",
            900,
            "AK",
            "SK",
            endpoint="https://sts.example.test",
        )


def test_get_session_token_success_and_error_paths(monkeypatch):
    ok_client = _FakeStsClient(
        session_payload={
            "Credentials": {
                "AccessKeyId": "STS_AK",
                "SecretAccessKey": "STS_SK",
                "SessionToken": "STS_TOKEN",
                "Expiration": "2026-03-05T10:20:30+00:00",
            }
        }
    )
    monkeypatch.setattr(sts_service, "get_sts_client", lambda *args, **kwargs: ok_client)
    access, secret, token, _ = sts_service.get_session_token(
        "sess",
        900,
        "AK",
        "SK",
        endpoint="https://sts.example.test",
    )
    assert (access, secret, token) == ("STS_AK", "STS_SK", "STS_TOKEN")

    bad_client = _FakeStsClient(session_payload={"Credentials": {"AccessKeyId": "only"}})
    monkeypatch.setattr(sts_service, "get_sts_client", lambda *args, **kwargs: bad_client)
    with pytest.raises(RuntimeError, match="did not return credentials"):
        sts_service.get_session_token("sess", 900, "AK", "SK", endpoint="https://sts.example.test")

    err_client = _FakeStsClient(error=_client_error("Throttling"))
    monkeypatch.setattr(sts_service, "get_sts_client", lambda *args, **kwargs: err_client)
    with pytest.raises(RuntimeError, match="Unable to get session token"):
        sts_service.get_session_token("sess", 900, "AK", "SK", endpoint="https://sts.example.test")
