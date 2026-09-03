# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from types import SimpleNamespace
import threading
import time

import pytest
from fastapi import HTTPException

from app.db import S3Account, S3Connection, User, UserRole
from app.models.bucket import Bucket, BucketEncryptionConfiguration, BucketLifecycleConfig, BucketNotificationConfiguration
from app.models.bucket_filter import BucketFilterQuery
from app.models.bucket_listing import BucketListingSummary
from app.models.execution_context import ExecutionContextCapabilities
from app.models.storage_ops import PaginatedStorageOpsBucketsResponse, StorageOpsBucketSummary
from app.routers import dependencies
from app.routers.storage_ops import buckets as storage_ops_router
from app.services import storage_ops_bucket_listing_service as storage_ops_listing_service
from app.services import storage_ops_bucket_filtering as storage_ops_filtering
from app.routers.storage_ops import summary as storage_ops_summary_router
from app.services import app_settings_service, effective_access_service
from app.services.connection_identity_service import ConnectionIdentityResolution
from app.services.listing_progress import ListingProgressSnapshot
from app.main import app
from tests.execution_context_factory import make_execution_context


class _CompositeConfigurationStub:
    @property
    def configuration(self):  # noqa: ANN201
        return self


def _admin_user() -> User:
    return User(
        id=101,
        email="ops-admin@example.com",
        full_name="Ops Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
        can_access_storage_ops=True,
    )


def _patch_effective_storage_ops_access(monkeypatch):
    class FakeEffectiveAccessService:
        def __init__(self, db):
            self.db = db

        def resolve_user(self, user):
            return SimpleNamespace(can_access_storage_ops=bool(user.can_access_storage_ops))

    monkeypatch.setattr(effective_access_service, "EffectiveAccessService", FakeEffectiveAccessService)


def test_get_current_storage_ops_admin_rejects_standard_user_without_storage_ops_right(monkeypatch):
    _patch_effective_storage_ops_access(monkeypatch)
    user = User(
        id=7,
        email="user@example.com",
        full_name="User",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
        can_access_storage_ops=False,
    )
    with pytest.raises(HTTPException) as exc:
        dependencies.get_current_storage_ops_admin(user=user)
    assert exc.value.status_code == 403


def test_get_current_storage_ops_admin_rejects_admin_without_storage_ops_right(monkeypatch):
    _patch_effective_storage_ops_access(monkeypatch)
    user = User(
        id=8,
        email="admin-no-storage-ops@example.com",
        full_name="Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
        can_access_storage_ops=False,
    )
    with pytest.raises(HTTPException) as exc:
        dependencies.get_current_storage_ops_admin(user=user)
    assert exc.value.status_code == 403


def test_get_current_storage_ops_admin_accepts_admin_with_storage_ops_right(monkeypatch):
    _patch_effective_storage_ops_access(monkeypatch)
    user = _admin_user()
    assert dependencies.get_current_storage_ops_admin(user=user).id == user.id


def test_get_current_storage_ops_admin_accepts_standard_user_with_storage_ops_right(monkeypatch):
    _patch_effective_storage_ops_access(monkeypatch)
    user = User(
        id=9,
        email="ops-user@example.com",
        full_name="Ops User",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
        can_access_storage_ops=True,
    )
    assert dependencies.get_current_storage_ops_admin(user=user).id == user.id


def test_require_storage_ops_enabled_blocks_when_feature_is_disabled(monkeypatch):
    settings = app_settings_service.load_default_app_settings()
    settings.general.storage_ops_enabled = False
    monkeypatch.setattr(app_settings_service, "load_app_settings", lambda: settings)
    with pytest.raises(HTTPException) as exc:
        dependencies.require_storage_ops_enabled()
    assert exc.value.status_code == 403


def test_storage_ops_summary_rejects_without_storage_ops_right(client):
    def deny_storage_ops():
        raise HTTPException(status_code=403, detail="Not authorized")

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = deny_storage_ops
    try:
        response = client.get("/api/storage-ops/summary")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)


def test_storage_ops_summary_counts_authorized_accounts_connections_and_endpoints(db_session, client, monkeypatch):
    db_session.add_all(
        [
            S3Connection(
                id=2,
                created_by_user_id=101,
                name="Shared connection",
                is_shared=True,
                access_manager=True,
                access_key_id="ak-shared",
                secret_access_key="sk-shared",
            ),
            S3Connection(
                id=3,
                created_by_user_id=101,
                name="Private connection",
                is_shared=False,
                access_manager=True,
                access_key_id="ak-private",
                secret_access_key="sk-private",
            ),
        ]
    )
    db_session.commit()

    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            make_execution_context(
                kind="account",
                id="1",
                display_name="Account A",
                endpoint_id=10,
                endpoint_name="Endpoint One",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            make_execution_context(
                kind="account",
                id="1",
                display_name="Account A duplicate",
                endpoint_id=10,
                endpoint_name="Endpoint One",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            make_execution_context(
                kind="connection",
                id="conn-2",
                display_name="Shared connection",
                endpoint_id=10,
                endpoint_name="Endpoint One",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=False),
            ),
            make_execution_context(
                kind="connection",
                id="conn-3",
                display_name="Private connection",
                endpoint_id=11,
                endpoint_name="Endpoint Two",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=False),
            ),
            make_execution_context(
                kind="s3_user",
                id="s3u-9",
                display_name="S3 user",
                endpoint_id=12,
                endpoint_name="Endpoint Three",
                capabilities=ExecutionContextCapabilities(can_manage_iam=False, sts_capable=False, admin_api_capable=False),
            ),
        ]

    monkeypatch.setattr(storage_ops_summary_router, "list_execution_contexts", fake_list_execution_contexts)
    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    try:
        response = client.get("/api/storage-ops/summary")
        assert response.status_code == 200
        assert response.json() == {
            "total_contexts": 4,
            "total_accounts": 1,
            "total_s3_users": 1,
            "total_connections": 2,
            "total_shared_connections": 1,
            "total_private_connections": 1,
            "total_endpoints": 3,
        }
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)


