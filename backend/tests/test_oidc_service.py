# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest
import requests
from jose import JWTError

from app.core.config import OIDCProviderSettings, Settings
from app.db import OidcLoginState
from app.services.oidc_service import (
    OIDCAuthenticationError,
    OIDCConfigurationError,
    OIDCProviderNotFoundError,
    OIDCStateError,
    OidcService,
)
from app.utils.time import utcnow


class _FakeUsersService:
    def __init__(self):
        self.calls: list[dict] = []
        self.last_marked = None
        self.user = SimpleNamespace(id=1, email="oidc@example.test")

    def get_or_create_oidc_user(self, **kwargs):
        self.calls.append(kwargs)
        return self.user, True

    def mark_last_login(self, user):
        self.last_marked = user
        return user


class _Response:
    def __init__(self, *, status_code: int = 200, payload: dict | None = None, text: str = "", raise_exc: Exception | None = None):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text or str(payload or "")
        self._raise_exc = raise_exc

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self._raise_exc:
            raise self._raise_exc
        if self.status_code >= 400:
            raise requests.HTTPError(self.text)


def _provider(*, enabled: bool = True, use_pkce: bool = True, use_nonce: bool = True, prompt: str | None = "consent"):
    return OIDCProviderSettings(
        display_name="Google",
        discovery_url="https://issuer.example.test/.well-known/openid-configuration",
        client_id="client-id-123",
        client_secret="client-secret-123",
        redirect_uri="https://app.example.test/oidc/google/callback",
        scopes=["openid", "email", "profile"],
        enabled=enabled,
        use_pkce=use_pkce,
        use_nonce=use_nonce,
        prompt=prompt,
    )


def _settings(provider: OIDCProviderSettings) -> Settings:
    return Settings(oidc_providers={"google": provider}, oidc_state_ttl_seconds=60)


def _service(db_session, settings: Settings | None = None):
    users = _FakeUsersService()
    service = OidcService(db_session, users_service=users, settings=settings or _settings(_provider()))
    return service, users


def test_list_providers_only_returns_enabled(db_session):
    settings = Settings(
        oidc_state_ttl_seconds=60,
        oidc_providers={
            "google": _provider(enabled=True),
            "azure": _provider(enabled=False),
        },
    )
    service, _ = _service(db_session, settings=settings)

    providers = service.list_providers()
    assert providers == [{"id": "google", "display_name": "Google", "icon_url": None}]


def test_start_login_generates_authorization_url_and_persists_state(db_session, monkeypatch):
    service, _ = _service(db_session)
    monkeypatch.setattr(
        service,
        "_get_metadata",
        lambda *args, **kwargs: {"authorization_endpoint": "https://issuer.example.test/auth"},
    )

    # Seed expired row to verify purge.
    db_session.add(
        OidcLoginState(
            state="expired-state",
            provider="google",
            code_verifier="old",
            nonce="old",
            redirect_path="/old",
            created_at=utcnow() - timedelta(hours=1),
        )
    )
    db_session.commit()

    result = service.start_login("google", "/manager")
    assert result["provider"] == "google"
    assert result["state"]
    parsed = urlparse(result["authorization_url"])
    query = parse_qs(parsed.query)
    assert query["response_type"] == ["code"]
    assert query["client_id"] == ["client-id-123"]
    assert query["prompt"] == ["consent"]
    assert query["code_challenge_method"] == ["S256"]
    assert "code_challenge" in query
    assert "nonce" in query

    stored = db_session.query(OidcLoginState).filter(OidcLoginState.state == result["state"]).first()
    assert stored is not None
    assert stored.redirect_path == "/manager"
    assert db_session.query(OidcLoginState).filter(OidcLoginState.state == "expired-state").first() is None


def test_start_login_provider_not_found_when_disabled(db_session):
    settings = _settings(_provider(enabled=False))
    service, _ = _service(db_session, settings=settings)
    with pytest.raises(OIDCProviderNotFoundError):
        service.start_login("google", "/")


def test_start_login_requires_authorization_endpoint(db_session, monkeypatch):
    service, _ = _service(db_session)
    monkeypatch.setattr(service, "_get_metadata", lambda *args, **kwargs: {})
    with pytest.raises(OIDCConfigurationError, match="authorization endpoint"):
        service.start_login("google", "/")


