# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import threading
import time

from app.db import S3Account, User, UserRole
from app.main import app
from app.models.bucket import Bucket, BucketLifecycleConfig
from app.routers.manager import lifecycles as manager_lifecycles_router


def _build_account() -> S3Account:
    account = S3Account(
        name="lifecycle-account",
        rgw_account_id="RGW00000000000000077",
        rgw_access_key="AK-LC",
        rgw_secret_key="SK-LC",
    )
    account.id = 77
    return account


def _manager_user() -> User:
    return User(
        id=177,
        email="manager@example.com",
        full_name="Manager",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )


def _install_overrides(service):  # noqa: ANN001
    account = _build_account()
    app.dependency_overrides[manager_lifecycles_router.get_account_context] = lambda: account
    app.dependency_overrides[manager_lifecycles_router.get_buckets_service] = lambda: service
    app.dependency_overrides[manager_lifecycles_router.get_current_account_admin] = _manager_user


def _clear_overrides() -> None:
    app.dependency_overrides.pop(manager_lifecycles_router.get_account_context, None)
    app.dependency_overrides.pop(manager_lifecycles_router.get_buckets_service, None)
    app.dependency_overrides.pop(manager_lifecycles_router.get_current_account_admin, None)


def test_manager_lifecycle_inventory_returns_all_buckets(client):
    class FakeBucketService:
        def list_buckets(self, account, with_stats=True):  # noqa: ANN001, ARG002
            return [Bucket(name="logs"), Bucket(name="empty")]

        def get_lifecycle(self, bucket_name, account):  # noqa: ANN001, ARG002
            if bucket_name == "logs":
                return BucketLifecycleConfig(rules=[{"ID": "expire-logs", "Status": "Enabled"}])
            return BucketLifecycleConfig(rules=[])

    _install_overrides(FakeBucketService())
    try:
        response = client.get("/api/manager/lifecycles")
    finally:
        _clear_overrides()

    assert response.status_code == 200, response.text
    assert response.json() == [
        {"bucket_name": "logs", "rules": [{"ID": "expire-logs", "Status": "Enabled"}], "error": None},
        {"bucket_name": "empty", "rules": [], "error": None},
    ]


def test_manager_lifecycle_inventory_preserves_multiple_rules(client):
    class FakeBucketService:
        def list_buckets(self, account, with_stats=True):  # noqa: ANN001, ARG002
            return [Bucket(name="archive")]

        def get_lifecycle(self, bucket_name, account):  # noqa: ANN001, ARG002
            return BucketLifecycleConfig(
                rules=[
                    {"ID": "transition-cold", "Status": "Enabled", "Transitions": [{"Days": 30}]},
                    {"ID": "expire-old", "Status": "Disabled", "Expiration": {"Days": 365}},
                ]
            )

    _install_overrides(FakeBucketService())
    try:
        response = client.get("/api/manager/lifecycles")
    finally:
        _clear_overrides()

    assert response.status_code == 200, response.text
    rules = response.json()[0]["rules"]
    assert [rule["ID"] for rule in rules] == ["transition-cold", "expire-old"]
    assert rules[1]["Status"] == "Disabled"


def test_manager_lifecycle_inventory_keeps_bucket_errors_visible(client):
    class FakeBucketService:
        def list_buckets(self, account, with_stats=True):  # noqa: ANN001, ARG002
            return [Bucket(name="working"), Bucket(name="blocked")]

        def get_lifecycle(self, bucket_name, account):  # noqa: ANN001, ARG002
            if bucket_name == "blocked":
                raise RuntimeError("lifecycle unavailable")
            return BucketLifecycleConfig(rules=[{"ID": "keep", "Status": "Enabled"}])

    _install_overrides(FakeBucketService())
    try:
        response = client.get("/api/manager/lifecycles")
    finally:
        _clear_overrides()

    assert response.status_code == 200, response.text
    body = response.json()
    assert body[0] == {"bucket_name": "working", "rules": [{"ID": "keep", "Status": "Enabled"}], "error": None}
    assert body[1] == {"bucket_name": "blocked", "rules": [], "error": "lifecycle unavailable"}


def test_manager_lifecycle_inventory_runs_bucket_reads_in_parallel(client):
    class FakeBucketService:
        def __init__(self) -> None:
            self._lock = threading.Lock()
            self._active = 0
            self.max_active = 0

        def list_buckets(self, account, with_stats=True):  # noqa: ANN001, ARG002
            return [Bucket(name="alpha"), Bucket(name="beta"), Bucket(name="gamma")]

        def get_lifecycle(self, bucket_name, account):  # noqa: ANN001, ARG002
            with self._lock:
                self._active += 1
                self.max_active = max(self.max_active, self._active)
            try:
                time.sleep(0.05)
                return BucketLifecycleConfig(rules=[{"ID": f"rule-{bucket_name}", "Status": "Enabled"}])
            finally:
                with self._lock:
                    self._active -= 1

    service = FakeBucketService()
    _install_overrides(service)
    try:
        response = client.get("/api/manager/lifecycles")
    finally:
        _clear_overrides()

    assert response.status_code == 200, response.text
    assert [item["bucket_name"] for item in response.json()] == ["alpha", "beta", "gamma"]
    assert service.max_active >= 2