def test_storage_ops_listing_aggregates_contexts_and_exposes_context_fields(client, monkeypatch):
    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            make_execution_context(
                kind="account",
                id="1",
                display_name="Account A",
                endpoint_id=10,
                endpoint_name="Endpoint One",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            make_execution_context(
                kind="connection",
                id="conn-2",
                display_name="Connection B",
                endpoint_id=11,
                endpoint_name="Endpoint Two",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=False),
            ),
            make_execution_context(
                kind="s3_user",
                id="s3u-9",
                display_name="S3 User C",
                endpoint_id=12,
                endpoint_name="Endpoint Three",
                capabilities=ExecutionContextCapabilities(can_manage_iam=False, sts_capable=False, admin_api_capable=False),
            ),
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        return SimpleNamespace(context_id=account_ref)

    class FakeBucketsService(_CompositeConfigurationStub):
        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            if account.context_id == "1":
                return [
                    Bucket(name="alpha", used_bytes=10),
                    Bucket(name="shared", used_bytes=20),
                ]
            if account.context_id == "conn-2":
                return [
                    Bucket(name="beta", used_bytes=30),
                    Bucket(name="shared", used_bytes=40),
                ]
            if account.context_id == "s3u-9":
                return [Bucket(name="gamma", used_bytes=50)]
            return []

    monkeypatch.setattr(storage_ops_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_router, "get_account_context", fake_get_account_context)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    app.dependency_overrides[storage_ops_router.get_buckets_service] = lambda: FakeBucketsService()
    try:
        response = client.get("/api/storage-ops/buckets")
        assert response.status_code == 200
        payload = response.json()
        assert payload["total"] == 5
        assert payload["has_next"] is False
        encoded_names = {item["name"] for item in payload["items"]}
        assert "1::shared" in encoded_names
        assert "conn-2::shared" in encoded_names
        assert "s3u-9::gamma" in encoded_names
        s3_user_item = next(item for item in payload["items"] if item["name"] == "s3u-9::gamma")
        assert s3_user_item["context_kind"] == "s3_user"
        first = payload["items"][0]
        assert "context_id" in first
        assert "context_name" in first
        assert "context_kind" in first
        assert "endpoint_name" in first
        assert "endpoint_id" in first
        assert "bucket_name" in first
        assert "bucket_identity" in first
        assert first["bucket_identity"] == storage_ops_listing_service.build_storage_ops_bucket_identity(
            first["endpoint_id"], first["tenant"], first["bucket_name"]
        )
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(storage_ops_router.get_buckets_service, None)


def test_storage_ops_stream_emits_progress_and_result(client, monkeypatch):
    def fake_compute_listing(**kwargs):  # noqa: ARG001
        progress_callback = kwargs.get("progress_callback")
        if progress_callback:
            progress_callback(
                ListingProgressSnapshot(
                    percent=30,
                    stage="context_listing",
                    processed=1,
                    total=2,
                    message="Loading context bucket listings",
                )
            )
        return PaginatedStorageOpsBucketsResponse(
            items=[],
            total=0,
            page=1,
            page_size=25,
            has_next=False,
        )

    monkeypatch.setattr(storage_ops_router, "_compute_storage_ops_listing", fake_compute_listing)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    try:
        response = client.get(
            "/api/storage-ops/buckets/stream",
            params={"advanced_filter": '{"match":"all","rules":[]}'},
        )
        assert response.status_code == 200
        assert "event: progress" in response.text
        assert "event: result" in response.text
        assert "event: done" in response.text
        assert '"processed":1' in response.text
        assert '"total":2' in response.text
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)


def test_storage_ops_stream_hides_unexpected_error_details(client, monkeypatch):
    def fake_compute_listing(**kwargs):  # noqa: ARG001
        raise RuntimeError("secret backend failure token=leaked")

    monkeypatch.setattr(storage_ops_router, "_compute_storage_ops_listing", fake_compute_listing)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    try:
        response = client.get(
            "/api/storage-ops/buckets/stream",
            params={"advanced_filter": '{"match":"all","rules":[]}'},
        )
        assert response.status_code == 200
        assert "event: error" in response.text
        assert "Storage Ops bucket streaming failed" in response.text
        assert "token=leaked" not in response.text
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)


def test_storage_ops_listing_reports_context_progress(monkeypatch):
    contexts = [
        make_execution_context(
            kind="account",
            id=f"acct-{idx}",
            display_name=f"Account {idx}",
            endpoint_name="Endpoint One",
            capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
        )
        for idx in range(101)
    ]

    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return contexts

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        return SimpleNamespace(context_id=account_ref)

    class FakeBucketsService(_CompositeConfigurationStub):
        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            return [Bucket(name=f"{account.context_id}-bucket")]

    monkeypatch.setattr(storage_ops_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_router, "get_account_context", fake_get_account_context)
    snapshots = []

    response = storage_ops_router._compute_storage_ops_listing(
        request=SimpleNamespace(),
        db=SimpleNamespace(),
        user=_admin_user(),
        service=FakeBucketsService(),
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=json.dumps({"match": "all", "rules": [{"field": "name", "op": "contains", "value": "bucket"}]}),
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        progress_callback=snapshots.append,
        cancel_check=None,
    )

    context_snapshots = [snapshot for snapshot in snapshots if snapshot.stage == "context_listing"]
    assert response.total == 101
    assert any(snapshot.processed == 100 and snapshot.total == 101 for snapshot in context_snapshots)
    assert context_snapshots[-1].processed == 101
    assert context_snapshots[-1].total == 101
    assert snapshots[-1].percent == 100


