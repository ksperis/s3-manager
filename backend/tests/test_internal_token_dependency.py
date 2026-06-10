# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from fastapi import HTTPException

from app.routers import dependencies


def test_require_internal_cron_token_accepts_exact_token(monkeypatch):
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")

    dependencies.require_internal_cron_token("expected-token")


def test_require_internal_cron_token_rejects_missing_configuration(monkeypatch):
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", None)

    with pytest.raises(HTTPException) as exc_info:
        dependencies.require_internal_cron_token("expected-token")

    assert exc_info.value.status_code == 503


def test_require_internal_cron_token_rejects_wrong_token(monkeypatch):
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")

    with pytest.raises(HTTPException) as exc_info:
        dependencies.require_internal_cron_token("wrong-token")

    assert exc_info.value.status_code == 401
