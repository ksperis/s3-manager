# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timezone

import pytest
import requests

from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client


def _client(**kwargs) -> RGWAdminClient:
    params = {
        "access_key": "AKIA-TEST",
        "secret_key": "SECRET-TEST",
        "endpoint": "https://rgw-admin.example.test",
        "region": "us-east-1",
    }
    params.update(kwargs)
    return RGWAdminClient(**params)


class _Resp:
    def __init__(self, status_code: int = 200, payload=None, text: str = ""):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text or str(payload or "")

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


def test_constructor_guardrails():
    with pytest.raises(RGWAdminError, match="endpoint is not configured"):
        _client(endpoint=None)
    with pytest.raises(RGWAdminError, match="credentials are not configured"):
        _client(access_key=None)
    with pytest.raises(RGWAdminError, match="credentials are not configured"):
        _client(secret_key=None)


def test_request_conflict_not_found_not_implemented_and_invalid_json(monkeypatch):
    client = _client()

    monkeypatch.setattr(client.session, "request", lambda *args, **kwargs: _Resp(status_code=409, text="conflict"))
    payload = client._request("POST", "/admin/user", allow_conflict=True)
    assert payload["conflict"] is True

    monkeypatch.setattr(client.session, "request", lambda *args, **kwargs: _Resp(status_code=404, text="missing"))
    payload = client._request("GET", "/admin/user", allow_not_found=True)
    assert payload["not_found"] is True

    monkeypatch.setattr(client.session, "request", lambda *args, **kwargs: _Resp(status_code=405, text="not-impl"))
    payload = client._request("GET", "/admin/user", allow_not_implemented=True)
    assert payload["not_implemented"] is True

    monkeypatch.setattr(client.session, "request", lambda *args, **kwargs: _Resp(status_code=500, text="boom"))
    with pytest.raises(RGWAdminError, match="RGW admin error 500"):
        client._request("GET", "/admin/user")

    monkeypatch.setattr(client.session, "request", lambda *args, **kwargs: _Resp(status_code=200, payload=ValueError("bad"), text="not-json"))
    with pytest.raises(RGWAdminError, match="Unexpected RGW admin response format"):
        client._request("GET", "/admin/user")


def test_request_wraps_network_errors(monkeypatch):
    client = _client()

    def _raise(*args, **kwargs):
        raise requests.RequestException("network down")

    monkeypatch.setattr(client.session, "request", _raise)
    with pytest.raises(RGWAdminError, match="request failed"):
        client._request("GET", "/admin/info")


def test_create_user_and_account_conflict_fallback(monkeypatch):
    client = _client()

    def fake_request(method: str, path: str, **kwargs):
        if path == "/admin/user":
            return {"conflict": True}
        if path == "/admin/account":
            return {"conflict": True}
        raise AssertionError("unexpected path")

    monkeypatch.setattr(client, "_request", fake_request)
    monkeypatch.setattr(client, "get_user", lambda *args, **kwargs: {"uid": "alice"})
    monkeypatch.setattr(client, "get_account", lambda *args, **kwargs: {"id": "RGW1"})

    user = client.create_user("alice")
    account = client.create_account(account_id="RGW1", account_name="acc")
    assert user == {"uid": "alice"}
    assert account == {"id": "RGW1"}


def test_get_user_tenant_fallback_to_composite_uid(monkeypatch):
    client = _client()
    calls: list[dict] = []

    def fake_request(method: str, path: str, **kwargs):
        params = kwargs.get("params", {})
        calls.append(params)
        if params.get("uid") == "alice":
            return {"not_found": True}
        return {"uid": params.get("uid")}

    monkeypatch.setattr(client, "_request", fake_request)
    result = client.get_user("alice", tenant="RGW1", allow_not_found=True)
    assert result == {"uid": "RGW1$alice"}
    assert calls[0]["uid"] == "alice"
    assert calls[1]["uid"] == "RGW1$alice"


