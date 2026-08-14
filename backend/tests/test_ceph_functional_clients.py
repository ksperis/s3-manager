# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from tests_ceph_functional.clients import BackendAuthenticator


class _FakeResponse:
    status_code = 200
    content = b""
    text = ""

    def __init__(self, payload: dict[str, Any] | None = None) -> None:
        self._payload = payload or {}

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeCookies(dict[str, str]):
    def set(self, name: str, value: str, **_kwargs: Any) -> None:
        self[name] = value


class _FakeSession:
    def __init__(self) -> None:
        self.headers: dict[str, str] = {}
        self.cookies = _FakeCookies({"csrf_token": "csrf-value"})
        self.login_call: dict[str, Any] | None = None
        self.request_call: dict[str, Any] | None = None

    def post(self, url: str, **kwargs: Any) -> _FakeResponse:
        self.login_call = {"url": url, **kwargs}
        return _FakeResponse({"status": "authenticated"})

    def request(self, method: str, url: str, **kwargs: Any) -> _FakeResponse:
        self.request_call = {"method": method, "url": url, **kwargs}
        return _FakeResponse()


def test_backend_authenticator_uses_cookie_session_origin_and_csrf(monkeypatch):
    fake_session = _FakeSession()
    monkeypatch.setattr(
        "tests_ceph_functional.clients.requests.Session",
        lambda: fake_session,
    )
    settings = SimpleNamespace(
        backend_base_url="http://127.0.0.1:8765/api",
        backend_ca_bundle=None,
        verify_tls=False,
        request_timeout=5.0,
        login_max_retries=1,
        login_retry_delay=0.5,
        request_origin="http://127.0.0.1:8765",
        csrf_cookie_name="csrf_token",
        access_cookie_name="ui_access",
        bootstrap_access_cookie=None,
        bootstrap_csrf_token=None,
        super_admin_email="admin@example.test",
    )

    session = BackendAuthenticator(settings).login("admin@example.test", "test-password")
    session.post("/admin/action", json={"enabled": True})

    assert fake_session.login_call is not None
    assert fake_session.login_call["headers"]["Origin"] == "http://127.0.0.1:8765"
    assert "Authorization" not in fake_session.headers
    assert fake_session.headers["Origin"] == "http://127.0.0.1:8765"
    assert fake_session.request_call is not None
    assert fake_session.request_call["headers"]["X-CSRF-Token"] == "csrf-value"


def test_backend_authenticator_uses_bootstrap_session_for_super_admin(monkeypatch):
    fake_session = _FakeSession()
    fake_session.cookies.clear()
    monkeypatch.setattr(
        "tests_ceph_functional.clients.requests.Session",
        lambda: fake_session,
    )
    settings = SimpleNamespace(
        backend_base_url="http://127.0.0.1:8765/api",
        backend_ca_bundle=None,
        verify_tls=False,
        request_timeout=5.0,
        login_max_retries=1,
        login_retry_delay=0.5,
        request_origin="http://127.0.0.1:8765",
        csrf_cookie_name="csrf_token",
        access_cookie_name="ui_access",
        bootstrap_access_cookie="bootstrap-access",
        bootstrap_csrf_token="bootstrap-csrf",
        super_admin_email="admin@example.test",
    )

    session = BackendAuthenticator(settings).login("admin@example.test", "unused")
    session.post("/admin/action", json={"enabled": True})

    assert fake_session.login_call is None
    assert fake_session.cookies["ui_access"] == "bootstrap-access"
    assert fake_session.request_call is not None
    assert fake_session.request_call["headers"]["X-CSRF-Token"] == "bootstrap-csrf"
