# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def _valid_production_settings(**overrides):
    values = {
        "app_env": "production",
        "public_origin": "https://s3.example.test",
        "webauthn_origin": "https://s3.example.test",
        "webauthn_rp_id": "s3.example.test",
        "refresh_token_cookie_secure": True,
        "refresh_token_cookie_samesite": "lax",
        "refresh_token_cookie_domain": None,
        "seed_super_admin_mode": "disabled",
        "require_registered_s3_login_endpoints": True,
        "allowed_hosts": ["s3.example.test"],
        "cors_origins": ["https://s3.example.test"],
        "jwt_keys": ["legacy-jwt-key-that-is-at-least-32-bytes"],
        "ui_jwt_keys": ["ui-jwt-key-that-is-distinct-and-at-least-32-bytes"],
        "api_jwt_keys": ["api-jwt-key-that-is-distinct-and-at-least-32-bytes"],
        "credential_keys": ["credential-key-that-is-at-least-32-bytes"],
        "seed_s3_endpoint": "https://s3-storage.example.test",
        "seed_s3_secret_key": "seed-s3-secret-that-is-at-least-32-bytes",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_settings_ignore_removed_singular_key_variables(monkeypatch):
    monkeypatch.setenv("FERNET_KEY", "legacy-jwt-key")
    monkeypatch.setenv("CREDENTIAL_KEY", "legacy-credential-key")
    monkeypatch.delenv("JWT_KEYS", raising=False)
    monkeypatch.delenv("CREDENTIAL_KEYS", raising=False)

    settings = Settings(_env_file=None)

    assert settings.jwt_keys == ["change-me"]
    assert settings.credential_keys == ["change-me"]
    assert not hasattr(settings, "fernet_key")
    assert not hasattr(settings, "credential_key")


def test_settings_load_json_keyrings(monkeypatch):
    monkeypatch.setenv("JWT_KEYS", '["jwt-primary", "jwt-previous"]')
    monkeypatch.setenv("CREDENTIAL_KEYS", '["credential-primary", "credential-previous"]')

    settings = Settings(_env_file=None)

    assert settings.jwt_keys == ["jwt-primary", "jwt-previous"]
    assert settings.credential_keys == ["credential-primary", "credential-previous"]


@pytest.mark.parametrize("variable", ["JWT_KEYS", "CREDENTIAL_KEYS"])
def test_settings_reject_empty_keyrings(monkeypatch, variable):
    monkeypatch.setenv(variable, "[]")

    with pytest.raises(ValidationError, match="must contain at least one key"):
        Settings(_env_file=None)


def test_valid_production_authentication_configuration_is_accepted():
    settings = _valid_production_settings()
    assert settings.app_env == "production"


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"public_origin": "http://s3.example.test"}, "PUBLIC_ORIGIN"),
        ({"webauthn_origin": "https://other.example.test"}, "WEBAUTHN_ORIGIN"),
        ({"refresh_token_cookie_secure": False}, "Secure authentication cookies"),
        ({"allowed_hosts": ["other.example.test"]}, "ALLOWED_HOSTS"),
        ({"cors_origins": ["https://other.example.test"]}, "CORS_ORIGINS"),
        ({"trusted_proxy_cidrs": ["0.0.0.0/0"]}, "TRUSTED_PROXY_CIDRS"),
        ({"ui_jwt_keys": ["change-me"]}, "UI_JWT_KEYS"),
        (
            {"api_jwt_keys": ["ui-jwt-key-that-is-distinct-and-at-least-32-bytes"]},
            "distinct",
        ),
        ({"seed_s3_endpoint": "http://s3-storage.example.test"}, "SEED_S3_ENDPOINT"),
        ({"seed_s3_secret_key": "minio123"}, "SEED_S3_SECRET_KEY"),
    ],
)
def test_production_authentication_configuration_fails_closed(override, message):
    with pytest.raises(ValidationError, match=message):
        _valid_production_settings(**override)