def test_extract_keys_prioritizes_secret_and_deduplicates():
    client = _client()
    payload = {
        "keys": [
            {"access_key": "AK-1", "secret_key": None},
            {"access_key": "AK-1", "secret_key": "SK-1"},
            {"access_key": "AK-2", "secret_key": "SK-2"},
        ],
    }
    keys = client._extract_keys(payload)
    assert keys[0]["access_key"] == "AK-1"
    assert keys[0]["secret_key"] == "SK-1"
    assert len([item for item in keys if item.get("access_key") == "AK-1"]) == 1


def test_list_topics_and_get_info_paths(monkeypatch):
    client = _client()

    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: {"not_implemented": True})
    assert client.list_topics("RGW1") is None
    assert client.get_info() == {}

    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: {"topics": [{"name": "t1"}]})
    assert client.list_topics("RGW1") == [{"name": "t1"}]

    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: [{"name": "t2"}])
    assert client.list_topics("RGW1") == [{"name": "t2"}]

    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: {"version": "1"})
    assert client.get_info() == {"version": "1"}


def test_quota_helpers_and_usage_timestamp_format(monkeypatch):
    client = _client()
    captured: list[dict] = []

    def fake_request(method: str, path: str, **kwargs):
        captured.append({"method": method, "path": path, "params": kwargs.get("params", {})})
        return {"ok": True}

    monkeypatch.setattr(client, "_request", fake_request)
    client.set_bucket_quota("bucket-a", max_size_bytes=4096, max_objects=10, enabled=True)
    params = captured[-1]["params"]
    assert params["max-size-kb"] == 4
    assert params["max-objects"] == 10

    client.set_user_quota("user-a", max_size_gb=1, enabled=False)
    params = captured[-1]["params"]
    assert params["max-size"] == 1024 * 1024 * 1024
    assert params["enabled"] == "false"

    assert client._format_usage_timestamp(datetime(2026, 3, 5, 10, 20, 30, tzinfo=timezone.utc)) == "2026-03-05 10:20:30"


def test_create_user_with_account_id_conflict_and_delete_user_fallback(monkeypatch):
    client = _client()
    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: {"conflict": True})
    monkeypatch.setattr(client, "get_user", lambda *args, **kwargs: {"uid": "alice"})
    result = client.create_user_with_account_id("alice", "RGW1")
    assert result == {"uid": "alice"}

    attempts: list[str] = []

    def fake_delete(method: str, path: str, **kwargs):
        uid = kwargs.get("params", {}).get("uid")
        attempts.append(uid)
        if uid == "with spaces":
            raise RGWAdminError("first failed")
        return {}

    monkeypatch.setattr(client, "_request", fake_delete)
    client.delete_user("with spaces")
    assert attempts == ["with spaces", "with-spaces"]


def test_provision_account_keys_and_user_keys_paths(monkeypatch):
    client = _client()

    # Account provisioning path where no keys are ever returned.
    monkeypatch.setattr(client, "create_account", lambda *args, **kwargs: {})
    monkeypatch.setattr(client, "create_user_with_account_id", lambda *args, **kwargs: {})
    monkeypatch.setattr(client, "get_user", lambda *args, **kwargs: {})
    access, secret = client.provision_account_keys("RGW1", "Account1")
    assert (access, secret) == (None, None)

    # User provisioning with account fallback to generated tokens.
    monkeypatch.setattr(client, "create_user_with_account_id", lambda *args, **kwargs: {})
    monkeypatch.setattr(client, "create_access_key", lambda *args, **kwargs: {})
    monkeypatch.setattr(client, "get_user", lambda *args, **kwargs: {})
    monkeypatch.setattr("app.services.rgw_admin.secrets.token_hex", lambda n: "hex-token")
    monkeypatch.setattr("app.services.rgw_admin.secrets.token_urlsafe", lambda n: "url-token")
    ak, sk = client.provision_user_keys("user@example.test", account_id="RGW1")
    assert (ak, sk) == ("hex-token", "url-token")

    # Non-account provisioning with created user keys.
    monkeypatch.setattr(
        client,
        "create_user",
        lambda *args, **kwargs: {"keys": [{"access_key": "AK-USER", "secret_key": "SK-USER"}]},
    )
    ak2, sk2 = client.provision_user_keys("user2@example.test")
    assert (ak2, sk2) == ("AK-USER", "SK-USER")