def test_storage_ops_query_endpoint_matches_get(client, monkeypatch):
    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            make_execution_context(
                kind="account",
                id="1",
                display_name="Account A",
                endpoint_name="Endpoint One",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            make_execution_context(
                kind="connection",
                id="conn-2",
                display_name="Connection B",
                endpoint_name="Endpoint Two",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=False),
            ),
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        return SimpleNamespace(context_id=account_ref)

    class FakeBucketsService(_CompositeConfigurationStub):
        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            if account.context_id == "1":
                return [Bucket(name="alpha", used_bytes=10), Bucket(name="shared", used_bytes=20)]
            if account.context_id == "conn-2":
                return [Bucket(name="beta", used_bytes=30), Bucket(name="shared", used_bytes=40)]
            return []

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [
                {"field": "name", "op": "in", "value": ["1::alpha", "conn-2::shared"]},
            ],
        }
    )

    monkeypatch.setattr(storage_ops_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_router, "get_account_context", fake_get_account_context)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    app.dependency_overrides[storage_ops_router.get_buckets_service] = lambda: FakeBucketsService()
    try:
        get_response = client.get(
            "/api/storage-ops/buckets",
            params={"advanced_filter": advanced_filter, "with_stats": "false"},
        )
        post_response = client.post(
            "/api/storage-ops/buckets/query",
            json={
                "page": 1,
                "page_size": 25,
                "advanced_filter": advanced_filter,
                "with_stats": False,
            },
        )
        assert get_response.status_code == 200
        assert post_response.status_code == 200
        assert post_response.json() == get_response.json()
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(storage_ops_router.get_buckets_service, None)


