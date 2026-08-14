# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from typing import cast

import pytest

from app.db import S3Account, User
from app.services.audit_service import AuditService
from app.services.browser_bucket_config_mutation_service import BrowserBucketConfigMutationService
from app.services.browser_service import BrowserService
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.s3_execution_context import S3ExecutionContext


def _context() -> S3ExecutionContext:
    account = S3Account(name="browser-config-mutation")
    account.id = 77
    return S3ExecutionContext.from_account(account)


def test_browser_bucket_config_update_runs_action_before_cache_and_audit():
    calls: list[object] = []
    account = _context()
    actor = User(email="browser-config@example.com", role="admin")
    buckets_service = object()
    expected_account = account

    class FakeBrowserService:
        def invalidate_bucket_list_cache_for_account(self, received):  # noqa: ANN001
            assert received is account
            calls.append("bucket-cache")

        def invalidate_object_list_cache_for_account(self, received, bucket_name):  # noqa: ANN001
            assert received is account
            assert bucket_name == "demo"
            calls.append("object-cache")

    class FakeAuditService:
        def record_action(self, **kwargs):  # noqa: ANN003
            calls.append(("audit", kwargs))

    def action(*, service, account: S3ExecutionContext, bucket_name: str, payload: str):  # noqa: ANN001
        assert service is buckets_service
        assert account is expected_account
        assert bucket_name == "demo"
        assert payload == "value"
        calls.append("action")
        return "result", {"changed": True}

    service = BrowserBucketConfigMutationService(
            configuration_service=cast(BucketConfigurationService, buckets_service),
        browser_service=cast(BrowserService, FakeBrowserService()),
        audit_service=cast(AuditService, FakeAuditService()),
    )

    result = service.update(
        actor=actor,
        account=account,
        bucket_name="demo",
        audit_action="update_bucket_policy",
        action=action,
        payload="value",
    )

    assert result == "result"
    assert calls[:3] == ["action", "bucket-cache", "object-cache"]
    audit = calls[3]
    assert isinstance(audit, tuple)
    assert audit[0] == "audit"
    assert audit[1] == {
        "user": actor,
        "scope": "browser",
        "action": "update_bucket_policy",
        "entity_type": "bucket",
        "entity_id": "demo",
        "account": account,
        "metadata": {"changed": True},
    }


def test_browser_bucket_config_delete_does_not_invalidate_or_audit_failed_action():
    calls: list[str] = []
    account = _context()

    class FakeBrowserService:
        def invalidate_bucket_list_cache_for_account(self, _account):  # noqa: ANN001
            calls.append("bucket-cache")

        def invalidate_object_list_cache_for_account(self, _account, _bucket_name):  # noqa: ANN001
            calls.append("object-cache")

    class FakeAuditService:
        def record_action(self, **_kwargs):  # noqa: ANN003
            calls.append("audit")

    def failing_action(**_kwargs):  # noqa: ANN003
        calls.append("action")
        raise RuntimeError("failed")

    service = BrowserBucketConfigMutationService(
            configuration_service=cast(BucketConfigurationService, object()),
        browser_service=cast(BrowserService, FakeBrowserService()),
        audit_service=cast(AuditService, FakeAuditService()),
    )

    with pytest.raises(RuntimeError, match="failed"):
        service.delete(
            actor=User(email="browser-config@example.com", role="admin"),
            account=account,
            bucket_name="demo",
            audit_action="delete_bucket_policy",
            action=failing_action,
        )

    assert calls == ["action"]


def test_browser_bucket_config_delete_records_no_synthetic_metadata():
    calls: list[object] = []
    account = _context()
    actor = User(email="browser-config@example.com", role="admin")

    class FakeBrowserService:
        def invalidate_bucket_list_cache_for_account(self, _account):  # noqa: ANN001
            calls.append("bucket-cache")

        def invalidate_object_list_cache_for_account(self, _account, _bucket_name):  # noqa: ANN001
            calls.append("object-cache")

    class FakeAuditService:
        def record_action(self, **kwargs):  # noqa: ANN003
            calls.append(("audit", kwargs))

    def action(**_kwargs):  # noqa: ANN003
        calls.append("action")

    service = BrowserBucketConfigMutationService(
            configuration_service=cast(BucketConfigurationService, object()),
        browser_service=cast(BrowserService, FakeBrowserService()),
        audit_service=cast(AuditService, FakeAuditService()),
    )

    service.delete(
        actor=actor,
        account=account,
        bucket_name="demo",
        audit_action="delete_bucket_policy",
        action=action,
    )

    assert calls[:3] == ["action", "bucket-cache", "object-cache"]
    audit = calls[3]
    assert isinstance(audit, tuple)
    assert audit[1]["metadata"] is None