def test_get_account_quota_and_set_user_caps(monkeypatch):
    client = _client()
    monkeypatch.setattr(client, "get_account", lambda *args, **kwargs: {"not_found": True})
    assert client.get_account_quota("RGW1") == (None, None)

    recorded: list[list[tuple[str, str]]] = []

    def fake_request(method: str, path: str, **kwargs):
        params = kwargs.get("params")
        recorded.append(list(params))
        return {"done": params}

    monkeypatch.setattr(client, "_request", fake_request)
    result = client.set_user_caps("user-a", ["users=read", "buckets=write"], tenant="RGW1")
    assert recorded and len(recorded) == 2
    assert any(item == ("tenant", "RGW1") for item in recorded[0])
    assert "done" in result


def test_request_empty_body_and_write_headers(monkeypatch):
    client = _client()
    captured: dict[str, object] = {}

    def fake_request(method: str, url: str, **kwargs):
        captured["method"] = method
        captured["url"] = url
        captured["headers"] = kwargs.get("headers")
        return _Resp(status_code=200, payload={}, text="")

    monkeypatch.setattr(client.session, "request", fake_request)
    payload = client._request("POST", "/admin/user", data={"uid": "alice"})
    assert payload == {}
    assert captured["method"] == "POST"
    assert captured["url"] == "https://rgw-admin.example.test/admin/user"
    assert captured["headers"] == {"Content-Type": "application/x-www-form-urlencoded"}


def test_create_user_extra_params_and_conflict_without_existing(monkeypatch):
    client = _client()
    captured: dict[str, object] = {}

    def fake_request(method: str, path: str, **kwargs):
        captured["params"] = kwargs.get("params", {})
        return {"conflict": True}

    monkeypatch.setattr(client, "_request", fake_request)
    monkeypatch.setattr(client, "get_user", lambda *args, **kwargs: {"not_found": True})

    result = client.create_user(
        "alice",
        tenant="RGW1",
        caps="users=*",
        extra_params={"foo": "bar", "": "skip", "empty": None},
    )
    assert result == {"conflict": True}
    params = captured["params"]
    assert isinstance(params, dict)
    assert params["tenant"] == "RGW1"
    assert params["caps"] == "users=*"
    assert params["foo"] == "bar"
    assert "" not in params
    assert "empty" not in params


def test_access_key_helpers_validation_and_tenant(monkeypatch):
    client = _client()

    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: {"not_found": True})
    assert client.get_user_by_access_key("AKIA-MISS", allow_not_found=True) is None

    with pytest.raises(RGWAdminError, match="account-scoped access key creation is not supported"):
        client.create_access_key("alice", account_id="RGW1")
    with pytest.raises(RGWAdminError, match="access_key is required to delete a key"):
        client.delete_access_key("alice", "")
    with pytest.raises(RGWAdminError, match="access_key is required to update status"):
        client.set_access_key_status("alice", "", enabled=True)

    captured: dict[str, object] = {}

    def fake_request(method: str, path: str, **kwargs):
        captured["method"] = method
        captured["path"] = path
        captured["params"] = kwargs.get("params", {})
        return {}

    monkeypatch.setattr(client, "_request", fake_request)
    client.set_access_key_status("alice", "AKIA1", enabled=True, tenant="RGW1")
    assert captured["method"] == "PUT"
    assert captured["path"] == "/admin/user"
    assert captured["params"]["tenant"] == "RGW1"
    assert captured["params"]["key"] == "true"
    assert captured["params"]["generate-key"] == "false"
    assert captured["params"]["access-key"] == "AKIA1"
    assert captured["params"]["active"] == "true"


