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
