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


def _oidc_provider(**overrides):
    values = {
        "display_name": "Corporate OIDC",
        "discovery_url": "https://idp.example.test/.well-known/openid-configuration",
        "client_id": "bucketreef",
        "redirect_uri": "https://s3.example.test/api/auth/oidc/corporate/callback",
    }
    values.update(overrides)
    return {"corporate": values}


def _ldap_provider(**overrides):
    values = {
        "display_name": "Corporate LDAP",
        "url": "ldaps://ldap.example.test",
        "user_base_dn": "ou=users,dc=example,dc=test",
    }
    values.update(overrides)
    return {"corporate": values}


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


def test_settings_parse_outbound_host_allowlists(monkeypatch):
    monkeypatch.setenv(
        "USER_SUPPLIED_S3_ENDPOINT_ALLOWED_HOSTS",
        '["s3.example.test", "*.storage.example.test"]',
    )
    monkeypatch.setenv("BUCKET_MIGRATION_WEBHOOK_ALLOWED_HOSTS", '["hooks.example.test", "*.events.example.test"]')

    settings = Settings(_env_file=None)

    assert settings.user_supplied_s3_endpoint_allowed_hosts == [
        "s3.example.test",
        "*.storage.example.test",
    ]
    assert settings.bucket_migration_webhook_allowed_hosts == [
        "hooks.example.test",
        "*.events.example.test",
    ]


@pytest.mark.parametrize("variable", ["JWT_KEYS", "CREDENTIAL_KEYS"])
def test_settings_reject_empty_keyrings(monkeypatch, variable):
    monkeypatch.setenv(variable, "[]")

    with pytest.raises(ValidationError, match="must contain at least one key"):
        Settings(_env_file=None)


def test_valid_production_authentication_configuration_is_accepted():
    settings = _valid_production_settings()
    assert settings.app_env == "production"


def test_valid_production_external_identity_configuration_is_accepted():
    settings = _valid_production_settings(
        oidc_providers=_oidc_provider(),
        ldap_providers=_ldap_provider(),
    )

    assert settings.oidc_providers["corporate"].enabled is True
    assert settings.ldap_providers["corporate"].tls_verify is True


def test_disabled_external_identity_providers_do_not_apply_production_security_policy():
    settings = _valid_production_settings(
        oidc_providers=_oidc_provider(
            enabled=False,
            use_pkce=False,
            use_nonce=False,
            discovery_url="http://idp.example.test/.well-known/openid",
            redirect_uri="http://other.example.test/callback",
        ),
        ldap_providers=_ldap_provider(enabled=False, allow_legacy_tls=True),
    )

    assert settings.oidc_providers["corporate"].enabled is False
    assert settings.ldap_providers["corporate"].enabled is False


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"public_origin": "http://s3.example.test"}, "PUBLIC_ORIGIN"),
        ({"webauthn_origin": "https://other.example.test"}, "WEBAUTHN_ORIGIN"),
        ({"webauthn_rp_id": "other.example.test"}, "WEBAUTHN_RP_ID"),
        ({"refresh_token_cookie_secure": False}, "Secure authentication cookies"),
        ({"refresh_token_cookie_domain": ".example.test"}, "host-only"),
        ({"refresh_token_cookie_samesite": "strict"}, "SameSite=Lax"),
        (
            {"require_registered_s3_login_endpoints": False},
            "administratively registered S3 login endpoints",
        ),
        ({"allowed_hosts": ["other.example.test"]}, "ALLOWED_HOSTS"),
        ({"allowed_hosts": ["*"]}, "ALLOWED_HOSTS"),
        ({"cors_origins": ["https://other.example.test"]}, "CORS_ORIGINS"),
        ({"trusted_proxy_cidrs": ["0.0.0.0/0"]}, "TRUSTED_PROXY_CIDRS"),
        ({"ui_jwt_keys": ["change-me"]}, "UI_JWT_KEYS"),
        ({"api_jwt_keys": ["change-me"]}, "API_JWT_KEYS"),
        ({"credential_keys": ["change-me"]}, "CREDENTIAL_KEYS"),
        (
            {"api_jwt_keys": ["ui-jwt-key-that-is-distinct-and-at-least-32-bytes"]},
            "distinct",
        ),
        ({"seed_s3_endpoint": "http://s3-storage.example.test"}, "SEED_S3_ENDPOINT"),
        ({"seed_s3_secret_key": "minio123"}, "SEED_S3_SECRET_KEY"),
        ({"internal_cron_token": "change-me"}, "INTERNAL_CRON_TOKEN"),
        ({"oidc_providers": _oidc_provider(use_pkce=False)}, "PKCE and nonce"),
        ({"oidc_providers": _oidc_provider(use_nonce=False)}, "PKCE and nonce"),
        (
            {"oidc_providers": _oidc_provider(discovery_url="http://idp.example.test/.well-known/openid")},
            "discovery URL must use HTTPS",
        ),
        (
            {"oidc_providers": _oidc_provider(redirect_uri="https://other.example.test/callback")},
            "redirect must use PUBLIC_ORIGIN",
        ),
        ({"ldap_providers": _ldap_provider(tls_verify=False)}, "production TLS policy"),
        ({"ldap_providers": _ldap_provider(allow_legacy_tls=True)}, "production TLS policy"),
    ],
)
def test_production_authentication_configuration_fails_closed(override, message):
    with pytest.raises(ValidationError, match=message):
        _valid_production_settings(**override)
