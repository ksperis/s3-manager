# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime, timedelta, timezone

from app.db import S3Account, StorageEndpoint, StorageProvider
from app.services import browser_service
from app.services.browser import context as browser_context
from app.services.s3_execution_context import S3ExecutionContext


def _account_with_sts_endpoint() -> S3ExecutionContext:
    endpoint = StorageEndpoint(
        name="ceph-sts",
        endpoint_url="https://ceph-sts.example.test",
        provider=StorageProvider.CEPH.value,
        features_config=(
            "features:\n"
            "  sts:\n"
            "    enabled: true\n"
        ),
    )
    account = S3Account(rgw_access_key="root", rgw_secret_key="secret")
    account.storage_endpoint = endpoint
    account.storage_endpoint_id = 1
    return S3ExecutionContext.from_account(
        account,
        access_key="root",
        secret_key="secret",
    )


def test_browser_service_prefers_sts_credentials(monkeypatch):
    browser_service._STS_CACHE.clear()
    account = _account_with_sts_endpoint()

    def fake_get_session_token(*args, **kwargs):
        return (
            "sts-access",
            "sts-secret",
            "sts-token",
            datetime.now(tz=timezone.utc) + timedelta(hours=1),
        )

    monkeypatch.setattr(browser_context, "get_session_token", fake_get_session_token)
    captured = {}

    def fake_get_s3_client(access_key, secret_key, endpoint=None, session_token=None, **kwargs):
        captured["access_key"] = access_key
        captured["secret_key"] = secret_key
        captured["session_token"] = session_token
        captured["endpoint"] = endpoint
        captured["extra"] = kwargs
        return object()

    monkeypatch.setattr(browser_context, "get_s3_client", fake_get_s3_client)

    service = browser_service.BrowserService()
    service._client(account)

    assert captured["access_key"] == "sts-access"
    assert captured["secret_key"] == "sts-secret"
    assert captured["session_token"] == "sts-token"


def test_browser_service_falls_back_on_sts_error(monkeypatch):
    browser_service._STS_CACHE.clear()
    account = _account_with_sts_endpoint()
    account.access_key = "root-access"
    account.secret_key = "root-secret"
    account.session_token_value = "session-token"

    def fake_get_session_token(*args, **kwargs):
        raise RuntimeError("STS unavailable")

    monkeypatch.setattr(browser_context, "get_session_token", fake_get_session_token)
    captured = {}

    def fake_get_s3_client(access_key, secret_key, endpoint=None, session_token=None, **kwargs):
        captured["access_key"] = access_key
        captured["secret_key"] = secret_key
        captured["session_token"] = session_token
        captured["endpoint"] = endpoint
        captured["extra"] = kwargs
        return object()

    monkeypatch.setattr(browser_context, "get_s3_client", fake_get_s3_client)

    service = browser_service.BrowserService()
    service._client(account)

    assert captured["access_key"] == "root-access"
    assert captured["secret_key"] == "root-secret"
    assert captured["session_token"] == "session-token"
