# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app import main


def test_startup_security_warnings_include_weak_defaults(monkeypatch):
    monkeypatch.setattr(main.settings, "jwt_keys", ["change-me"])
    monkeypatch.setattr(main.settings, "credential_keys", ["change-me"])
    monkeypatch.setattr(main.settings, "seed_super_admin_password", "changeme")
    monkeypatch.setattr(main.settings, "refresh_token_cookie_secure", True)
    monkeypatch.setattr(main.settings, "cors_origins", ["http://localhost:5173"])

    warnings = main._startup_security_warnings()
    joined = " | ".join(warnings)
    assert "JWT key" in joined
    assert "credential encryption key" in joined
    assert "SEED_SUPER_ADMIN_PASSWORD" in joined


def test_startup_security_warnings_include_insecure_cookie_notice_for_non_local_origins(monkeypatch):
    monkeypatch.setattr(main.settings, "jwt_keys", ["a" * 32])
    monkeypatch.setattr(main.settings, "credential_keys", ["b" * 32])
    monkeypatch.setattr(main.settings, "seed_super_admin_password", "very-strong-password")
    monkeypatch.setattr(main.settings, "refresh_token_cookie_secure", False)
    monkeypatch.setattr(main.settings, "cors_origins", ["https://app.example.com"])

    warnings = main._startup_security_warnings()
    assert any("REFRESH_TOKEN_COOKIE_SECURE=false" in item for item in warnings)


def test_startup_security_warnings_do_not_include_cookie_notice_for_local_origins(monkeypatch):
    monkeypatch.setattr(main.settings, "jwt_keys", ["a" * 32])
    monkeypatch.setattr(main.settings, "credential_keys", ["b" * 32])
    monkeypatch.setattr(main.settings, "seed_super_admin_password", "very-strong-password")
    monkeypatch.setattr(main.settings, "refresh_token_cookie_secure", False)
    monkeypatch.setattr(main.settings, "cors_origins", ["http://localhost:5173", "http://127.0.0.1:4173"])

    warnings = main._startup_security_warnings()
    assert not any("REFRESH_TOKEN_COOKIE_SECURE=false" in item for item in warnings)


def test_startup_security_warnings_include_sqlite_bucket_migration_notice(monkeypatch):
    monkeypatch.setattr(main.settings, "jwt_keys", ["a" * 32])
    monkeypatch.setattr(main.settings, "credential_keys", ["b" * 32])
    monkeypatch.setattr(main.settings, "seed_super_admin_password", "very-strong-password")
    monkeypatch.setattr(main.settings, "refresh_token_cookie_secure", True)
    monkeypatch.setattr(main.settings, "cors_origins", ["http://localhost:5173"])
    monkeypatch.setattr(main.settings, "database_url", "sqlite:////tmp/test.db")
    monkeypatch.setattr(main.settings, "bucket_migration_worker_enabled", True)

    warnings = main._startup_security_warnings()

    assert any("SQLite is configured while the bucket migration worker is enabled" in item for item in warnings)


def test_startup_security_warnings_include_insecure_ldap_notice(monkeypatch):
    monkeypatch.setattr(main.settings, "jwt_keys", ["a" * 32])
    monkeypatch.setattr(main.settings, "credential_keys", ["b" * 32])
    monkeypatch.setattr(main.settings, "seed_super_admin_password", "very-strong-password")
    monkeypatch.setattr(main.settings, "refresh_token_cookie_secure", True)
    monkeypatch.setattr(main.settings, "cors_origins", ["http://localhost:5173"])
    monkeypatch.setattr(main.settings, "database_url", "postgresql://example")
    monkeypatch.setattr(main.settings, "bucket_migration_worker_enabled", False)
    monkeypatch.setattr(
        main.settings,
        "ldap_providers",
        {
            "lab": type(
                "LDAPProvider",
                (),
                {"enabled": True, "allow_insecure": True},
            )()
        },
    )

    warnings = main._startup_security_warnings()

    assert any("LDAP provider(s) allow insecure" in item for item in warnings)


def test_startup_security_warnings_include_unverified_ldap_tls_notice(monkeypatch):
    monkeypatch.setattr(main.settings, "jwt_keys", ["a" * 32])
    monkeypatch.setattr(main.settings, "credential_keys", ["b" * 32])
    monkeypatch.setattr(main.settings, "seed_super_admin_password", "very-strong-password")
    monkeypatch.setattr(main.settings, "refresh_token_cookie_secure", True)
    monkeypatch.setattr(main.settings, "cors_origins", ["http://localhost:5173"])
    monkeypatch.setattr(main.settings, "database_url", "postgresql://example")
    monkeypatch.setattr(main.settings, "bucket_migration_worker_enabled", False)
    monkeypatch.setattr(
        main.settings,
        "ldap_providers",
        {
            "lab": type(
                "LDAPProvider",
                (),
                {"enabled": True, "allow_insecure": False, "tls_verify": False, "allow_email_linking": False},
            )()
        },
    )

    warnings = main._startup_security_warnings()

    assert any("disable TLS certificate verification" in item for item in warnings)


def test_startup_security_warnings_include_ldap_email_linking_notice(monkeypatch):
    monkeypatch.setattr(main.settings, "jwt_keys", ["a" * 32])
    monkeypatch.setattr(main.settings, "credential_keys", ["b" * 32])
    monkeypatch.setattr(main.settings, "seed_super_admin_password", "very-strong-password")
    monkeypatch.setattr(main.settings, "refresh_token_cookie_secure", True)
    monkeypatch.setattr(main.settings, "cors_origins", ["http://localhost:5173"])
    monkeypatch.setattr(main.settings, "database_url", "postgresql://example")
    monkeypatch.setattr(main.settings, "bucket_migration_worker_enabled", False)
    monkeypatch.setattr(
        main.settings,
        "ldap_providers",
        {
            "corp": type(
                "LDAPProvider",
                (),
                {"enabled": True, "allow_insecure": False, "tls_verify": True, "allow_email_linking": True},
            )()
        },
    )

    warnings = main._startup_security_warnings()

    assert any("allow email-based linking" in item for item in warnings)
