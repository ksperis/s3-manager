# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from types import SimpleNamespace
import threading
import time

import pytest
from fastapi import HTTPException

from app.db import User, UserRole
from app.models.bucket import Bucket
from app.models.ceph_admin import CephAdminBucketFilterQuery, CephAdminBucketSummary
from app.models.execution_context import ExecutionContext, ExecutionContextCapabilities
from app.models.storage_ops import PaginatedStorageOpsBucketsResponse, StorageOpsBucketSummary
from app.routers import dependencies
from app.routers.storage_ops import buckets as storage_ops_router
from app.services import app_settings_service
from app.main import app


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


def test_get_current_storage_ops_admin_rejects_standard_user_without_storage_ops_right():
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


def test_get_current_storage_ops_admin_rejects_admin_without_storage_ops_right():
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


def test_get_current_storage_ops_admin_accepts_admin_with_storage_ops_right():
    user = _admin_user()
    assert dependencies.get_current_storage_ops_admin(user=user).id == user.id


def test_get_current_storage_ops_admin_accepts_standard_user_with_storage_ops_right():
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
    monkeypatch.setattr(dependencies, "load_app_settings", lambda: settings)
    with pytest.raises(HTTPException) as exc:
        dependencies.require_storage_ops_enabled()
    assert exc.value.status_code == 403


def test_storage_ops_listing_aggregates_contexts_and_exposes_context_fields(client, monkeypatch):
    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            ExecutionContext(
                kind="account",
                id="1",
                display_name="Account A",
                endpoint_name="Endpoint One",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            ExecutionContext(
                kind="connection",
                id="conn-2",
                display_name="Connection B",
                endpoint_name="Endpoint Two",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=False),
            ),
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        return SimpleNamespace(context_id=account_ref)

    class FakeBucketsService:
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
        assert payload["total"] == 4
        assert payload["has_next"] is False
        encoded_names = {item["name"] for item in payload["items"]}
        assert "1::shared" in encoded_names
        assert "conn-2::shared" in encoded_names
        first = payload["items"][0]
        assert "context_id" in first
        assert "context_name" in first
        assert "context_kind" in first
        assert "endpoint_name" in first
        assert "bucket_name" in first
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(storage_ops_router.get_buckets_service, None)


def test_storage_ops_stream_emits_progress_and_result(client, monkeypatch):
    def fake_compute_listing(**kwargs):  # noqa: ARG001
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
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)


def test_storage_ops_listing_fanout_runs_in_parallel(client, monkeypatch):
    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            ExecutionContext(
                kind="account",
                id="1",
                display_name="Account A",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            ExecutionContext(
                kind="account",
                id="2",
                display_name="Account B",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            ExecutionContext(
                kind="connection",
                id="conn-3",
                display_name="Connection C",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=False),
            ),
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        return SimpleNamespace(context_id=account_ref)

    class FakeBucketsService:
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

    monkeypatch.setattr(storage_ops_router, "_load_feature_param_snapshots", fake_load_feature_param_snapshots)
    monkeypatch.setattr(storage_ops_router, "_match_feature_param_rules", lambda rules, match_mode, snapshot: True)

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
    parsed_filter = CephAdminBucketFilterQuery.model_validate(
        {
            "match": "all",
            "rules": [
                {"field": "name", "op": "eq", "value": "alpha"},
                {"feature": "lifecycle_rules", "param": "lifecycle_rule_id", "op": "eq", "value": "rule-1"},
            ],
        }
    )
    result = storage_ops_router._apply_advanced_filter_for_context(
        buckets,
        parsed_filter,
        service=SimpleNamespace(),
        account=SimpleNamespace(),
    )
    assert [bucket.name for bucket in result] == ["alpha"]
    assert captured["bucket_names"] == ["alpha"]


def test_storage_ops_advanced_filter_parsing_accepts_context_fields():
    parsed = CephAdminBucketFilterQuery.model_validate(
        {
            "match": "all",
            "rules": [
                {"field": "context_name", "op": "contains", "value": "Account"},
                {"field": "context_kind", "op": "eq", "value": "account"},
                {"field": "endpoint_name", "op": "contains", "value": "Primary"},
            ],
        }
    )
    assert parsed.rules is not None
    assert [rule.field for rule in parsed.rules] == ["context_name", "context_kind", "endpoint_name"]


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
    parsed_filter = CephAdminBucketFilterQuery.model_validate(
        {
            "match": "all",
            "rules": [
                {"field": "context_name", "op": "contains", "value": "account"},
                {"field": "context_kind", "op": "eq", "value": "account"},
                {"field": "endpoint_name", "op": "contains", "value": "primary"},
            ],
        }
    )
    result = storage_ops_router._apply_advanced_filter_for_context(
        buckets,
        parsed_filter,
        service=SimpleNamespace(),
        account=SimpleNamespace(),
    )
    assert [bucket.bucket_name for bucket in result] == ["alpha"]


def test_storage_ops_list_and_stream_apply_context_advanced_filters(client, monkeypatch):
    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            ExecutionContext(
                kind="account",
                id="1",
                display_name="Account A",
                endpoint_name="Primary Endpoint",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            ExecutionContext(
                kind="connection",
                id="conn-2",
                display_name="Connection B",
                endpoint_name="Archive Endpoint",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=False),
            ),
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        return SimpleNamespace(context_id=account_ref)

    class FakeBucketsService:
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
            ExecutionContext(
                kind="account",
                id="1",
                display_name="Account A",
                endpoint_name="Primary",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            ExecutionContext(
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

    class FakeBucketsService:
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


def test_storage_ops_context_prefilter_keeps_other_contexts_for_match_any_mixed_rules(client, monkeypatch):
    resolved_contexts: list[str] = []

    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            ExecutionContext(
                kind="account",
                id="1",
                display_name="Account A",
                endpoint_name="Primary",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            ),
            ExecutionContext(
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

    class FakeBucketsService:
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
            ExecutionContext(
                kind="account",
                id="1",
                display_name="Account A",
                endpoint_name="Primary",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            )
        ]

    def fake_get_account_context(*, request, account_ref, actor, db):  # noqa: ARG001
        return SimpleNamespace(context_id=account_ref)

    class FakeBucketsService:
        def list_buckets(self, account, include=None, with_stats=True):  # noqa: ARG002
            return [Bucket(name="alpha", used_bytes=1), Bucket(name="beta", used_bytes=1)]

    def fake_enrich_buckets(buckets, requested_features, include_tags, service, account):  # noqa: ANN001, ARG001
        enrich_inputs.append([bucket.name for bucket in buckets])
        enriched: list[CephAdminBucketSummary] = []
        for bucket in buckets:
            tone = "active" if bucket.name == "alpha" else "inactive"
            state = "Enabled" if bucket.name == "alpha" else "Disabled"
            enriched.append(
                CephAdminBucketSummary(
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
    monkeypatch.setattr(storage_ops_router, "_enrich_buckets", fake_enrich_buckets)

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