def test_storage_ops_listing_fanout_runs_in_parallel(client, monkeypatch):
    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            make_execution_context(
                kind="account",
                id="1",
                display_name="Account A",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            make_execution_context(
                kind="account",
                id="2",
                display_name="Account B",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            make_execution_context(
                kind="connection",
                id="conn-3",
                display_name="Connection C",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=False),
            ),
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        return SimpleNamespace(context_id=account_ref)

    class FakeBucketsService(_CompositeConfigurationStub):
        def __init__(self) -> None:
            self._lock = threading.Lock()
            self._active = 0
            self.max_active = 0

        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            with self._lock:
                self._active += 1
                self.max_active = max(self.max_active, self._active)
            try:
                # Hold workers briefly to observe actual overlap.
                time.sleep(0.05)
                return [Bucket(name=f"bucket-{account.context_id}", used_bytes=1)]
            finally:
                with self._lock:
                    self._active -= 1

    service = FakeBucketsService()
    monkeypatch.setattr(storage_ops_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_router, "get_account_context", fake_get_account_context)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    app.dependency_overrides[storage_ops_router.get_buckets_service] = lambda: service
    try:
        response = client.get("/api/storage-ops/buckets")
        assert response.status_code == 200
        assert service.max_active >= 2
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(storage_ops_router.get_buckets_service, None)


def test_storage_ops_feature_param_filter_prefilters_base_candidates(monkeypatch):
    captured: dict[str, list[str]] = {}

    def fake_load_feature_param_snapshots(buckets, rules, service, account):  # noqa: ANN001, ARG001
        captured["bucket_names"] = [bucket.name for bucket in buckets]
        return {}, set()

    monkeypatch.setattr(
        storage_ops_filtering,
        "load_bucket_feature_param_snapshots",
        fake_load_feature_param_snapshots,
    )
    monkeypatch.setattr(
        storage_ops_filtering,
        "match_bucket_feature_param_rules",
        lambda rules, match_mode, snapshot: True,
    )

    buckets = [
        StorageOpsBucketSummary(
            name="alpha",
            bucket_name="alpha",
            context_id="1",
            context_name="Account A",
            context_kind="account",
            tenant=None,
            owner=None,
            owner_name=None,
        ),
        StorageOpsBucketSummary(
            name="beta",
            bucket_name="beta",
            context_id="1",
            context_name="Account A",
            context_kind="account",
            tenant=None,
            owner=None,
            owner_name=None,
        ),
    ]
    parsed_filter = BucketFilterQuery.model_validate(
        {
            "match": "all",
            "rules": [
                {"field": "name", "op": "eq", "value": "alpha"},
                {"feature": "lifecycle_rules", "param": "lifecycle_rule_id", "op": "eq", "value": "rule-1"},
            ],
        }
    )
    result = storage_ops_filtering.apply_storage_ops_advanced_filter(
        buckets,
        parsed_filter,
        service=SimpleNamespace(),
        account=SimpleNamespace(),
    )
    assert [bucket.name for bucket in result] == ["alpha"]
    assert captured["bucket_names"] == ["alpha"]


def test_storage_ops_advanced_filter_parsing_accepts_context_fields():
    parsed = BucketFilterQuery.model_validate(
        {
            "match": "all",
            "rules": [
                {"field": "context_id", "op": "in", "value": ["1", "conn-2"]},
                {"field": "context_name", "op": "contains", "value": "Account"},
                {"field": "context_kind", "op": "eq", "value": "account"},
                {"field": "endpoint_name", "op": "contains", "value": "Primary"},
            ],
        }
    )
    assert parsed.rules is not None
    assert [rule.field for rule in parsed.rules] == ["context_id", "context_name", "context_kind", "endpoint_name"]


def test_storage_ops_bucket_identity_is_endpoint_scoped_and_shared_across_contexts():
    primary_identity = storage_ops_listing_service.build_storage_ops_bucket_identity(7, None, "shared")
    archive_identity = storage_ops_listing_service.build_storage_ops_bucket_identity(8, None, "shared")
    assert primary_identity
    assert archive_identity
    assert primary_identity != archive_identity

    buckets = [
        StorageOpsBucketSummary(
            name="account-1::shared",
            bucket_name="shared",
            bucket_identity=primary_identity,
            endpoint_id=7,
            context_id="account-1",
            context_name="Account A",
            context_kind="account",
            tenant=None,
            owner=None,
            owner_name=None,
        ),
        StorageOpsBucketSummary(
            name="conn-2::shared",
            bucket_name="shared",
            bucket_identity=primary_identity,
            endpoint_id=7,
            context_id="conn-2",
            context_name="Connection B",
            context_kind="connection",
            tenant=None,
            owner=None,
            owner_name=None,
        ),
        StorageOpsBucketSummary(
            name="account-9::shared",
            bucket_name="shared",
            bucket_identity=archive_identity,
            endpoint_id=8,
            context_id="account-9",
            context_name="Account C",
            context_kind="account",
            tenant=None,
            owner=None,
            owner_name=None,
        ),
    ]
    parsed_filter = BucketFilterQuery.model_validate(
        {"match": "all", "rules": [{"field": "bucket_identity", "op": "in", "value": [primary_identity]}]}
    )

    result = storage_ops_filtering.apply_storage_ops_advanced_filter(
        buckets,
        parsed_filter,
        service=SimpleNamespace(),
        account=SimpleNamespace(),
    )

    assert [bucket.context_id for bucket in result] == ["account-1", "conn-2"]


def test_storage_ops_context_filters_match_context_kind_and_endpoint():
    buckets = [
        StorageOpsBucketSummary(
            name="alpha",
            bucket_name="alpha",
            context_id="1",
            context_name="Account A",
            context_kind="account",
            endpoint_name="Primary Endpoint",
            tenant=None,
            owner=None,
            owner_name=None,
        ),
        StorageOpsBucketSummary(
            name="beta",
            bucket_name="beta",
            context_id="conn-1",
            context_name="Connection B",
            context_kind="connection",
            endpoint_name="Archive Endpoint",
            tenant=None,
            owner=None,
            owner_name=None,
        ),
    ]
    parsed_filter = BucketFilterQuery.model_validate(
        {
            "match": "all",
            "rules": [
                {"field": "context_name", "op": "contains", "value": "account"},
                {"field": "context_kind", "op": "eq", "value": "account"},
                {"field": "endpoint_name", "op": "contains", "value": "primary"},
            ],
        }
    )
    result = storage_ops_filtering.apply_storage_ops_advanced_filter(
        buckets,
        parsed_filter,
        service=SimpleNamespace(),
        account=SimpleNamespace(),
    )
    assert [bucket.bucket_name for bucket in result] == ["alpha"]


def test_storage_ops_context_filters_match_context_id():
    buckets = [
        StorageOpsBucketSummary(
            name="alpha",
            bucket_name="alpha",
            context_id="1",
            context_name="Account A",
            context_kind="account",
            endpoint_name="Primary Endpoint",
            tenant=None,
            owner=None,
            owner_name=None,
        ),
        StorageOpsBucketSummary(
            name="beta",
            bucket_name="beta",
            context_id="conn-1",
            context_name="Connection B",
            context_kind="connection",
            endpoint_name="Archive Endpoint",
            tenant=None,
            owner=None,
            owner_name=None,
        ),
    ]
    parsed_filter = BucketFilterQuery.model_validate(
        {
            "match": "all",
            "rules": [
                {"field": "context_id", "op": "in", "value": ["conn-1"]},
            ],
        }
    )
    result = storage_ops_filtering.apply_storage_ops_advanced_filter(
        buckets,
        parsed_filter,
        service=SimpleNamespace(),
        account=SimpleNamespace(),
    )
    assert [bucket.bucket_name for bucket in result] == ["beta"]


def test_storage_ops_lifecycle_rule_status_filter_uses_context_lifecycle_lookup():
    buckets = [
        StorageOpsBucketSummary(
            name="alpha",
            bucket_name="alpha",
            context_id="1",
            context_name="Account A",
            context_kind="account",
            endpoint_name="Primary Endpoint",
            tenant=None,
            owner=None,
            owner_name=None,
        ),
        StorageOpsBucketSummary(
            name="beta",
            bucket_name="beta",
            context_id="1",
            context_name="Account A",
            context_kind="account",
            endpoint_name="Primary Endpoint",
            tenant=None,
            owner=None,
            owner_name=None,
        ),
    ]
    parsed_filter = BucketFilterQuery.model_validate(
        {
            "match": "all",
            "rules": [
                {
                    "feature": "lifecycle_rules",
                    "param": "lifecycle_rule_status",
                    "op": "eq",
                    "value": "Disabled",
                }
            ],
        }
    )

    class FakeBucketsService(_CompositeConfigurationStub):
        def get_lifecycle(self, name: str, account):  # noqa: ARG002
            rules = (
                [{"ID": "cleanup", "Status": "Disabled"}]
                if name == "alpha"
                else [{"ID": "cleanup", "Status": "Enabled"}]
            )
            return BucketLifecycleConfig(rules=rules)

    result = storage_ops_filtering.apply_storage_ops_advanced_filter(
        buckets,
        parsed_filter,
        service=FakeBucketsService(),
        account=SimpleNamespace(),
    )
    assert [bucket.bucket_name for bucket in result] == ["alpha"]


def test_storage_ops_sse_detail_filter_uses_context_encryption_lookup():
    buckets = [
        StorageOpsBucketSummary(
            name="alpha",
            bucket_name="alpha",
            context_id="1",
            context_name="Account A",
            context_kind="account",
            endpoint_name="Primary Endpoint",
            tenant=None,
            owner=None,
            owner_name=None,
        ),
        StorageOpsBucketSummary(
            name="beta",
            bucket_name="beta",
            context_id="1",
            context_name="Account A",
            context_kind="account",
            endpoint_name="Primary Endpoint",
            tenant=None,
            owner=None,
            owner_name=None,
        ),
    ]
    parsed_filter = BucketFilterQuery.model_validate(
        {
            "match": "all",
            "rules": [
                {"feature": "server_side_encryption", "param": "sse_algorithm", "op": "eq", "value": "aws:kms"},
                {"feature": "server_side_encryption", "param": "sse_kms_key_id", "op": "contains", "value": "target-key"},
            ],
        }
    )

    class FakeBucketsService(_CompositeConfigurationStub):
        def get_bucket_encryption(self, name: str, account):  # noqa: ARG002
            rules = (
                [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
                if name == "alpha"
                else [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "aws:kms", "KMSMasterKeyID": "target-key"}}]
            )
            return BucketEncryptionConfiguration(rules=rules)

    result = storage_ops_filtering.apply_storage_ops_advanced_filter(
        buckets,
        parsed_filter,
        service=FakeBucketsService(),
        account=SimpleNamespace(),
    )
    assert [bucket.bucket_name for bucket in result] == ["beta"]


