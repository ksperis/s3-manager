# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import threading

from app.db import S3Account, User, UserRole
from app.main import app
from app.models.bucket import Bucket
from app.models.execution_context import ExecutionContext, ExecutionContextCapabilities
from app.routers import dependencies
from app.routers.manager import buckets as manager_buckets_router
from app.routers.storage_ops import buckets as storage_ops_buckets_router
from app.services.bucket_listing_cache import (
    get_cached_bucket_listing_for_account,
    invalidate_bucket_listing_cache,
)


class _FakeAuditService:
    def record_action(self, **kwargs):  # noqa: ANN003
        return None


class _FakeBucketsService:
    def __init__(self) -> None:
        self.list_calls = 0

    def list_buckets(self, account, include=None, with_stats=True):  # noqa: ANN001, ARG002
        self.list_calls += 1
        return [Bucket(name=f"demo-{account.id}", used_bytes=123)]

    def set_versioning(self, bucket_name: str, account, enabled: bool) -> None:  # noqa: ANN001, ARG002
        return None


def _build_account() -> S3Account:
    account = S3Account(
        name="cache-account",
        rgw_account_id="RGW00000000000000999",
        rgw_access_key="AK-CACHE",
        rgw_secret_key="SK-CACHE",
    )
    account.id = 1
    return account


def _admin_user() -> User:
    return User(
        id=101,
        email="ops-admin@example.com",
        full_name="Ops Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )


def _manager_user() -> User:
    return User(
        id=102,
        email="manager@example.com",
        full_name="Manager",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )


def test_manager_bucket_listing_uses_shared_cache(client):
    invalidate_bucket_listing_cache()
    account = _build_account()
    service = _FakeBucketsService()

    app.dependency_overrides[manager_buckets_router.get_account_context] = lambda: account
    app.dependency_overrides[manager_buckets_router.get_buckets_service] = lambda: service
    app.dependency_overrides[manager_buckets_router.get_current_account_admin] = _manager_user
    try:
        first = client.get("/api/manager/buckets")
        second = client.get("/api/manager/buckets")
        assert first.status_code == 200, first.text
        assert second.status_code == 200, second.text
        assert service.list_calls == 1
    finally:
        app.dependency_overrides.pop(manager_buckets_router.get_account_context, None)
        app.dependency_overrides.pop(manager_buckets_router.get_buckets_service, None)
        app.dependency_overrides.pop(manager_buckets_router.get_current_account_admin, None)
        invalidate_bucket_listing_cache()


def test_manager_mutation_invalidates_shared_cache_for_storage_ops(client, monkeypatch):
    invalidate_bucket_listing_cache()
    account = _build_account()
    service = _FakeBucketsService()

    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            ExecutionContext(
                kind="account",
                id="1",
                display_name="Account One",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            )
        ]

    def fake_get_account_context(*, request=None, account_ref=None, actor=None, db=None):  # noqa: ARG001
        return account

    monkeypatch.setattr(storage_ops_buckets_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_buckets_router, "get_account_context", fake_get_account_context)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    app.dependency_overrides[manager_buckets_router.get_account_context] = lambda: account
    app.dependency_overrides[manager_buckets_router.get_buckets_service] = lambda: service
    app.dependency_overrides[storage_ops_buckets_router.get_buckets_service] = lambda: service
    app.dependency_overrides[manager_buckets_router.get_current_account_admin] = _manager_user
    app.dependency_overrides[manager_buckets_router.get_audit_logger] = lambda: _FakeAuditService()
    try:
        manager_first = client.get("/api/manager/buckets")
        assert manager_first.status_code == 200, manager_first.text
        storage_ops_cached = client.get("/api/storage-ops/buckets")
        assert storage_ops_cached.status_code == 200, storage_ops_cached.text
        assert service.list_calls == 1

        mutate = client.put("/api/manager/buckets/demo-1/versioning", json={"enabled": True})
        assert mutate.status_code == 200, mutate.text

        storage_ops_after_mutation = client.get("/api/storage-ops/buckets")
        assert storage_ops_after_mutation.status_code == 200, storage_ops_after_mutation.text
        assert service.list_calls == 2
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(manager_buckets_router.get_account_context, None)
        app.dependency_overrides.pop(manager_buckets_router.get_buckets_service, None)
        app.dependency_overrides.pop(storage_ops_buckets_router.get_buckets_service, None)
        app.dependency_overrides.pop(manager_buckets_router.get_current_account_admin, None)
        app.dependency_overrides.pop(manager_buckets_router.get_audit_logger, None)
        invalidate_bucket_listing_cache()


def test_shared_bucket_listing_cache_coalesces_parallel_misses():
    invalidate_bucket_listing_cache()
    account = _build_account()
    builder_calls = 0
    builder_lock = threading.Lock()
    unblock = threading.Event()
    builder_started = threading.Event()
    results: list[list[Bucket]] = []
    errors: list[Exception] = []

    def builder():
        nonlocal builder_calls
        with builder_lock:
            builder_calls += 1
        builder_started.set()
        assert unblock.wait(timeout=1.0)
        return [Bucket(name="parallel-demo", used_bytes=1)]

    def worker() -> None:
        try:
            listed = get_cached_bucket_listing_for_account(
                account=account,
                include=set(),
                with_stats=True,
                builder=builder,
            )
            results.append(listed)
        except Exception as exc:  # pragma: no cover - defensive capture for thread boundary
            errors.append(exc)

    first = threading.Thread(target=worker)
    second = threading.Thread(target=worker)
    first.start()
    second.start()
    assert builder_started.wait(timeout=1.0)
    unblock.set()
    first.join(timeout=2.0)
    second.join(timeout=2.0)

    assert not errors
    assert builder_calls == 1
    assert len(results) == 2
    assert all(len(items) == 1 and items[0].name == "parallel-demo" for items in results)


def test_shared_bucket_listing_cache_expires_after_ttl(monkeypatch):
    invalidate_bucket_listing_cache()
    account = _build_account()
    service = _FakeBucketsService()
    now = 1000.0

    monkeypatch.setattr("app.services.bucket_listing_cache.monotonic", lambda: now)

    first = get_cached_bucket_listing_for_account(
        account=account,
        include=set(),
        with_stats=True,
        builder=lambda: service.list_buckets(account, include=None, with_stats=True),
    )
    assert len(first) == 1
    assert service.list_calls == 1

    now = 1299.0
    second = get_cached_bucket_listing_for_account(
        account=account,
        include=set(),
        with_stats=True,
        builder=lambda: service.list_buckets(account, include=None, with_stats=True),
    )
    assert len(second) == 1
    assert service.list_calls == 1

    now = 1301.0
    third = get_cached_bucket_listing_for_account(
        account=account,
        include=set(),
        with_stats=True,
        builder=lambda: service.list_buckets(account, include=None, with_stats=True),
    )
    assert len(third) == 1
    assert service.list_calls == 2
