# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import json

from tests_browser_e2e import serve


def test_prepare_environment_generates_keyring_settings(monkeypatch, tmp_path):
    monkeypatch.setenv("JWT_KEYS", '["ambient-jwt-value"]')
    monkeypatch.setenv("CREDENTIAL_KEYS", '["ambient-credential-value"]')
    monkeypatch.setenv(
        "ENV_STORAGE_ENDPOINTS",
        '[{"name":"Ambient","endpoint_url":"https://storage.invalid","is_default":true}]',
    )
    monkeypatch.setenv("E2E_FRONTEND_BASE_URL", "http://localhost:44173")

    env = serve._prepare_environment(tmp_path)

    assert len(json.loads(env["JWT_KEYS"])) == 1
    assert len(json.loads(env["CREDENTIAL_KEYS"])) == 1
    assert env["JWT_KEYS"] != '["ambient-jwt-value"]'
    assert env["CREDENTIAL_KEYS"] != '["ambient-credential-value"]'
    assert env["ENV_STORAGE_ENDPOINTS"] == ""
    assert env["PUBLIC_ORIGIN"] == "http://localhost:44173"
    assert json.loads(env["CORS_ORIGINS"]) == [
        "http://localhost:44173",
        "http://127.0.0.1:44173",
    ]
    assert env["E2E_ADMIN_EMAIL"] == "browser-e2e-admin@example.com"
    assert env["E2E_ADMIN_FULL_NAME"] == "Browser E2E Admin"


def test_frontend_origin_rejects_non_loopback_host(monkeypatch):
    monkeypatch.setenv("E2E_FRONTEND_BASE_URL", "https://example.com:4173")

    try:
        serve._frontend_origins()
    except ValueError as exc:
        assert str(exc) == "E2E_FRONTEND_BASE_URL must be an http://localhost origin"
    else:
        raise AssertionError("Expected non-loopback E2E frontend origin to be rejected")
