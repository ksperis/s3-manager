# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace

from botocore.exceptions import ClientError

from app.services import s3_connection_capabilities_service as svc


def _client_error(code: str, message: str = "boom") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, "ListUsers")


class _FakeIAMClient:
    def __init__(self, *, error: Exception | None = None):
        self.error = error
        self.calls: list[dict] = []

    def list_users(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return {"Users": []}


def _conn(**kwargs):
    base = {
        "access_key_id": "AKIA-CONN",
        "secret_access_key": "SECRET-CONN",
        "capabilities_json": "{}",
        "custom_endpoint_config": '{"endpoint_url":"https://s3.example.test","region":"eu-west-1","verify_tls":true}',
        "storage_endpoint": None,
    }
    base.update(kwargs)
    return SimpleNamespace(**base)


def test_probe_connection_can_manage_iam_false_when_missing_required_fields():
    assert svc.probe_connection_can_manage_iam(_conn(access_key_id="")) is False
    assert svc.probe_connection_can_manage_iam(_conn(secret_access_key="")) is False
    assert svc.probe_connection_can_manage_iam(_conn(custom_endpoint_config='{"endpoint_url":null}')) is False


def test_probe_connection_can_manage_iam_success(monkeypatch):
    fake = _FakeIAMClient()
    monkeypatch.setattr(svc, "get_iam_client", lambda **kwargs: fake)
    assert svc.probe_connection_can_manage_iam(_conn()) is True
    assert fake.calls == [{"MaxItems": 1}]


def test_probe_connection_can_manage_iam_handles_errors(monkeypatch):
    monkeypatch.setattr(svc, "get_iam_client", lambda **kwargs: _FakeIAMClient(error=_client_error("AccessDenied")))
    assert svc.probe_connection_can_manage_iam(_conn()) is False

    monkeypatch.setattr(svc, "get_iam_client", lambda **kwargs: _FakeIAMClient(error=RuntimeError("broken")))
    assert svc.probe_connection_can_manage_iam(_conn()) is False


def test_refresh_connection_detected_capabilities_updates_json(monkeypatch):
    connection = _conn(capabilities_json='{"iam_capable":true,"x":1}')
    monkeypatch.setattr(svc, "probe_connection_can_manage_iam", lambda conn: True)

    svc.refresh_connection_detected_capabilities(connection)
    assert '"can_manage_iam": true' in connection.capabilities_json
    assert "iam_capable" not in connection.capabilities_json