def test_storage_ops_context_filters_match_s3_user_kind():
    buckets = [
        StorageOpsBucketSummary(
            name="gamma",
            bucket_name="gamma",
            context_id="s3u-9",
            context_name="S3 User C",
            context_kind="s3_user",
            endpoint_name="Primary Endpoint",
            tenant=None,
            owner=None,
            owner_name=None,
        ),
        StorageOpsBucketSummary(
            name="beta",
            bucket_name="beta",
            context_id="conn-1",
            context_name="Connection B",
            context_kind="connection",
            endpoint_name="Archive Endpoint",
            tenant=None,
            owner=None,
            owner_name=None,
        ),
    ]
    parsed_filter = BucketFilterQuery.model_validate(
        {
            "match": "all",
            "rules": [
                {"field": "context_kind", "op": "eq", "value": "s3_user"},
                {"field": "context_name", "op": "contains", "value": "s3 user"},
                {"field": "endpoint_name", "op": "contains", "value": "primary"},
            ],
        }
    )
    result = storage_ops_filtering.apply_storage_ops_advanced_filter(
        buckets,
        parsed_filter,
        service=SimpleNamespace(),
        account=SimpleNamespace(),
    )
    assert [bucket.bucket_name for bucket in result] == ["gamma"]


def test_storage_ops_list_and_stream_apply_context_advanced_filters(client, monkeypatch):
    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            make_execution_context(
                kind="account",
                id="1",
                display_name="Account A",
                endpoint_name="Primary Endpoint",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            make_execution_context(
                kind="connection",
                id="conn-2",
                display_name="Connection B",
                endpoint_name="Archive Endpoint",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=False),
            ),
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        return SimpleNamespace(context_id=account_ref)

    class FakeBucketsService(_CompositeConfigurationStub):
        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            if account.context_id == "1":
                return [Bucket(name="alpha", used_bytes=10)]
            if account.context_id == "conn-2":
                return [Bucket(name="beta", used_bytes=20)]
            return []

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [
                {"field": "context_name", "op": "contains", "value": "account"},
                {"field": "context_kind", "op": "eq", "value": "account"},
                {"field": "endpoint_name", "op": "contains", "value": "primary"},
            ],
        }
    )

    monkeypatch.setattr(storage_ops_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_router, "get_account_context", fake_get_account_context)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    app.dependency_overrides[storage_ops_router.get_buckets_service] = lambda: FakeBucketsService()
    try:
        response = client.get("/api/storage-ops/buckets", params={"advanced_filter": advanced_filter})
        assert response.status_code == 200
        payload = response.json()
        assert payload["total"] == 1
        assert [item["name"] for item in payload["items"]] == ["1::alpha"]

        stream_response = client.get("/api/storage-ops/buckets/stream", params={"advanced_filter": advanced_filter})
        assert stream_response.status_code == 200
        blocks = stream_response.text.split("\n\n")
        result_event = next((block for block in blocks if block.startswith("event: result")), "")
        assert result_event
        data_line = next((line for line in result_event.splitlines() if line.startswith("data: ")), "")
        assert data_line
        stream_payload = json.loads(data_line.removeprefix("data: "))
        assert stream_payload["total"] == 1
        assert [item["name"] for item in stream_payload["items"]] == ["1::alpha"]
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(storage_ops_router.get_buckets_service, None)


def test_storage_ops_context_prefilter_skips_non_matching_contexts_for_match_all(client, monkeypatch):
    resolved_contexts: list[str] = []

    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            make_execution_context(
                kind="account",
                id="1",
                display_name="Account A",
                endpoint_name="Primary",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            make_execution_context(
                kind="connection",
                id="conn-2",
                display_name="Connection B",
                endpoint_name="Archive",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=False),
            ),
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        resolved_contexts.append(account_ref)
        return SimpleNamespace(context_id=account_ref)

    class FakeBucketsService(_CompositeConfigurationStub):
        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            return [Bucket(name=f"bucket-{account.context_id}", used_bytes=1)]

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [
                {"field": "context_kind", "op": "eq", "value": "account"},
            ],
        }
    )

    monkeypatch.setattr(storage_ops_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_router, "get_account_context", fake_get_account_context)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    app.dependency_overrides[storage_ops_router.get_buckets_service] = lambda: FakeBucketsService()
    try:
        response = client.get("/api/storage-ops/buckets", params={"advanced_filter": advanced_filter})
        assert response.status_code == 200
        payload = response.json()
        assert payload["total"] == 1
        assert [item["name"] for item in payload["items"]] == ["1::bucket-1"]
        assert resolved_contexts == ["1"]
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(storage_ops_router.get_buckets_service, None)


def test_storage_ops_context_id_prefilter_skips_non_matching_contexts(client, monkeypatch):
    resolved_contexts: list[str] = []

    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            make_execution_context(
                kind="account",
                id="1",
                display_name="Account A",
                endpoint_name="Primary",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            make_execution_context(
                kind="connection",
                id="conn-2",
                display_name="Connection B",
                endpoint_name="Archive",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=False),
            ),
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        resolved_contexts.append(account_ref)
        return SimpleNamespace(context_id=account_ref)

    class FakeBucketsService(_CompositeConfigurationStub):
        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            return [Bucket(name=f"bucket-{account.context_id}", used_bytes=1)]

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [
                {"field": "context_id", "op": "in", "value": ["conn-2"]},
            ],
        }
    )

    monkeypatch.setattr(storage_ops_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_router, "get_account_context", fake_get_account_context)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    app.dependency_overrides[storage_ops_router.get_buckets_service] = lambda: FakeBucketsService()
    try:
        response = client.get("/api/storage-ops/buckets", params={"advanced_filter": advanced_filter})
        assert response.status_code == 200
        payload = response.json()
        assert payload["total"] == 1
        assert [item["name"] for item in payload["items"]] == ["conn-2::bucket-conn-2"]
        assert resolved_contexts == ["conn-2"]
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(storage_ops_router.get_buckets_service, None)