def test_extract_keys_nested_and_invalid_payload_types():
    client = _client()
    assert client._extract_keys("invalid") == []

    payload = {
        "user": {"keys": [{"access_key": "AK-NESTED", "secret_key": "SK-NESTED"}]},
        "access_key": "AK-TOP",
        "secret_key": "SK-TOP",
        "status": "active",
    }
    keys = client._extract_keys(payload)
    assert keys[0]["access_key"] == "AK-TOP"
    assert keys[0]["status"] == "active"
    assert any(item.get("access_key") == "AK-NESTED" for item in keys)


def test_extract_keys_merges_duplicate_metadata_for_same_access_key():
    client = _client()
    payload = {
        "keys": [
            {"access_key": "AK-1", "secret_key": "SK-1"},
            {"access_key": "AK-1", "create_time": "2026-03-12T10:00:00Z", "status": "enabled"},
        ],
    }
    keys = client._extract_keys(payload)
    assert len(keys) == 1
    assert keys[0]["access_key"] == "AK-1"
    assert keys[0]["secret_key"] == "SK-1"
    assert keys[0]["create_time"] == "2026-03-12T10:00:00Z"
    assert keys[0]["status"] == "enabled"


def test_extract_keys_top_level_key_preserves_timestamp_fields():
    client = _client()
    payload = {
        "access_key": "AK-TOP",
        "secret_key": "SK-TOP",
        "create_date": "2026-03-12T11:30:00Z",
        "status": "enabled",
    }
    keys = client._extract_keys(payload)
    assert len(keys) == 1
    assert keys[0]["access_key"] == "AK-TOP"
    assert keys[0]["create_date"] == "2026-03-12T11:30:00Z"
    assert keys[0]["status"] == "enabled"


def test_account_and_user_listing_normalization_paths(monkeypatch):
    client = _client()

    monkeypatch.setattr(
        client,
        "_request",
        lambda *args, **kwargs: [None, {"id": "RGW1", "name": "One"}, "RGW2", {"account_id": "   "}],
    )
    compact = client.list_accounts(include_details=False)
    assert compact == [
        {"id": "RGW1", "name": "One", "account_id": "RGW1", "account_name": "One"},
        {"account_id": "RGW2", "id": "RGW2"},
    ]

    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: [{"id": "RGW1"}, {"id": "RGW2", "name": "Two"}])
    monkeypatch.setattr(
        client,
        "get_account",
        lambda account_id, allow_not_found=True: {"id": "RGW1", "email": "one@test"} if account_id == "RGW1" else None,
    )
    detailed = client.list_accounts(include_details=True)
    assert detailed[0]["account_id"] == "RGW1"
    assert detailed[1] == {"account_id": "RGW2", "id": "RGW2", "account_name": "Two"}

    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: {"unexpected": True})
    assert client.list_users() == []
    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: ["u1", {"uid": "u2"}])
    assert client.list_users() == [{"user": "u1"}, {"uid": "u2"}]


