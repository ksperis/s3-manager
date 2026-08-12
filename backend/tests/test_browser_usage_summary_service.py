# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.db import S3Account
from app.services.browser_usage_summary_service import BrowserUsageSummaryService
from app.services.s3_execution_context import S3ExecutionContext


def _account_context() -> S3ExecutionContext:
    account = S3Account(name="browser-usage-service")
    account.id = 77
    return S3ExecutionContext.from_account(account)


def test_browser_usage_summary_converts_quota_and_drops_invalid_values(db_session, monkeypatch):
    account = _account_context()

    class FakeS3AccountsService:
        def __init__(self, db):  # noqa: ANN001
            assert db is db_session

        def get_account_usage(self, received):  # noqa: ANN001
            assert received is account
            return 1024, 5, 1

        def get_account_quota(self, received):  # noqa: ANN001
            assert received is account
            return -1.0, 50

    monkeypatch.setattr(
        "app.services.browser_usage_summary_service.S3AccountsService",
        FakeS3AccountsService,
    )

    result = BrowserUsageSummaryService(db_session).build(account)

    assert result.available is True
    assert result.quota_max_size_bytes is None
    assert result.quota_max_objects == 50


def test_browser_usage_summary_rejects_non_positive_s3_user_identity(db_session):
    account = S3ExecutionContext(
        context_id="s3u-0",
        context_kind="s3_user",
        name="invalid-user",
        access_key="access",
        secret_key="secret",
        s3_user_id=0,
    )

    result = BrowserUsageSummaryService(db_session).build(account)

    assert result.model_dump(exclude_none=True) == {
        "available": False,
        "source": "s3_user",
        "label": "S3 User",
    }


def test_browser_usage_summary_returns_unavailable_for_missing_s3_user(db_session):
    account = S3ExecutionContext(
        context_id="s3u-999999",
        context_kind="s3_user",
        name="missing-user",
        access_key="access",
        secret_key="secret",
        s3_user_id=999999,
    )

    result = BrowserUsageSummaryService(db_session).build(account)

    assert result.model_dump(exclude_none=True) == {
        "available": False,
        "source": "s3_user",
        "label": "S3 User",
    }
