# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import json

from tests_browser_e2e import serve


def test_prepare_environment_generates_keyring_settings(monkeypatch, tmp_path):
    monkeypatch.delenv("JWT_KEYS", raising=False)
    monkeypatch.delenv("CREDENTIAL_KEYS", raising=False)

    env = serve._prepare_environment(tmp_path)

    assert len(json.loads(env["JWT_KEYS"])) == 1
    assert len(json.loads(env["CREDENTIAL_KEYS"])) == 1
    assert env["E2E_ADMIN_EMAIL"] == "browser-e2e-admin@example.com"
    assert env["E2E_ADMIN_FULL_NAME"] == "Browser E2E Admin"
