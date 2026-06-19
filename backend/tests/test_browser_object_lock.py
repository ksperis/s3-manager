# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from botocore.exceptions import ClientError

from app.db import S3Account
from app.services.browser_service import BrowserService


def _account() -> S3Account:
    return S3Account(name="object-lock-test")


def _client_error(code: str, operation: str, message: str = "missing") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, operation)


def test_get_object_legal_hold_returns_empty_when_ceph_reports_no_configuration(
    monkeypatch,
):
    calls: list[dict[str, object]] = []

    class FakeClient:
        def get_object_legal_hold(self, **kwargs):  # noqa: ANN001
            calls.append(kwargs)
            raise _client_error("ObjectLockConfigurationNotFoundError", "GetObjectLegalHold")

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    result = service.get_object_legal_hold(
        "bucket-a",
        _account(),
        "docs/report.txt",
        version_id="v1",
    )

    assert result.key == "docs/report.txt"
    assert result.status is None
    assert result.version_id == "v1"
    assert calls == [{"Bucket": "bucket-a", "Key": "docs/report.txt", "VersionId": "v1"}]


def test_get_object_retention_returns_empty_when_ceph_reports_no_configuration(
    monkeypatch,
):
    calls: list[dict[str, object]] = []

    class FakeClient:
        def get_object_retention(self, **kwargs):  # noqa: ANN001
            calls.append(kwargs)
            raise _client_error("ObjectLockConfigurationNotFoundError", "GetObjectRetention")

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    result = service.get_object_retention("bucket-a", _account(), "docs/report.txt")

    assert result.key == "docs/report.txt"
    assert result.mode is None
    assert result.retain_until is None
    assert result.version_id is None
    assert calls == [{"Bucket": "bucket-a", "Key": "docs/report.txt"}]


def test_get_object_retention_keeps_invalid_request_as_failure(monkeypatch):
    class FakeClient:
        def get_object_retention(self, **_kwargs):  # noqa: ANN001
            raise _client_error(
                "InvalidRequest",
                "GetObjectRetention",
                "bucket object lock not configured",
            )

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    with pytest.raises(RuntimeError, match="Unable to fetch retention"):
        service.get_object_retention("bucket-a", _account(), "docs/report.txt")
