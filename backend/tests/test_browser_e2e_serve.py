# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import json

from tests_browser_e2e import serve


def test_prepare_environment_uses_only_keyring_settings(monkeypatch, tmp_path):
    monkeypatch.setenv("FERNET_KEY", "legacy-jwt-key")
    monkeypatch.setenv("CREDENTIAL_KEY", "legacy-credential-key")
    monkeypatch.delenv("JWT_KEYS", raising=False)
    monkeypatch.delenv("CREDENTIAL_KEYS", raising=False)

    env = serve._prepare_environment(tmp_path)

    assert "FERNET_KEY" not in env
    assert "CREDENTIAL_KEY" not in env
    assert len(json.loads(env["JWT_KEYS"])) == 1
    assert len(json.loads(env["CREDENTIAL_KEYS"])) == 1