def test_update_user_helpers_and_bucket_usage_paths(monkeypatch):
    client = _client()
    captured: dict[str, object] = {}

    def fake_request(method: str, path: str, **kwargs):
        captured["path"] = path
        captured["params"] = kwargs.get("params", {})
        if path == "/admin/bucket":
            return {"not_found": True}
        return {"conflict": True}

    monkeypatch.setattr(client, "_request", fake_request)
    monkeypatch.setattr(client, "get_user", lambda *args, **kwargs: {"uid": "alice"})

    result = client.update_user(
        "alice",
        tenant="RGW1",
        display_name="Alice",
        email="alice@test",
        suspended=True,
        max_buckets=5,
        op_mask="read, write",
        admin=True,
        system=False,
        account_root=True,
        extra_params={"foo": "bar", "": "x", "none": None},
    )
    assert result == {"uid": "alice"}
    params = captured["params"]
    assert isinstance(params, dict)
    assert params["tenant"] == "RGW1"
    assert params["display-name"] == "Alice"
    assert params["suspended"] == "true"
    assert params["admin"] == "true"
    assert params["system"] == "false"
    assert params["account-root"] == "true"
    assert params["foo"] == "bar"
    assert "" not in params
    assert "none" not in params

    monkeypatch.setattr(client, "get_user", lambda *args, **kwargs: None)
    assert client.list_user_keys("alice") == []

    bucket = client.get_bucket_info(
        "bucket-a",
        tenant="RGW1",
        uid="alice",
        account_id="RGW1",
        stats=True,
        allow_not_found=True,
    )
    assert bucket is None

    client.get_usage(
        uid="alice",
        start=datetime(2026, 3, 1, tzinfo=timezone.utc),
        end=datetime(2026, 3, 2, tzinfo=timezone.utc),
        show_entries=True,
        show_summary=True,
        bucket="bucket-a",
        tenant="RGW1",
    )
    assert captured["path"] == "/admin/usage"
    usage_params = captured["params"]
    assert usage_params["uid"] == "alice"
    assert usage_params["tenant"] == "RGW1"
    assert usage_params["bucket"] == "bucket-a"
    assert usage_params["show-entries"] == "true"
    assert usage_params["show-summary"] == "true"


def test_misc_admin_helpers_and_quota_paths(monkeypatch):
    client = _client()

    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: {"not_found": True})
    assert client.list_topics("RGW1") == []
    assert client.get_info() == {}
    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: {"topics": "bad-type"})
    assert client.list_topics("RGW1") == []
    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: {"other": True})
    assert client.list_topics("RGW1") == []
    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: ["bad"])
    assert client.get_info() == {}

    captured: list[dict[str, object]] = []

    def fake_request(method: str, path: str, **kwargs):
        captured.append({"path": path, "params": kwargs.get("params", {})})
        return {"ok": True}

    monkeypatch.setattr(client, "_request", fake_request)
    client.get_account_stats("RGW1", sync=False)
    client.get_all_buckets(account_id="RGW1", uid="alice", with_stats=False)
    client.set_bucket_quota(
        "bucket-a",
        tenant="RGW1",
        uid="alice",
        account_id="RGW1",
        max_size_gb=2,
        max_objects=50,
        enabled=False,
    )
    client.set_user_quota("alice", tenant="RGW1", max_size_bytes=2048, max_objects=5, enabled=True)
    client.set_user_caps("alice", "users=read", tenant="RGW1")

    assert captured[0]["params"] == {"format": "json", "id": "RGW1"}
    assert captured[1]["params"] == {"format": "json", "account-id": "RGW1", "uid": "alice"}
    assert captured[2]["params"]["tenant"] == "RGW1"
    assert captured[2]["params"]["uid"] == "alice"
    assert captured[2]["params"]["account-id"] == "RGW1"
    assert captured[2]["params"]["max-size-kb"] == 2 * 1024 * 1024
    assert captured[3]["params"]["tenant"] == "RGW1"
    assert captured[3]["params"]["max-size"] == 2048
    assert captured[3]["params"]["max-objects"] == 5
    assert captured[4]["params"][2] == ("user-caps", "users=read")

    monkeypatch.setattr(client, "get_user", lambda *args, **kwargs: {"not_found": True})
    assert client.get_user_quota("alice", tenant="RGW1") == (None, None)

    factory_client = get_rgw_admin_client(
        access_key="AKIA-TEST",
        secret_key="SECRET-TEST",
        endpoint="https://rgw-admin.example.test",
    )
    assert isinstance(factory_client, RGWAdminClient)