def test_storage_ops_context_prefilter_keeps_other_contexts_for_match_any_mixed_rules(client, monkeypatch):
    resolved_contexts: list[str] = []

    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            make_execution_context(
                kind="account",
                id="1",
                display_name="Account A",
                endpoint_name="Primary",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            make_execution_context(
                kind="connection",
                id="conn-2",
                display_name="Connection B",
                endpoint_name="Archive",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=False),
            ),
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        resolved_contexts.append(account_ref)
        return SimpleNamespace(context_id=account_ref)

    class FakeBucketsService(_CompositeConfigurationStub):
        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            if account.context_id == "1":
                return [Bucket(name="alpha", used_bytes=1)]
            if account.context_id == "conn-2":
                return [Bucket(name="beta", used_bytes=1)]
            return []

    advanced_filter = json.dumps(
        {
            "match": "any",
            "rules": [
                {"field": "context_kind", "op": "eq", "value": "account"},
                {"field": "name", "op": "eq", "value": "beta"},
            ],
        }
    )

    monkeypatch.setattr(storage_ops_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_router, "get_account_context", fake_get_account_context)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    app.dependency_overrides[storage_ops_router.get_buckets_service] = lambda: FakeBucketsService()
    try:
        response = client.get("/api/storage-ops/buckets", params={"advanced_filter": advanced_filter})
        assert response.status_code == 200
        payload = response.json()
        assert payload["total"] == 2
        assert {item["name"] for item in payload["items"]} == {"1::alpha", "conn-2::beta"}
        assert resolved_contexts == ["1", "conn-2"]
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(storage_ops_router.get_buckets_service, None)


def test_storage_ops_applies_cheap_field_prefilter_before_feature_enrichment(client, monkeypatch):
    enrich_inputs: list[list[str]] = []

    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            make_execution_context(
                kind="account",
                id="1",
                display_name="Account A",
                endpoint_name="Primary",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            )
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        return SimpleNamespace(context_id=account_ref)

    class FakeBucketsService(_CompositeConfigurationStub):
        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            return [Bucket(name="alpha", used_bytes=1), Bucket(name="beta", used_bytes=1)]

    def fake_enrich_buckets(buckets, requested_features, include_tags, service, account):  # noqa: ANN001, ARG001
        enrich_inputs.append([bucket.name for bucket in buckets])
        enriched: list[BucketListingSummary] = []
        for bucket in buckets:
            tone = "active" if bucket.name == "alpha" else "inactive"
            state = "Enabled" if bucket.name == "alpha" else "Disabled"
            enriched.append(
                BucketListingSummary(
                    name=bucket.name,
                    tenant=bucket.tenant,
                    owner=bucket.owner,
                    owner_name=bucket.owner_name,
                    used_bytes=bucket.used_bytes,
                    object_count=bucket.object_count,
                    quota_max_size_bytes=bucket.quota_max_size_bytes,
                    quota_max_objects=bucket.quota_max_objects,
                    features={
                        "versioning": {"state": state, "tone": tone},
                    },
                )
            )
        return enriched

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [
                {"field": "name", "op": "eq", "value": "alpha"},
                {"feature": "versioning", "state": "enabled"},
            ],
        }
    )

    monkeypatch.setattr(storage_ops_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_router, "get_account_context", fake_get_account_context)
    monkeypatch.setattr(storage_ops_listing_service, "enrich_buckets", fake_enrich_buckets)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    app.dependency_overrides[storage_ops_router.get_buckets_service] = lambda: FakeBucketsService()
    try:
        response = client.get("/api/storage-ops/buckets", params={"advanced_filter": advanced_filter})
        assert response.status_code == 200
        payload = response.json()
        assert payload["total"] == 1
        assert [item["name"] for item in payload["items"]] == ["1::alpha"]
        assert enrich_inputs == [["alpha"]]
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(storage_ops_router.get_buckets_service, None)


def test_storage_ops_notifications_feature_filter_uses_enrichment(monkeypatch):
    captured: dict[str, object] = {}
    parsed_filter = BucketFilterQuery.model_validate(
        {
            "match": "all",
            "rules": [
                {"feature": "notifications", "state": "enabled"},
            ],
        }
    )
    account = S3Account(
        name="storage-ops-notifications",
        rgw_account_id="RGW00000000000000001",
        rgw_access_key="AKIA_TEST",
        rgw_secret_key="SECRET_TEST",
    )
    context = storage_ops_listing_service.StorageOpsResolvedContext(
        ref=storage_ops_listing_service.StorageOpsContextRef(
            context_id="1",
            context_name="Account A",
            context_kind="account",
            endpoint_id=1,
            endpoint_name="Primary",
        ),
        account=account,
    )

    class FakeBucketsService(_CompositeConfigurationStub):
        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            return [Bucket(name="alpha"), Bucket(name="beta")]

    def fake_enrich_buckets(buckets, requested_features, include_tags, service, account):  # noqa: ANN001, ARG001
        captured["requested_features"] = requested_features
        captured["include_tags"] = include_tags
        enriched: list[BucketListingSummary] = []
        for bucket in buckets:
            tone = "active" if bucket.name == "alpha" else "inactive"
            state = "Configured" if bucket.name == "alpha" else "Not set"
            enriched.append(
                BucketListingSummary(
                    name=bucket.name,
                    tenant=bucket.tenant,
                    owner=bucket.owner,
                    owner_name=bucket.owner_name,
                    features={
                        "notifications": {"state": state, "tone": tone},
                    },
                )
            )
        return enriched

    monkeypatch.setattr(storage_ops_listing_service, "enrich_buckets", fake_enrich_buckets)
    monkeypatch.setattr(
        storage_ops_listing_service,
        "get_cached_bucket_listing_for_account",
        lambda **kwargs: kwargs["builder"](),
    )

    result = storage_ops_listing_service.list_storage_ops_context_buckets(
        context=context,
        service=FakeBucketsService(),
        needs_stats=False,
        requested_features={"notifications"},
        include_tags=False,
        parsed_filter=parsed_filter,
        normalized_search="",
        filter_requires_owner_name=False,
        filter_requires_owner_suspended=False,
        filter_requires_owner_quota=False,
        owner_usage_required=False,
    )

    assert captured["requested_features"] == {"notifications"}
    assert captured["include_tags"] is False
    assert [bucket.bucket_name for bucket in result] == ["alpha"]


