# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest

from app.services.rgw_admin import RGWAdminClient, RGWAdminError


def test_set_access_key_status_accepts_list_response(monkeypatch):
    client = RGWAdminClient(
        access_key="AKIA-TEST",
        secret_key="SECRET-TEST",
        endpoint="https://rgw-admin.example.test",
        region="us-east-1",
    )

    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: [])

    client.set_access_key_status("user-1", "AK-123", enabled=False, tenant=None)


def test_set_access_key_status_raises_when_not_implemented(monkeypatch):
    client = RGWAdminClient(
        access_key="AKIA-TEST",
        secret_key="SECRET-TEST",
        endpoint="https://rgw-admin.example.test",
        region="us-east-1",
    )

    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: {"not_implemented": True})

    with pytest.raises(RGWAdminError, match="does not support updating access key status"):
        client.set_access_key_status("user-1", "AK-123", enabled=False, tenant=None)


def test_get_info_returns_empty_when_not_implemented(monkeypatch):
    client = RGWAdminClient(
        access_key="AKIA-TEST",
        secret_key="SECRET-TEST",
        endpoint="https://rgw-admin.example.test",
        region="us-east-1",
    )

    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: {"not_implemented": True})

    assert client.get_info() == {}


def test_list_accounts_with_include_details_fetches_per_account_details(monkeypatch):
    client = RGWAdminClient(
        access_key="AKIA-TEST",
        secret_key="SECRET-TEST",
        endpoint="https://rgw-admin.example.test",
        region="us-east-1",
    )

    captured: dict = {}

    def fake_request(method: str, path: str, **kwargs):
        captured["method"] = method
        captured["path"] = path
        captured["params"] = kwargs.get("params", {})
        return [
            {"id": "RGW01"},
            {"account_id": "RGW02", "account_name": "Beta"},
        ]

    monkeypatch.setattr(client, "_request", fake_request)
    detail_calls: list[str] = []

    def fake_get_account(account_id: str, allow_not_found: bool = True):
        detail_calls.append(account_id)
        return {"id": account_id, "name": f"Name-{account_id}", "email": f"{account_id.lower()}@example.test"}

    monkeypatch.setattr(client, "get_account", fake_get_account)

    payload = client.list_accounts(include_details=True)

    assert captured["method"] == "GET"
    assert captured["path"] == "/admin/metadata/account"
    assert captured["params"] == {"format": "json"}
    assert detail_calls == ["RGW01", "RGW02"]
    assert [item["account_id"] for item in payload] == ["RGW01", "RGW02"]
    assert [item["email"] for item in payload] == ["rgw01@example.test", "rgw02@example.test"]


def test_list_accounts_without_details_omits_include_details_params(monkeypatch):
    client = RGWAdminClient(
        access_key="AKIA-TEST",
        secret_key="SECRET-TEST",
        endpoint="https://rgw-admin.example.test",
        region="us-east-1",
    )

    captured: dict = {}

    def fake_request(method: str, path: str, **kwargs):
        captured["method"] = method
        captured["path"] = path
        captured["params"] = kwargs.get("params", {})
        return ["RGW01"]

    monkeypatch.setattr(client, "_request", fake_request)

    payload = client.list_accounts(include_details=False)

    assert captured["method"] == "GET"
    assert captured["path"] == "/admin/metadata/account"
    assert captured["params"] == {"format": "json"}
    assert payload == [{"account_id": "RGW01", "id": "RGW01"}]


def test_request_uses_verify_tls_flag(monkeypatch):
    client = RGWAdminClient(
        access_key="AKIA-TEST",
        secret_key="SECRET-TEST",
        endpoint="https://rgw-admin.example.test",
        region="us-east-1",
        verify_tls=False,
    )

    captured: dict[str, object] = {}

    class FakeResponse:
        status_code = 200
        text = "{}"

        @staticmethod
        def json():
            return {}

    def fake_request(method: str, url: str, **kwargs):
        captured["method"] = method
        captured["url"] = url
        captured["verify"] = kwargs.get("verify")
        return FakeResponse()

    monkeypatch.setattr(client.session, "request", fake_request)

    payload = client._request("GET", "/admin/info")
    assert payload == {}
    assert captured["method"] == "GET"
    assert captured["url"] == "https://rgw-admin.example.test/admin/info"
    assert captured["verify"] is False


def test_request_uses_configurable_default_timeout(monkeypatch):
    client = RGWAdminClient(
        access_key="AKIA-TEST",
        secret_key="SECRET-TEST",
        endpoint="https://rgw-admin.example.test",
        region="us-east-1",
        request_timeout_seconds=17,
    )

    captured: dict[str, object] = {}

    class FakeResponse:
        status_code = 200
        text = "{}"

        @staticmethod
        def json():
            return {}

    def fake_request(method: str, url: str, **kwargs):
        captured["method"] = method
        captured["url"] = url
        captured["timeout"] = kwargs.get("timeout")
        return FakeResponse()

    monkeypatch.setattr(client.session, "request", fake_request)

    payload = client._request("GET", "/admin/info")
    assert payload == {}
    assert captured["method"] == "GET"
    assert captured["url"] == "https://rgw-admin.example.test/admin/info"
    assert captured["timeout"] == 17


def test_get_all_buckets_uses_extended_timeout_only_with_stats(monkeypatch):
    client = RGWAdminClient(
        access_key="AKIA-TEST",
        secret_key="SECRET-TEST",
        endpoint="https://rgw-admin.example.test",
        region="us-east-1",
        request_timeout_seconds=11,
        bucket_list_stats_timeout_seconds=45,
    )

    captured: list[dict[str, object]] = []

    def fake_request(method: str, path: str, **kwargs):
        captured.append(
            {
                "method": method,
                "path": path,
                "params": kwargs.get("params"),
                "timeout": kwargs.get("timeout"),
            }
        )
        return {}

    monkeypatch.setattr(client, "_request", fake_request)

    client.get_all_buckets(with_stats=False)
    client.get_all_buckets(with_stats=True)

    assert captured[0]["method"] == "GET"
    assert captured[0]["path"] == "/admin/bucket"
    assert captured[0]["timeout"] is None
    assert captured[0]["params"] == {"format": "json"}

    assert captured[1]["method"] == "GET"
    assert captured[1]["path"] == "/admin/bucket"
    assert captured[1]["timeout"] == 45
    assert captured[1]["params"] == {"format": "json", "stats": "true"}