def test_provision_paths_cover_additional_fallbacks(monkeypatch):
    client = _client()

    def _raise_admin_error(*args, **kwargs):
        raise RGWAdminError("boom")

    monkeypatch.setattr(client, "create_account", lambda *args, **kwargs: {})
    monkeypatch.setattr(client, "create_user_with_account_id", _raise_admin_error)
    monkeypatch.setattr(client, "get_user", lambda *args, **kwargs: {"keys": [{"access_key": "AK-FETCH", "secret_key": "SK-FETCH"}]})
    assert client.provision_account_keys("RGW1", "Account1") == ("AK-FETCH", "SK-FETCH")

    conflict_client = _client()
    monkeypatch.setattr(conflict_client, "_request", lambda *args, **kwargs: {"conflict": True})
    monkeypatch.setattr(conflict_client, "get_user", lambda *args, **kwargs: {"not_found": True})
    monkeypatch.setattr(conflict_client, "get_account_user", lambda *args, **kwargs: {"uid": "account-user"})
    payload = conflict_client.create_user_with_account_id(
        "alice",
        "RGW1",
        display_name="Alice",
        account_root=False,
        email="alice@test",
        extra_params={"foo": "bar", "empty": None},
    )
    assert payload == {"uid": "account-user"}

    account_client = _client()
    monkeypatch.setattr(account_client, "create_user_with_account_id", _raise_admin_error)
    monkeypatch.setattr(account_client, "create_access_key", _raise_admin_error)
    monkeypatch.setattr(
        account_client,
        "get_user",
        lambda *args, **kwargs: {"keys": [{"access_key": "AK-ACC", "secret_key": "SK-ACC"}]},
    )
    assert account_client.provision_user_keys("account.user@test", account_id="RGW1") == ("AK-ACC", "SK-ACC")

    user_client = _client()
    monkeypatch.setattr(user_client, "create_user", lambda *args, **kwargs: {})
    monkeypatch.setattr(user_client, "create_access_key", _raise_admin_error)
    monkeypatch.setattr(
        user_client,
        "get_user",
        lambda *args, **kwargs: {"keys": [{"access_key": "AK-USER", "secret_key": "SK-USER"}]},
    )
    assert user_client.provision_user_keys("plain.user@test") == ("AK-USER", "SK-USER")


def test_account_user_wrappers_and_filters(monkeypatch):
    client = _client()
    captured: dict[str, object] = {}

    def fake_create_user_with_account_id(*args, **kwargs):
        captured["kwargs"] = kwargs
        return {"uid": kwargs["uid"], "account_id": kwargs["account_id"]}

    monkeypatch.setattr(client, "create_user_with_account_id", fake_create_user_with_account_id)
    result = client.create_account_user("RGW1", "alice", display_name="Alice", email="alice@test", account_root=False)
    assert result == {"uid": "alice", "account_id": "RGW1"}
    assert captured["kwargs"]["display_name"] == "Alice"
    assert captured["kwargs"]["account_root"] is False

    monkeypatch.setattr(client, "get_user", lambda *args, **kwargs: {"uid": "alice", "account_id": "RGW2"})
    assert client.get_account_user("RGW1", "alice", allow_not_found=True) is None
    monkeypatch.setattr(client, "get_user", lambda *args, **kwargs: {"uid": "alice", "account_id": "RGW1"})
    assert client.get_account_user("RGW1", "alice", allow_not_found=True) == {"uid": "alice", "account_id": "RGW1"}


def test_create_and_delete_access_key_parameter_paths(monkeypatch):
    client = _client()
    captured: list[dict[str, object]] = []

    def fake_request(method: str, path: str, **kwargs):
        captured.append({"method": method, "path": path, "params": kwargs.get("params", {})})
        return {"ok": True}

    monkeypatch.setattr(client, "_request", fake_request)
    payload = client.create_access_key("alice", tenant="RGW1", key_name="main-key")
    assert payload == {"ok": True}
    assert captured[0]["params"]["tenant"] == "RGW1"
    assert captured[0]["params"]["key-name"] == "main-key"

    client.delete_access_key("alice", "AKIA1", tenant="RGW1")
    assert captured[1]["method"] == "DELETE"
    assert captured[1]["params"]["uid"] == "alice"
    assert captured[1]["params"]["access-key"] == "AKIA1"
    assert captured[1]["params"]["key"] == "AKIA1"
    assert captured[1]["params"]["tenant"] == "RGW1"