def test_storage_ops_notification_param_filter_uses_shared_snapshot_matching(monkeypatch):
    parsed_filter = BucketFilterQuery.model_validate(
        {
            "match": "all",
            "rules": [
                {"feature": "notifications", "param": "notification_topic_name", "op": "contains", "value": "images-topic"},
                {"feature": "notifications", "param": "notification_event", "op": "has", "value": "s3:ObjectCreated:*"},
            ],
        }
    )
    account = S3Account(
        name="storage-ops-notification-params",
        rgw_account_id="RGW00000000000000002",
        rgw_access_key="AKIA_TEST",
        rgw_secret_key="SECRET_TEST",
    )
    context = storage_ops_listing_service.StorageOpsResolvedContext(
        ref=storage_ops_listing_service.StorageOpsContextRef(
            context_id="1",
            context_name="Account A",
            context_kind="account",
            endpoint_id=1,
            endpoint_name="Primary",
        ),
        account=account,
    )

    class FakeBucketsService(_CompositeConfigurationStub):
        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            return [Bucket(name="alpha"), Bucket(name="beta")]

        def get_bucket_notifications(self, bucket_name, account):  # noqa: ARG002
            event = "s3:ObjectCreated:*" if bucket_name == "alpha" else "s3:ObjectRemoved:*"
            return BucketNotificationConfiguration(
                configuration={
                    "TopicConfigurations": [
                        {
                            "Id": f"{bucket_name}-topic",
                            "TopicArn": "arn:aws:sns:us-east-1:123456789012:images-topic",
                            "Events": [event],
                        }
                    ]
                }
            )

    monkeypatch.setattr(
        storage_ops_listing_service,
        "get_cached_bucket_listing_for_account",
        lambda **kwargs: kwargs["builder"](),
    )

    result = storage_ops_listing_service.list_storage_ops_context_buckets(
        context=context,
        service=FakeBucketsService(),
        needs_stats=False,
        requested_features=set(),
        include_tags=False,
        parsed_filter=parsed_filter,
        normalized_search="",
        filter_requires_owner_name=False,
        filter_requires_owner_suspended=False,
        filter_requires_owner_quota=False,
        owner_usage_required=False,
    )

    assert [bucket.bucket_name for bucket in result] == ["alpha"]