def test_complete_login_invalid_and_expired_state(db_session):
    service, _ = _service(db_session)
    with pytest.raises(OIDCStateError, match="Invalid OIDC state"):
        service.complete_login("google", "code", "missing")

    db_session.add(
        OidcLoginState(
            state="expired",
            provider="google",
            code_verifier="verifier",
            nonce="nonce",
            redirect_path="/manager",
            created_at=utcnow() - timedelta(hours=2),
        )
    )
    db_session.commit()

    with pytest.raises(OIDCStateError, match="expired"):
        service.complete_login("google", "code", "expired")
    assert db_session.query(OidcLoginState).filter(OidcLoginState.state == "expired").first() is None


def test_complete_login_token_endpoint_errors(db_session, monkeypatch):
    service, _ = _service(db_session)
    db_session.add(
        OidcLoginState(
            state="state-token-error",
            provider="google",
            code_verifier="verifier",
            nonce="nonce",
            redirect_path="/",
        )
    )
    db_session.commit()
    monkeypatch.setattr(service, "_get_metadata", lambda *args, **kwargs: {"token_endpoint": "https://issuer/token"})

    def _raise(*args, **kwargs):
        raise requests.RequestException("down")

    monkeypatch.setattr("app.services.oidc_service.requests.post", _raise)
    with pytest.raises(OIDCAuthenticationError, match="Unable to reach token endpoint"):
        service.complete_login("google", "code", "state-token-error")

    db_session.add(
        OidcLoginState(
            state="state-token-4xx",
            provider="google",
            code_verifier="verifier",
            nonce="nonce",
            redirect_path="/",
        )
    )
    db_session.commit()
    monkeypatch.setattr(
        "app.services.oidc_service.requests.post",
        lambda *args, **kwargs: _Response(status_code=401, payload={"error": "invalid_grant"}, text="invalid"),
    )
    with pytest.raises(OIDCAuthenticationError, match="token exchange failed"):
        service.complete_login("google", "code", "state-token-4xx")


def test_complete_login_missing_id_token_and_unverified_email(db_session, monkeypatch):
    service, _ = _service(db_session)
    monkeypatch.setattr(service, "_get_metadata", lambda *args, **kwargs: {"token_endpoint": "https://issuer/token"})

    db_session.add(
        OidcLoginState(
            state="state-no-id-token",
            provider="google",
            code_verifier="verifier",
            nonce="nonce",
            redirect_path="/",
        )
    )
    db_session.commit()
    monkeypatch.setattr("app.services.oidc_service.requests.post", lambda *args, **kwargs: _Response(payload={}))
    with pytest.raises(OIDCAuthenticationError, match="did not return an ID token"):
        service.complete_login("google", "code", "state-no-id-token")

    db_session.add(
        OidcLoginState(
            state="state-email-unverified",
            provider="google",
            code_verifier="verifier",
            nonce="nonce",
            redirect_path="/",
        )
    )
    db_session.commit()
    monkeypatch.setattr(
        "app.services.oidc_service.requests.post",
        lambda *args, **kwargs: _Response(payload={"id_token": "abc", "access_token": "atk"}),
    )
    monkeypatch.setattr(
        service,
        "_decode_id_token",
        lambda *args, **kwargs: {"sub": "sub-1", "email_verified": False},
    )
    with pytest.raises(OIDCAuthenticationError, match="Email is not verified"):
        service.complete_login("google", "code", "state-email-unverified")


def test_complete_login_success_uses_userinfo_fallback_and_cleans_state(db_session, monkeypatch):
    service, users = _service(db_session)
    start_metadata = {
        "authorization_endpoint": "https://issuer/auth",
        "token_endpoint": "https://issuer/token",
        "userinfo_endpoint": "https://issuer/userinfo",
    }
    monkeypatch.setattr(service, "_get_metadata", lambda *args, **kwargs: start_metadata)
    started = service.start_login("google", "/target")

    monkeypatch.setattr(
        "app.services.oidc_service.requests.post",
        lambda *args, **kwargs: _Response(payload={"id_token": "id-token", "access_token": "access-token"}),
    )
    monkeypatch.setattr(
        service,
        "_decode_id_token",
        lambda *args, **kwargs: {"sub": "sub-123", "name": "OIDC Name", "picture": "https://img/pic.png"},
    )
    monkeypatch.setattr(service, "_fetch_userinfo_email", lambda *args, **kwargs: "oidc@example.test")

    user, redirect_path, created = service.complete_login("google", "auth-code", started["state"])
    assert user == users.user
    assert redirect_path == "/target"
    assert created is True
    assert users.last_marked == users.user
    assert users.calls and users.calls[0]["email"] == "oidc@example.test"
    assert db_session.query(OidcLoginState).filter(OidcLoginState.state == started["state"]).first() is None