def test_extract_keys_with_list_and_empty_dict():
    client = _client()
    keys = client._extract_keys([{"access_key": "AK-LIST", "secret_key": "SK-LIST"}])
    assert keys == [{"access_key": "AK-LIST", "secret_key": "SK-LIST"}]
    assert client._extract_keys({}) == []


def test_create_update_delete_account_branches(monkeypatch):
    client = _client()
    calls: list[dict[str, object]] = []

    def fake_request(method: str, path: str, **kwargs):
        params = kwargs.get("params", {})
        calls.append({"method": method, "path": path, "params": params})
        if path == "/admin/account" and method == "POST" and params.get("name") == "missing-api":
            return {"not_found": True}
        if path == "/admin/account" and method == "POST" and params.get("id") == "RGW-CONFLICT":
            return {"conflict": True}
        if path == "/admin/account" and method == "POST" and params.get("id") == "RGW-UPD":
            return {"conflict": True}
        return {"id": params.get("id", "RGW-OK")}

    monkeypatch.setattr(client, "_request", fake_request)
    monkeypatch.setattr(client, "get_account", lambda account_id, allow_not_found=True: {"id": account_id, "name": "existing"})

    created = client.create_account(
        account_id="RGW-CONFLICT",
        account_name="existing",
        email="acc@test",
        max_users=10,
        max_buckets=20,
        max_roles=30,
        max_groups=40,
        max_access_keys=50,
        extra_params={"foo": "bar", "none": None, "": "skip"},
    )
    assert created == {"id": "RGW-CONFLICT", "name": "existing"}
    create_params = calls[0]["params"]
    assert create_params["email"] == "acc@test"
    assert create_params["max_users"] == 10
    assert create_params["max_buckets"] == 20
    assert create_params["max_roles"] == 30
    assert create_params["max_groups"] == 40
    assert create_params["max_access_keys"] == 50
    assert create_params["foo"] == "bar"
    assert "none" not in create_params
    assert "" not in create_params

    with pytest.raises(RGWAdminError, match="account API not available"):
        client.create_account(account_name="missing-api")

    updated = client.update_account(
        "RGW-UPD",
        account_name="updated",
        email="updated@test",
        extra_params={"foo": "bar", "skip": None, "": "bad"},
    )
    assert updated == {"id": "RGW-UPD", "name": "existing"}
    update_params = calls[-1]["params"]
    assert update_params["name"] == "updated"
    assert update_params["email"] == "updated@test"
    assert update_params["foo"] == "bar"
    assert "skip" not in update_params

    deleted = client.delete_account("RGW-DEL")
    assert deleted == {"id": "RGW-DEL"}


def test_account_quota_and_get_account_success_paths(monkeypatch):
    client = _client()
    captured: list[dict[str, object]] = []

    def fake_request(method: str, path: str, **kwargs):
        params = kwargs.get("params", {})
        captured.append({"method": method, "path": path, "params": params})
        if path == "/admin/account" and method == "GET":
            return {"id": params["id"]}
        return {"ok": True}

    monkeypatch.setattr(client, "_request", fake_request)
    account = client.get_account("RGW1", allow_not_found=True)
    assert account == {"id": "RGW1"}

    client.set_account_quota("RGW1", max_size_bytes=2048, max_objects=3, enabled=False)
    bytes_params = captured[-1]["params"]
    assert bytes_params["max-size"] == 2048
    assert bytes_params["max-objects"] == 3
    assert bytes_params["enabled"] == "false"

    client.set_account_quota("RGW1", max_size_gb=2, enabled=True)
    gb_params = captured[-1]["params"]
    assert gb_params["max-size"] == 2 * 1024 * 1024 * 1024
    assert gb_params["enabled"] == "true"


