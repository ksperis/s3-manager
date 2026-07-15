# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

from app.services import (
    bucket_integrity_service,
    bucket_purge_service,
    bucket_usage_stats_service,
    buckets_service,
    s3_client,
)
from app.services.bucket_integrity_service import BucketIntegrityCheckService
from app.services.bucket_migration import execution_context
from app.services.bucket_migration.execution_context import BucketMigrationExecutionContextMixin
from app.services.bucket_purge_service import BucketPurgeService
from app.services.bucket_usage_stats_service import BucketUsageStatsService
from app.services.buckets_service import BucketsService


def test_compare_migration_purge_integrity_and_usage_select_long_running_profile(monkeypatch):
    captured: list[dict] = []

    def fake_get_s3_client(**kwargs):
        captured.append(kwargs)
        return object()

    monkeypatch.setattr(s3_client, "get_s3_client", fake_get_s3_client)
    monkeypatch.setattr(execution_context, "get_s3_client", fake_get_s3_client)
    for module in (
        buckets_service,
        bucket_purge_service,
        bucket_integrity_service,
        bucket_usage_stats_service,
    ):
        monkeypatch.setattr(
            module,
            "resolve_s3_client_options",
            lambda _account: ("https://s3.example.test", "us-east-1", False, True),
        )

    account = SimpleNamespace(
        effective_rgw_credentials=lambda: ("AK", "SK"),
        session_token=lambda: None,
    )

    BucketsService()._compare_client(account)
    BucketPurgeService()._build_client(account)
    BucketIntegrityCheckService()._build_client(account)
    BucketUsageStatsService()._build_client(account)
    BucketMigrationExecutionContextMixin()._context_client(
        SimpleNamespace(
            context_id="source",
            account=account,
            endpoint="https://s3.example.test",
            region="us-east-1",
            force_path_style=False,
            verify_tls=True,
        )
    )

    assert len(captured) == 5
    assert all(call["request_profile"] == "long_running" for call in captured)