def test_storage_ops_owner_quota_and_usage_use_context_principal_and_resolve_connection_once(client, monkeypatch):
    identity_calls: list[int] = []

    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            make_execution_context(
                kind="account",
                id="1",
                display_name="Account A",
                endpoint_name="Primary",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            make_execution_context(
                kind="connection",
                id="conn-2",
                display_name="Connection B",
                endpoint_name="Archive",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=False),
            ),
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        if account_ref == "1":
            return SimpleNamespace(
                context_id="1",
                rgw_account_id="RGW00000000000000011",
                rgw_user_uid="root-11",
                storage_endpoint=SimpleNamespace(id=11),
            )
        if account_ref == "conn-2":
            return SimpleNamespace(
                context_id="conn-2",
                rgw_account_id=None,
                rgw_user_uid=None,
                storage_endpoint=SimpleNamespace(id=12),
                source_connection=SimpleNamespace(id=22),
            )
        raise AssertionError(f"unexpected context {account_ref}")

    class FakeBucketsService(_CompositeConfigurationStub):
        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            if account.context_id == "1":
                return [Bucket(name="alpha", used_bytes=40, object_count=4), Bucket(name="beta", used_bytes=60, object_count=6)]
            if account.context_id == "conn-2":
                return [Bucket(name="gamma", used_bytes=20, object_count=2), Bucket(name="delta", used_bytes=30, object_count=3)]
            return []

    def fake_resolve_rgw_identity(self, connection):  # noqa: ANN001
        identity_calls.append(connection.id)
        return ConnectionIdentityResolution(
            rgw_user_uid="user-conn",
            rgw_account_id="tenant-conn",
            metrics_enabled=True,
            usage_enabled=True,
            reason=None,
        )

    def fake_enrich_buckets(self, buckets, *, include_name=False, include_quota=False, include_usage=False, usage_by_key=None):  # noqa: ANN001, ARG002
        if include_usage:
            total_bytes = sum(int(bucket.used_bytes or 0) for bucket in buckets)
            total_objects = sum(int(bucket.object_count or 0) for bucket in buckets)
            for bucket in buckets:
                bucket.owner_used_bytes = total_bytes
                bucket.owner_object_count = total_objects
        for bucket in buckets:
            if include_name:
                bucket.owner_name = f"Owner {bucket.owner}"
            if include_quota:
                bucket.owner_quota_max_size_bytes = 200
                bucket.owner_quota_max_objects = 20
        return buckets

    monkeypatch.setattr(storage_ops_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_router, "get_account_context", fake_get_account_context)
    monkeypatch.setattr(storage_ops_listing_service.ConnectionIdentityService, "resolve_rgw_identity", fake_resolve_rgw_identity)
    monkeypatch.setattr(storage_ops_listing_service.BucketOwnerMetadataService, "enrich_buckets", fake_enrich_buckets)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    app.dependency_overrides[storage_ops_router.get_buckets_service] = lambda: FakeBucketsService()
    try:
        response = client.get(
            "/api/storage-ops/buckets",
            params=[
                ("include", "owner_name"),
                ("include", "owner_quota"),
                ("include", "owner_quota_usage"),
            ],
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["total"] == 4
        items = {item["name"]: item for item in payload["items"]}

        assert items["1::alpha"]["owner"] == "RGW00000000000000011"
        assert items["1::alpha"]["owner_name"] == "Owner RGW00000000000000011"
        assert items["1::alpha"]["owner_used_bytes"] == 100
        assert items["1::alpha"]["owner_quota_max_size_bytes"] == 200

        assert items["conn-2::gamma"]["tenant"] == "tenant-conn"
        assert items["conn-2::gamma"]["owner"] == "user-conn"
        assert items["conn-2::gamma"]["owner_name"] == "Owner user-conn"
        assert items["conn-2::gamma"]["owner_used_bytes"] == 50
        assert items["conn-2::gamma"]["owner_quota_max_size_bytes"] == 200

        assert identity_calls == [22]
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(storage_ops_router.get_buckets_service, None)


def test_storage_ops_bucket_quota_usage_percent_filter_forces_stats_and_filters_results(client, monkeypatch):
    stats_flags: list[bool] = []

    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            make_execution_context(
                kind="account",
                id="1",
                display_name="Account A",
                endpoint_name="Primary",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            )
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        return SimpleNamespace(context_id=account_ref)

    class FakeBucketsService(_CompositeConfigurationStub):
        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            stats_flags.append(with_stats)
            return [
                Bucket(name="alpha", used_bytes=60, object_count=6, quota_max_size_bytes=100, quota_max_objects=10),
                Bucket(name="beta", used_bytes=10, object_count=1),
            ]

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [{"field": "quota_usage_size_percent", "op": "gte", "value": 50}],
        }
    )

    monkeypatch.setattr(storage_ops_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_router, "get_account_context", fake_get_account_context)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    app.dependency_overrides[storage_ops_router.get_buckets_service] = lambda: FakeBucketsService()
    try:
        response = client.get(
            "/api/storage-ops/buckets",
            params={"advanced_filter": advanced_filter, "with_stats": "false"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert [item["name"] for item in payload["items"]] == ["1::alpha"]
        assert stats_flags == [True]
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(storage_ops_router.get_buckets_service, None)


def test_storage_ops_bucket_listing_does_not_expose_quota_write_availability(client, monkeypatch):
    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            make_execution_context(
                kind="account",
                id="1",
                display_name="Account A",
                endpoint_name="Primary",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            )
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        return SimpleNamespace(
            context_id=account_ref,
            storage_endpoint=SimpleNamespace(
                provider="ceph",
                admin_access_key="admin-ak",
                admin_secret_key="admin-sk",
                features_config='{"features":{"admin":{"enabled":true,"endpoint":"https://admin.example.test"}}}',
            ),
        )

    class FakeBucketsService(_CompositeConfigurationStub):
        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            return [Bucket(name="alpha")]

    monkeypatch.setattr(storage_ops_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_router, "get_account_context", fake_get_account_context)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    app.dependency_overrides[storage_ops_router.get_buckets_service] = lambda: FakeBucketsService()
    try:
        response = client.get("/api/storage-ops/buckets")
        assert response.status_code == 200
        payload = response.json()
        assert "bucket_quota_available" not in payload["items"][0]
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(storage_ops_router.get_buckets_service, None)


def test_storage_ops_bucket_quota_update_route_is_removed(client):
    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    try:
        response = client.put(
            "/api/storage-ops/buckets/conn-2%3A%3Ademo-bucket/quota",
            json={"max_size_gb": 3, "max_size_unit": "GiB", "max_objects": 3000},
        )
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)

    assert response.status_code in {404, 405}


def test_storage_ops_bucket_listing_filters_by_owner_suspended_status(client, monkeypatch):
    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            make_execution_context(
                kind="account",
                id="active",
                display_name="Active user",
                endpoint_name="Primary",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            make_execution_context(
                kind="account",
                id="suspended",
                display_name="Suspended user",
                endpoint_name="Primary",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        return SimpleNamespace(
            context_id=account_ref,
            rgw_account_id=None,
            rgw_user_uid=f"user-{account_ref}",
            storage_endpoint=SimpleNamespace(id=21),
        )

    class FakeBucketsService(_CompositeConfigurationStub):
        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            return [Bucket(name=f"bucket-{account.context_id}")]

    def fake_enrich_buckets(
        self,
        buckets,
        *,
        include_name=False,
        include_suspended=False,
        include_quota=False,
        include_usage=False,
        usage_by_key=None,
    ):  # noqa: ANN001, ARG002
        assert include_suspended is True
        for bucket in buckets:
            bucket.owner_suspended = bucket.owner == "user-suspended"
        return buckets

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [{"field": "owner_suspended", "op": "eq", "value": True}],
        }
    )

    monkeypatch.setattr(storage_ops_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_router, "get_account_context", fake_get_account_context)
    monkeypatch.setattr(storage_ops_listing_service.BucketOwnerMetadataService, "enrich_buckets", fake_enrich_buckets)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    app.dependency_overrides[storage_ops_router.get_buckets_service] = lambda: FakeBucketsService()
    try:
        response = client.get(
            "/api/storage-ops/buckets",
            params={"advanced_filter": advanced_filter, "with_stats": "false"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert [item["name"] for item in payload["items"]] == ["suspended::bucket-suspended"]
        assert payload["items"][0]["owner_suspended"] is True
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(storage_ops_router.get_buckets_service, None)


def test_storage_ops_owner_identity_failures_leave_owner_quota_fields_null(client, monkeypatch):
    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            make_execution_context(
                kind="connection",
                id="conn-3",
                display_name="Connection C",
                endpoint_name="Archive",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=False),
            )
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        return SimpleNamespace(
            context_id=account_ref,
            rgw_account_id=None,
            rgw_user_uid=None,
            storage_endpoint=SimpleNamespace(id=13),
            source_connection=SimpleNamespace(id=33),
        )

    class FakeBucketsService(_CompositeConfigurationStub):
        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            return [Bucket(name="orphan", used_bytes=7, object_count=1)]

    def fake_resolve_rgw_identity(self, connection):  # noqa: ANN001, ARG002
        return ConnectionIdentityResolution(
            rgw_user_uid=None,
            rgw_account_id=None,
            metrics_enabled=True,
            usage_enabled=True,
            reason="identity unavailable",
        )

    monkeypatch.setattr(storage_ops_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_router, "get_account_context", fake_get_account_context)
    monkeypatch.setattr(storage_ops_listing_service.ConnectionIdentityService, "resolve_rgw_identity", fake_resolve_rgw_identity)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    app.dependency_overrides[storage_ops_router.get_buckets_service] = lambda: FakeBucketsService()
    try:
        response = client.get(
            "/api/storage-ops/buckets",
            params=[
                ("include", "owner_name"),
                ("include", "owner_quota"),
                ("include", "owner_quota_usage"),
            ],
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["total"] == 1
        item = payload["items"][0]
        assert item["name"] == "conn-3::orphan"
        assert item["owner"] is None
        assert item["owner_name"] is None
        assert item["owner_quota_max_size_bytes"] is None
        assert item["owner_used_bytes"] is None
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(storage_ops_router.get_buckets_service, None)