def test_get_account_optional_not_implemented_marks_api_unsupported_and_caches(monkeypatch):
    client = _client()
    captured: list[tuple[str, str, dict[str, object]]] = []

    def fake_request(method: str, path: str, **kwargs):
        captured.append((method, path, kwargs))
        return {"not_implemented": True}

    monkeypatch.setattr(client, "_request", fake_request)

    assert client.get_account("RGW1", allow_not_found=True, allow_not_implemented=True) is None
    assert client.get_account("RGW2", allow_not_found=True, allow_not_implemented=True) is None
    assert client.account_api_supported is False
    assert len(captured) == 1
    assert captured[0][1] == "/admin/account"


def test_get_account_strict_still_raises_when_account_api_is_unavailable(monkeypatch):
    client = _client()

    def fake_request(method: str, path: str, **kwargs):
        raise RGWAdminError("RGW admin error 405: MethodNotAllowed")

    monkeypatch.setattr(client, "_request", fake_request)

    with pytest.raises(RGWAdminError, match="405"):
        client.get_account("RGW1", allow_not_found=True)


def test_create_user_with_account_id_conflict_without_existing(monkeypatch):
    client = _client()
    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: {"conflict": True})
    monkeypatch.setattr(client, "get_user", lambda *args, **kwargs: {"not_found": True})
    monkeypatch.setattr(client, "get_account_user", lambda *args, **kwargs: {"not_found": True})
    assert client.create_user_with_account_id("alice", "RGW1") == {"conflict": True}


def test_bucket_info_usage_and_user_key_success_paths(monkeypatch):
    client = _client()
    captured: list[dict[str, object]] = []

    def fake_request(method: str, path: str, **kwargs):
        params = kwargs.get("params", {})
        captured.append({"method": method, "path": path, "params": params})
        if path == "/admin/bucket":
            return {"bucket": params.get("bucket", "b"), "id": 1}
        if path == "/admin/usage":
            return {"entries": []}
        return {"ok": True}

    monkeypatch.setattr(client, "_request", fake_request)
    monkeypatch.setattr(client, "get_user", lambda *args, **kwargs: {"keys": [{"access_key": "AK1", "secret_key": "SK1"}]})

    assert client.list_user_keys("alice") == [{"access_key": "AK1", "secret_key": "SK1"}]
    bucket = client.get_bucket_info("bucket-a", allow_not_found=True, stats=False)
    assert bucket == {"bucket": "bucket-a", "id": 1}
    assert client._format_usage_timestamp("2026-03-05") == "2026-03-05"
    usage = client.get_usage(show_entries=False, show_summary=False)
    assert usage == {"entries": []}
    assert "show-entries" not in captured[-1]["params"]
    assert "show-summary" not in captured[-1]["params"]


def test_delete_user_tenant_and_non_account_access_key_fallback(monkeypatch):
    client = _client()
    captured: list[dict[str, object]] = []

    def fake_delete(method: str, path: str, **kwargs):
        params = kwargs.get("params", {})
        captured.append(params)
        return {}

    monkeypatch.setattr(client, "_request", fake_delete)
    client.delete_user("alice", tenant="RGW1")
    assert captured[-1]["tenant"] == "RGW1"

    monkeypatch.setattr(client, "create_user", lambda *args, **kwargs: {})
    monkeypatch.setattr(
        client,
        "create_access_key",
        lambda *args, **kwargs: {"keys": [{"access_key": "AK-NEW", "secret_key": "SK-NEW"}]},
    )
    assert client.provision_user_keys("plain.user@test") == ("AK-NEW", "SK-NEW")


def test_rgw_admin_remaining_small_branches(monkeypatch):
    client = _client()
    assert client._extract_keys({"keys": []}) == []

    monkeypatch.setattr(client, "get_user", lambda *args, **kwargs: None)
    assert client.get_account_user("RGW1", "missing", allow_not_found=True) is None

    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: {"unexpected": True})
    assert client.list_accounts(include_details=True) == []

    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: {"conflict": True})
    monkeypatch.setattr(client, "get_account", lambda *args, **kwargs: {"not_found": True})
    assert client.create_account(account_id="RGW1", account_name="Acc") == {"conflict": True}
