# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace

from app.services.admin_metrics_service import AdminMetricsService
from app.services.rgw_admin import RGWAdminError


class _FallbackRGWAdmin:
    def __init__(self) -> None:
        self.account_stats_calls: list[tuple[str, bool]] = []

    def get_account_stats(self, account_id: str, *, sync: bool) -> dict:
        self.account_stats_calls.append((account_id, sync))
        return {"stats": {"total_bytes": 50, "total_objects": 5}}


def test_storage_snapshot_fallback_aggregates_accounts_without_double_counting_user_buckets(monkeypatch):
    rgw_admin = _FallbackRGWAdmin()
    service = AdminMetricsService(db=SimpleNamespace(), rgw_admin=rgw_admin, endpoint_id=7)
    accounts = [
        SimpleNamespace(id=1, rgw_account_id="account-1", rgw_user_uid="root-1", name="Account 1"),
        SimpleNamespace(id=2, rgw_account_id="account-2", rgw_user_uid="root-2", name="Account 2"),
    ]
    s3_users = [SimpleNamespace(id=3, rgw_user_uid="user-3", name="User 3")]

    monkeypatch.setattr(
        AdminMetricsService,
        "build_summary_payload",
        staticmethod(lambda _db, endpoint_id=None: {"total_accounts": 2, "endpoint_id": endpoint_id}),
    )
    monkeypatch.setattr(service, "_load_scope_targets", lambda: (accounts, s3_users, {"account-1"}))

    def fail_consolidated_listing() -> list[dict]:
        raise RGWAdminError("consolidated listing unavailable")

    monkeypatch.setattr(service, "_fetch_all_buckets", fail_consolidated_listing)

    def collect_bucket_usage(*, account_id, uid, context):
        if context == "account:1":
            return 100, 10, 2
        if context == "account:2":
            return None, None, None
        assert (account_id, uid, context) == (None, "user-3", "s3_user:3")
        return 25, 3, 1

    monkeypatch.setattr(service, "_collect_bucket_usage", collect_bucket_usage)

    snapshot = service._storage_snapshot()

    assert snapshot["endpoint_id"] == 7
    assert snapshot["total_buckets"] == 2
    assert snapshot["storage_totals"] == {
        "used_bytes": 150,
        "object_count": 15,
        "bucket_count": 2,
        "accounts_with_usage": 2,
    }
    assert [entry["account_id"] for entry in snapshot["account_usage"]] == ["account-1", "account-2"]
    assert snapshot["s3_user_usage"] == [
        {
            "user_id": 3,
            "user_name": "User 3",
            "rgw_user_uid": "user-3",
            "used_bytes": 25,
            "object_count": 3,
        }
    ]
    assert rgw_admin.account_stats_calls == [("account-2", False)]
