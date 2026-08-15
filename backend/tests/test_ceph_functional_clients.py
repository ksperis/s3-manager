# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from tests_ceph_functional.clients import BackendAuthenticator


class _FakeResponse:
    content = b""
    text = ""

    def __init__(self, payload: dict[str, Any] | None = None, *, status_code: int = 200) -> None:
        self._payload = payload or {}
        self.status_code = status_code

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeCookies(dict[str, str]):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.set_calls: list[dict[str, Any]] = []

    def set(self, name: str, value: str, **kwargs: Any) -> None:
        self[name] = value
        self.set_calls.append({"name": name, "value": value, **kwargs})


class _FakeSession:
    def __init__(self, request_responses: list[_FakeResponse] | None = None) -> None:
        self.headers: dict[str, str] = {}
        self.cookies = _FakeCookies({"csrf_token": "csrf-value"})
        self.login_call: dict[str, Any] | None = None
        self.refresh_call: dict[str, Any] | None = None
        self.request_call: dict[str, Any] | None = None
        self.request_calls: list[dict[str, Any]] = []
        self.request_responses = request_responses or [_FakeResponse()]

    def post(self, url: str, **kwargs: Any) -> _FakeResponse:
        if url.endswith("/auth/refresh"):
            self.refresh_call = {"url": url, **kwargs}
            self.cookies["csrf_token"] = "refreshed-csrf"
            return _FakeResponse()
        self.login_call = {"url": url, **kwargs}
        return _FakeResponse({"status": "authenticated"})

    def request(self, method: str, url: str, **kwargs: Any) -> _FakeResponse:
        self.request_call = {"method": method, "url": url, **kwargs}
        self.request_calls.append(self.request_call)
        return self.request_responses.pop(0)


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
        refresh_cookie_name="refresh_token",
        bootstrap_access_cookie=None,
        bootstrap_refresh_cookie=None,
        bootstrap_csrf_token=None,
        super_admin_email="admin@example.test",
    )

    session = BackendAuthenticator(settings).login("admin@example.test", "test-password")
    session.post("/admin/action", json={"enabled": True})

    assert fake_session.login_call is not None
    assert fake_session.login_call["headers"]["Origin"] == "http://127.0.0.1:8765"
    assert "Authorization" not in fake_session.headers
    assert fake_session.headers["Origin"] == "http://127.0.0.1:8765"
    assert fake_session.headers["X-S3-Workspace"] == "manager-browser"
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
        refresh_cookie_name="refresh_token",
        bootstrap_access_cookie="bootstrap-access",
        bootstrap_refresh_cookie="bootstrap-refresh",
        bootstrap_csrf_token="bootstrap-csrf",
        super_admin_email="admin@example.test",
    )

    session = BackendAuthenticator(settings).login("admin@example.test", "unused")
    session.post("/admin/action", json={"enabled": True})

    assert fake_session.login_call is None
    assert fake_session.cookies["ui_access"] == "bootstrap-access"
    assert fake_session.cookies["refresh_token"] == "bootstrap-refresh"
    assert {call["domain"] for call in fake_session.cookies.set_calls} == {"127.0.0.1"}
    assert fake_session.request_call is not None
    assert fake_session.request_call["headers"]["X-CSRF-Token"] == "bootstrap-csrf"


def test_bootstrap_cookie_scope_allows_refresh_cookie_replacement():
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
        refresh_cookie_name="refresh_token",
        bootstrap_access_cookie="bootstrap-access",
        bootstrap_refresh_cookie="bootstrap-refresh",
        bootstrap_csrf_token="bootstrap-csrf",
        super_admin_email="admin@example.test",
    )

    session = BackendAuthenticator(settings).login("admin@example.test", "unused")
    session.session.cookies.set("csrf_token", "refreshed-csrf", domain="127.0.0.1", path="/")

    assert session.session.cookies.get("csrf_token") == "refreshed-csrf"
    session.session.close()


def test_backend_session_refreshes_once_after_expired_access_cookie(monkeypatch):
    fake_session = _FakeSession(
        request_responses=[
            _FakeResponse({"detail": "Invalid UI session"}, status_code=401),
            _FakeResponse(),
        ]
    )
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
        refresh_cookie_name="refresh_token",
        bootstrap_access_cookie=None,
        bootstrap_refresh_cookie=None,
        bootstrap_csrf_token=None,
        super_admin_email="admin@example.test",
    )

    session = BackendAuthenticator(settings).login("user@example.test", "test-password")
    session.post("/admin/action", json={"enabled": True})

    assert fake_session.refresh_call is not None
    assert fake_session.refresh_call["url"].endswith("/api/auth/refresh")
    assert len(fake_session.request_calls) == 2
    assert fake_session.request_calls[1]["headers"]["X-CSRF-Token"] == "refreshed-csrf"
