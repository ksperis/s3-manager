# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace

from app.db import (
    S3Account,
    S3Connection,
    S3User,
    StorageEndpoint,
    StorageProvider,
    User,
    UserRole,
    UserS3Account,
    UserS3User,
)
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


def test_consolidated_storage_snapshot_indexes_owner_usage_and_keeps_unmapped_totals():
    service = AdminMetricsService(db=SimpleNamespace(), rgw_admin=SimpleNamespace(), endpoint_id=7)
    accounts = [
        SimpleNamespace(id=1, rgw_account_id="account-1", rgw_user_uid="root-1", name="Account 1"),
    ]
    s3_users = [SimpleNamespace(id=3, rgw_user_uid="user-3", name="User 3")]
    buckets = [
        {
            "bucket": "account-bucket",
            "owner": "ACCOUNT-1",
            "usage": {"total_bytes": 100, "total_objects": 10},
        },
        {
            "bucket": "user-bucket",
            "owner": "user-3",
            "usage": {"total_bytes": 25, "total_objects": 3},
        },
        {
            "bucket": "unmapped-bucket",
            "owner": "external-owner",
            "usage": {"total_bytes": 5, "total_objects": 1},
        },
    ]

    snapshot = service._storage_snapshot_from_bucket_list(
        {"total_accounts": 1},
        accounts,
        s3_users,
        buckets,
    )

    assert snapshot["total_buckets"] == 3
    assert snapshot["storage_totals"] == {
        "used_bytes": 130,
        "object_count": 14,
        "bucket_count": 3,
        "accounts_with_usage": 1,
    }
    assert snapshot["account_usage"] == [
        {
            "account_id": "account-1",
            "account_name": "Account 1",
            "used_bytes": 100,
            "object_count": 10,
            "bucket_count": 1,
        }
    ]
    assert snapshot["s3_user_usage"] == [
        {
            "user_id": 3,
            "user_name": "User 3",
            "rgw_user_uid": "user-3",
            "used_bytes": 25,
            "object_count": 3,
            "bucket_count": 1,
        }
    ]


def test_summary_payload_preserves_global_counts_and_endpoint_assignment_scope(db_session):
    ceph_one = StorageEndpoint(
        name="ceph-one",
        endpoint_url="https://ceph-one.test",
        provider="ceph",
    )
    ceph_two = StorageEndpoint(
        name="ceph-two",
        endpoint_url="https://ceph-two.test",
        provider="ceph",
    )
    other = StorageEndpoint(
        name="other",
        endpoint_url="https://other.test",
        provider=StorageProvider.OTHER.value,
    )
    admin = User(email="admin@example.test", role=UserRole.UI_ADMIN.value)
    superadmin = User(email="superadmin@example.test", role=UserRole.UI_SUPERADMIN.value)
    manager = User(email="manager@example.test", role=UserRole.UI_USER.value)
    none_user = User(email="none@example.test", role=UserRole.UI_NONE.value)
    account_one = S3Account(
        name="account-one",
        rgw_account_id="account-one",
        rgw_user_uid="account-one-root",
        storage_endpoint=ceph_one,
    )
    account_two = S3Account(
        name="account-two",
        rgw_account_id="account-two",
        rgw_user_uid="account-two-root",
        storage_endpoint=ceph_two,
    )
    s3_user_one = S3User(
        name="user-one",
        rgw_user_uid="user-one",
        rgw_access_key="ak-one",
        rgw_secret_key="sk-one",
        storage_endpoint=ceph_one,
    )
    s3_user_two = S3User(
        name="user-two",
        rgw_user_uid="user-two",
        rgw_access_key="ak-two",
        rgw_secret_key="sk-two",
        storage_endpoint=ceph_two,
    )
    db_session.add_all(
        [
            ceph_one,
            ceph_two,
            other,
            admin,
            superadmin,
            manager,
            none_user,
            account_one,
            account_two,
            s3_user_one,
            s3_user_two,
        ]
    )
    db_session.flush()
    db_session.add_all(
        [
            UserS3Account(
                user_id=manager.id,
                account_id=account_one.id,
                is_root=False,
                role="portal_user",
            ),
            UserS3Account(
                user_id=admin.id,
                account_id=account_two.id,
                is_root=True,
                role="account_administrator",
            ),
            UserS3User(user_id=manager.id, s3_user_id=s3_user_one.id),
            S3Connection(
                created_by_user_id=manager.id,
                name="shared",
                is_shared=True,
                access_key_id="shared-ak",
                secret_access_key="shared-sk",
                storage_endpoint_id=ceph_one.id,
            ),
            S3Connection(
                created_by_user_id=manager.id,
                name="private",
                is_shared=False,
                access_key_id="private-ak",
                secret_access_key="private-sk",
                storage_endpoint_id=ceph_two.id,
            ),
        ]
    )
    db_session.commit()

    global_summary = AdminMetricsService.build_summary_payload(db_session)
    ceph_one_summary = AdminMetricsService.build_summary_payload(
        db_session,
        endpoint_id=ceph_one.id,
    )
    ceph_two_summary = AdminMetricsService.build_summary_payload(
        db_session,
        endpoint_id=ceph_two.id,
    )

    assert global_summary == {
        "total_accounts": 2,
        "total_users": 1,
        "total_admins": 2,
        "total_none_users": 1,
        "total_s3_users": 2,
        "assigned_accounts": 1,
        "unassigned_accounts": 1,
        "assigned_s3_users": 1,
        "unassigned_s3_users": 1,
        "total_endpoints": 3,
        "total_ceph_endpoints": 2,
        "total_other_endpoints": 1,
        "total_connections": 2,
        "total_shared_connections": 1,
        "total_private_connections": 1,
    }
    assert {
        key: ceph_one_summary[key]
        for key in (
            "total_accounts",
            "assigned_accounts",
            "unassigned_accounts",
            "total_s3_users",
            "assigned_s3_users",
            "unassigned_s3_users",
        )
    } == {
        "total_accounts": 1,
        "assigned_accounts": 1,
        "unassigned_accounts": 0,
        "total_s3_users": 1,
        "assigned_s3_users": 1,
        "unassigned_s3_users": 0,
    }
    assert ceph_two_summary["total_accounts"] == 1
    assert ceph_two_summary["assigned_accounts"] == 0
    assert ceph_two_summary["unassigned_accounts"] == 1
    assert ceph_two_summary["total_s3_users"] == 1
    assert ceph_two_summary["assigned_s3_users"] == 0
    assert ceph_two_summary["unassigned_s3_users"] == 1
    assert ceph_one_summary["total_endpoints"] == 3
    assert ceph_one_summary["total_connections"] == 2
