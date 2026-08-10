# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from pydantic import ValidationError

from app.core.config import Settings


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