def test_metadata_and_jwks_caching(db_session, monkeypatch):
    service, _ = _service(db_session)
    provider = _provider()
    calls = {"count": 0}

    def fake_get(url, timeout=0, headers=None):
        calls["count"] += 1
        if "jwks" in url:
            return _Response(payload={"keys": [{"kid": "k1"}]})
        return _Response(payload={"issuer": "https://issuer", "jwks_uri": "https://issuer/jwks"})

    monkeypatch.setattr("app.services.oidc_service.requests.get", fake_get)
    first = service._get_metadata("google", provider)
    second = service._get_metadata("google", provider)
    assert first == second
    assert calls["count"] == 1

    jwks_a = service._get_jwks("https://issuer/jwks")
    jwks_b = service._get_jwks("https://issuer/jwks")
    assert jwks_a == jwks_b
    assert calls["count"] == 2


def test_metadata_and_jwks_fetch_failures_raise_configuration_error(db_session, monkeypatch):
    service, _ = _service(db_session)

    def fake_get(*args, **kwargs):
        raise requests.RequestException("network down")

    monkeypatch.setattr("app.services.oidc_service.requests.get", fake_get)
    with pytest.raises(OIDCConfigurationError, match="discovery"):
        service._get_metadata("google", _provider())
    with pytest.raises(OIDCConfigurationError, match="provider keys"):
        service._get_jwks("https://issuer/jwks")


def test_decode_id_token_key_lookup_invalid_token_and_nonce_mismatch(db_session, monkeypatch):
    service, _ = _service(db_session)
    metadata = {"issuer": "https://issuer.example.test", "jwks_uri": "https://issuer.example.test/jwks"}
    provider = _provider()

    monkeypatch.setattr("app.services.oidc_service.jwt.get_unverified_header", lambda token: {"kid": "kid-1", "alg": "RS256"})
    monkeypatch.setattr(service, "_get_jwks", lambda uri: {"keys": [{"kid": "other-key"}]})
    with pytest.raises(OIDCAuthenticationError, match="matching signing key"):
        service._decode_id_token("google", provider, metadata, "token", expected_nonce="n", access_token="a")

    monkeypatch.setattr(service, "_get_jwks", lambda uri: {"keys": [{"kid": "kid-1"}]})
    monkeypatch.setattr("app.services.oidc_service.jwt.decode", lambda *args, **kwargs: (_ for _ in ()).throw(JWTError("invalid")))
    with pytest.raises(OIDCAuthenticationError, match="Invalid ID token"):
        service._decode_id_token("google", provider, metadata, "token", expected_nonce="n", access_token="a")

    monkeypatch.setattr("app.services.oidc_service.jwt.decode", lambda *args, **kwargs: {"sub": "s1", "nonce": "wrong"})
    with pytest.raises(OIDCStateError, match="Nonce mismatch"):
        service._decode_id_token("google", provider, metadata, "token", expected_nonce="expected", access_token="a")


def test_fetch_userinfo_email_and_code_challenge_helpers(db_session, monkeypatch):
    service, _ = _service(db_session)

    monkeypatch.setattr(
        "app.services.oidc_service.requests.get",
        lambda *args, **kwargs: _Response(payload={"email": "user@example.test", "email_verified": True}),
    )
    assert service._fetch_userinfo_email("https://issuer/userinfo", "access-token") == "user@example.test"

    monkeypatch.setattr(
        "app.services.oidc_service.requests.get",
        lambda *args, **kwargs: _Response(payload={"email": "user@example.test", "email_verified": False}),
    )
    assert service._fetch_userinfo_email("https://issuer/userinfo", "access-token") is None

    def _raise(*args, **kwargs):
        raise requests.RequestException("down")

    monkeypatch.setattr("app.services.oidc_service.requests.get", _raise)
    assert service._fetch_userinfo_email("https://issuer/userinfo", "access-token") is None

    challenge = service._build_code_challenge("verifier-123")
    assert challenge
    assert "=" not in challenge
