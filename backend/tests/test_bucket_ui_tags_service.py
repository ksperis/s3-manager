# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.db import (
    AuditLog,
    BucketUiTagAssignment,
    S3Account,
    StorageEndpoint,
    StorageProvider,
    TagDefinition,
    User,
    UserRole,
)
from app.models.bucket import Bucket
from app.models.bucket_ui_tags import StorageOpsBucketUiTagPatchRequest
from app.services.bucket_ui_tags_service import BucketUiTagsService, PhysicalBucketTarget
from app.services.ceph_admin_bucket_listing_service import compute_ceph_admin_bucket_listing
from app.services.s3_execution_context import S3ExecutionContext
from app.services.rgw_admin import RGWAdminError
from app.services.storage_ops_bucket_listing_service import (
    StorageOpsContextRef,
    compute_storage_ops_bucket_listing,
)
from app.services.users_service import UsersService
from app.services.audit_service import AuditService
from app.services.bucket_listing_cache import get_cached_bucket_listing_for_account
from app.services.buckets_service import get_buckets_service
from app.services.storage_endpoints_service import StorageEndpointsService
from app.main import app
from app.routers import dependencies
from app.routers.ceph_admin import dependencies as ceph_dependencies
from app.routers.storage_ops import bucket_ui_tags as storage_bucket_ui_tags_router
from app.utils.tagging import (
    TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
    TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
)


def _user(identifier: int, email: str) -> User:
    return User(
        id=identifier,
        email=email,
        full_name=email,
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )


def _endpoint(db_session, name: str) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider=StorageProvider.CEPH.value,
        is_default=False,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.flush()
    return endpoint


def test_ceph_admin_private_and_shared_same_label_are_distinct_and_visible(db_session):
    owner = _user(8101, "owner@example.test")
    other = _user(8102, "other@example.test")
    endpoint = _endpoint(db_session, "ui-tags-ceph")
    db_session.add_all([owner, other])
    db_session.commit()
    target = PhysicalBucketTarget.create(endpoint.id, "tenant-a", "bucket-a")
    service = BucketUiTagsService(db_session)

    service.mutate(
        domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
        actor_user_id=owner.id,
        targets=[target],
        add_tag_ids=[],
        create_tags=[
            ("Production", "blue", "private"),
            ("Production", "amber", "shared"),
        ],
        remove_tag_ids=[],
    )
    # Repeating the same operation is idempotent.
    service.mutate(
        domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
        actor_user_id=owner.id,
        targets=[target],
        add_tag_ids=[],
        create_tags=[("Production", "rose", "shared")],
        remove_tag_ids=[],
    )
    db_session.commit()

    owner_catalog = service.catalog(
        domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
        actor_user_id=owner.id,
        endpoint_id=endpoint.id,
    )
    other_catalog = service.catalog(
        domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
        actor_user_id=other.id,
        endpoint_id=endpoint.id,
    )

    assert [(item.label, item.visibility) for item in owner_catalog.definitions] == [
        ("Production", "private"),
        ("Production", "shared"),
    ]
    assert [(item.label, item.visibility, item.color_key) for item in other_catalog.definitions] == [
        ("Production", "shared", "amber")
    ]
    assert len(owner_catalog.assignments) == 1
    assert len(owner_catalog.assignments[0].tag_ids) == 2
    assert other_catalog.assignments[0].tag_ids == [other_catalog.definitions[0].id]


def test_storage_ops_tags_are_private_and_physical_identity_isolated(db_session):
    owner = _user(8201, "storage-owner@example.test")
    other = _user(8202, "storage-other@example.test")
    endpoint_a = _endpoint(db_session, "ui-tags-storage-a")
    endpoint_b = _endpoint(db_session, "ui-tags-storage-b")
    db_session.add_all([owner, other])
    db_session.commit()
    service = BucketUiTagsService(db_session)
    target_a = PhysicalBucketTarget.create(endpoint_a.id, "", "same-name")
    target_b = PhysicalBucketTarget.create(endpoint_b.id, "", "same-name")

    service.mutate(
        domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
        actor_user_id=owner.id,
        targets=[target_a],
        add_tag_ids=[],
        create_tags=[("Mine", "teal", "private")],
        remove_tag_ids=[],
    )
    db_session.commit()

    assert service.catalog(
        domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
        actor_user_id=other.id,
    ).definitions == []
    mapped = service.get_tags_for_targets(
        domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
        actor_user_id=owner.id,
        targets=[target_a, target_b],
    )
    assert [tag.label for tag in mapped[target_a]] == ["Mine"]
    assert mapped[target_b] == []


def test_storage_ops_contract_rejects_shared_fields_and_more_than_200_targets():
    with pytest.raises(ValidationError):
        StorageOpsBucketUiTagPatchRequest.model_validate(
            {
                "targets": [{"context_id": "1", "name": "bucket"}],
                "create_tags": [{"label": "forged", "visibility": "shared"}],
            }
        )


def test_bucket_ui_tag_routes_persist_ceph_visibility_and_reject_forged_storage_context(
    client,
    db_session,
    monkeypatch,
):
    owner = _user(8241, "route-owner@example.test")
    endpoint = _endpoint(db_session, "ui-tags-routes")
    db_session.add(owner)
    db_session.commit()

    class FakeRgwAdmin:
        def get_bucket_info(self, bucket, **_kwargs):
            return {"bucket": bucket}

    ctx = SimpleNamespace(
        endpoint=endpoint,
        actor=owner,
        audit_service=AuditService(db_session),
        rgw_admin=FakeRgwAdmin(),
    )
    app.dependency_overrides[dependencies.require_ceph_admin_enabled] = lambda: None
    app.dependency_overrides[ceph_dependencies.get_ceph_admin_context] = lambda: ctx
    response = client.patch(
        f"/api/ceph-admin/endpoints/{endpoint.id}/bucket-ui-tags",
        json={
            "targets": [{"name": "bucket-a", "tenant": ""}],
            "create_tags": [
                {"label": "Private", "color_key": "blue", "visibility": "private"},
                {"label": "Shared", "color_key": "amber", "visibility": "shared"},
            ],
        },
    )
    assert response.status_code == 200, response.text
    assert {(item["label"], item["visibility"]) for item in response.json()["definitions"]} == {
        ("Private", "private"),
        ("Shared", "shared"),
    }
    shared_logs = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "bucket_ui_tags.update_shared")
        .all()
    )
    assert len(shared_logs) == 1
    assert json.loads(shared_logs[0].metadata_json or "{}") == {
        "endpoint_id": endpoint.id,
        "endpoint_name": endpoint.name,
        "target_count": 1,
    }

    private_id = next(
        item["id"]
        for item in response.json()["definitions"]
        if item["visibility"] == "private"
    )
    private_only = client.patch(
        f"/api/ceph-admin/endpoints/{endpoint.id}/bucket-ui-tags",
        json={
            "targets": [{"name": "bucket-b", "tenant": ""}],
            "add_tag_ids": [private_id],
        },
    )
    assert private_only.status_code == 200, private_only.text
    assert (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "bucket_ui_tags.update_shared")
        .count()
        == 1
    )

    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = lambda: owner
    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    monkeypatch.setattr(storage_bucket_ui_tags_router, "_collect_context_refs", lambda _user, _db: [])
    storage_service = BucketUiTagsService(db_session)
    storage_service.mutate(
        domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
        actor_user_id=owner.id,
        targets=[PhysicalBucketTarget.create(endpoint.id, "", "revoked-bucket")],
        add_tag_ids=[],
        create_tags=[("Revoked context tag", "teal", "private")],
        remove_tag_ids=[],
    )
    db_session.commit()
    revoked_catalog = client.get("/api/storage-ops/bucket-ui-tags")
    assert revoked_catalog.status_code == 200, revoked_catalog.text
    assert [item["label"] for item in revoked_catalog.json()["definitions"]] == [
        "Revoked context tag"
    ]
    assert revoked_catalog.json()["assignments"] == []

    forged = client.patch(
        "/api/storage-ops/bucket-ui-tags",
        json={
            "targets": [{"context_id": "forged", "name": "bucket-a"}],
            "create_tags": [{"label": "Mine"}],
        },
    )
    assert forged.status_code == 403, forged.text

    shared = client.patch(
        "/api/storage-ops/bucket-ui-tags",
        json={
            "targets": [{"context_id": "forged", "name": "bucket-a"}],
            "create_tags": [{"label": "Forged", "visibility": "shared"}],
        },
    )
    assert shared.status_code == 422, shared.text
    with pytest.raises(ValidationError):
        StorageOpsBucketUiTagPatchRequest.model_validate(
            {
                "targets": [
                    {"context_id": "1", "name": f"bucket-{index}"}
                    for index in range(201)
                ]
            }
        )


def test_ceph_shared_mutation_survives_audit_persistence_rollback(
    client,
    db_session,
):
    owner = _user(8242, "audit-rollback-owner@example.test")
    endpoint = _endpoint(db_session, "ui-tags-audit-rollback")
    db_session.add(owner)
    db_session.commit()

    class FakeRgwAdmin:
        def get_bucket_info(self, bucket, **_kwargs):
            return {"bucket": bucket}

    class RollingBackAuditService:
        def record_action(self, **_kwargs):
            # AuditService rolls the request session back when its own commit
            # fails. The feature mutation must already be durable at that point.
            db_session.rollback()

    ctx = SimpleNamespace(
        endpoint=endpoint,
        actor=owner,
        audit_service=RollingBackAuditService(),
        rgw_admin=FakeRgwAdmin(),
    )
    app.dependency_overrides[dependencies.require_ceph_admin_enabled] = lambda: None
    app.dependency_overrides[ceph_dependencies.get_ceph_admin_context] = lambda: ctx

    response = client.patch(
        f"/api/ceph-admin/endpoints/{endpoint.id}/bucket-ui-tags",
        json={
            "targets": [{"name": "bucket-a", "tenant": ""}],
            "create_tags": [
                {"label": "Shared", "color_key": "amber", "visibility": "shared"},
            ],
        },
    )

    assert response.status_code == 200, response.text
    assert [(item["label"], item["visibility"]) for item in response.json()["definitions"]] == [
        ("Shared", "shared")
    ]
    assert len(response.json()["assignments"]) == 1


def test_ceph_target_validation_returns_bad_gateway_when_rgw_cannot_verify(
    client,
    db_session,
):
    owner = _user(8244, "rgw-validation-owner@example.test")
    endpoint = _endpoint(db_session, "ui-tags-rgw-validation")
    db_session.add(owner)
    db_session.commit()

    class FailingRgwAdmin:
        def get_bucket_info(self, _bucket, **_kwargs):
            raise RGWAdminError("RGW verification unavailable")

    ctx = SimpleNamespace(
        endpoint=endpoint,
        actor=owner,
        audit_service=AuditService(db_session),
        rgw_admin=FailingRgwAdmin(),
    )
    app.dependency_overrides[dependencies.require_ceph_admin_enabled] = lambda: None
    app.dependency_overrides[ceph_dependencies.get_ceph_admin_context] = lambda: ctx

    response = client.patch(
        f"/api/ceph-admin/endpoints/{endpoint.id}/bucket-ui-tags",
        json={
            "targets": [{"name": "bucket-a", "tenant": ""}],
            "create_tags": [{"label": "Private", "visibility": "private"}],
        },
    )

    assert response.status_code == 502, response.text


def test_storage_orphan_cleanup_revalidates_outside_the_shared_listing_cache(
    client,
    db_session,
    monkeypatch,
):
    owner = _user(8243, "storage-revalidation-owner@example.test")
    endpoint = _endpoint(db_session, "ui-tags-storage-revalidation")
    account_row = S3Account(
        name="storage-revalidation-account",
        rgw_account_id="RGW-REVALIDATION",
        rgw_user_uid="storage-revalidation-user",
        rgw_access_key="AK-REVALIDATION",
        rgw_secret_key="SK-REVALIDATION",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add_all([owner, account_row])
    db_session.commit()
    account = S3ExecutionContext.from_account(account_row)
    target = PhysicalBucketTarget.create(endpoint.id, "", "reappeared")
    tag_service = BucketUiTagsService(db_session)
    tag_service.mutate(
        domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
        actor_user_id=owner.id,
        targets=[target],
        add_tag_ids=[],
        create_tags=[("Keep me", "teal", "private")],
        remove_tag_ids=[],
    )
    db_session.commit()

    # Prime the shared listing cache with the obsolete state in which the
    # bucket was absent. The mutation route must bypass this cached value.
    get_cached_bucket_listing_for_account(
        account=account,
        include=set(),
        with_stats=False,
        builder=lambda: [],
    )
    ref = StorageOpsContextRef(
        context_id=str(account_row.id),
        context_name=account_row.name,
        context_kind="account",
        endpoint_id=endpoint.id,
        endpoint_name=endpoint.name,
    )

    class FakeBucketsService:
        calls = 0

        def list_buckets(self, _account, include=None, with_stats=False):  # noqa: ARG002
            self.calls += 1
            return [Bucket(name="reappeared")]

    buckets = FakeBucketsService()
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = lambda: owner
    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[get_buckets_service] = lambda: buckets
    monkeypatch.setattr(storage_bucket_ui_tags_router, "_collect_context_refs", lambda _user, _db: [ref])
    monkeypatch.setattr(
        storage_bucket_ui_tags_router,
        "_resolve_context_account",
        lambda _ref, **_kwargs: account,
    )

    response = client.patch(
        "/api/storage-ops/bucket-ui-tags",
        json={
            "targets": [{"context_id": ref.context_id, "name": "reappeared"}],
            "remove_all": True,
            "require_absent": True,
        },
    )

    assert response.status_code == 409, response.text
    assert buckets.calls == 1
    remaining = tag_service.catalog(
        domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
        actor_user_id=owner.id,
    )
    assert len(remaining.assignments) == 1


def test_deleting_user_removes_private_bucket_definitions_without_promoting_them(db_session):
    owner = _user(8251, "deleted-owner@example.test")
    endpoint = _endpoint(db_session, "ui-tags-user-delete")
    db_session.add(owner)
    db_session.commit()
    service = BucketUiTagsService(db_session)
    target = PhysicalBucketTarget.create(endpoint.id, "", "bucket-a")
    service.mutate(
        domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
        actor_user_id=owner.id,
        targets=[target],
        add_tag_ids=[],
        create_tags=[("Private", "slate", "private"), ("Shared", "green", "shared")],
        remove_tag_ids=[],
    )
    db_session.commit()

    UsersService(db_session).delete_user(owner.id)

    remaining = service.catalog(
        domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
        actor_user_id=99999,
        endpoint_id=endpoint.id,
    )
    assert [(tag.label, tag.visibility) for tag in remaining.definitions] == [("Shared", "shared")]
    assert remaining.assignments[0].tag_ids == [remaining.definitions[0].id]


def test_successful_bucket_deletion_cleanup_removes_both_namespaces_only_for_target(db_session):
    owner = _user(8261, "cleanup-owner@example.test")
    endpoint = _endpoint(db_session, "ui-tags-cleanup")
    db_session.add(owner)
    db_session.commit()
    service = BucketUiTagsService(db_session)
    deleted = PhysicalBucketTarget.create(endpoint.id, "tenant-a", "deleted")
    survivor = PhysicalBucketTarget.create(endpoint.id, "tenant-a", "survivor")

    for domain in (TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN, TAG_DOMAIN_BUCKET_UI_STORAGE_OPS):
        service.mutate(
            domain_kind=domain,
            actor_user_id=owner.id,
            targets=[deleted, survivor],
            add_tag_ids=[],
            create_tags=[(f"{domain}-tag", "blue", "private")],
            remove_tag_ids=[],
        )
    db_session.commit()

    service.remove_all_namespaces_for_bucket(deleted)
    db_session.commit()

    for domain in (TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN, TAG_DOMAIN_BUCKET_UI_STORAGE_OPS):
        catalog = service.catalog(
            domain_kind=domain,
            actor_user_id=owner.id,
            endpoint_id=endpoint.id,
        )
        assert len(catalog.definitions) == 1
        assert [(item.target.name, item.tag_ids) for item in catalog.assignments] == [
            ("survivor", [catalog.definitions[0].id])
        ]


def test_endpoint_deletion_cascades_bucket_assignments_and_cleans_definitions(db_session):
    owner = _user(8262, "endpoint-cleanup-owner@example.test")
    endpoint = _endpoint(db_session, "ui-tags-endpoint-cleanup")
    db_session.add(owner)
    db_session.commit()
    service = BucketUiTagsService(db_session)
    service.mutate(
        domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
        actor_user_id=owner.id,
        targets=[PhysicalBucketTarget.create(endpoint.id, "", "bucket-a")],
        add_tag_ids=[],
        create_tags=[("Endpoint tag", "blue", "private")],
        remove_tag_ids=[],
    )
    db_session.commit()

    StorageEndpointsService(db_session).delete_endpoint(endpoint.id)

    assert db_session.query(BucketUiTagAssignment).count() == 0
    assert (
        db_session.query(TagDefinition)
        .filter(TagDefinition.domain_kind == TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN)
        .count()
        == 0
    )


def test_storage_ops_ui_tag_filter_runs_before_pagination_and_supports_any_all(db_session):
    owner = _user(8301, "listing-owner@example.test")
    endpoint = _endpoint(db_session, "ui-tags-listing")
    account_row = S3Account(
        name="listing-account",
        rgw_account_id="RGW-LISTING",
        rgw_user_uid="listing-user",
        rgw_access_key="AK-LISTING",
        rgw_secret_key="SK-LISTING",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add_all([owner, account_row])
    db_session.commit()
    account = S3ExecutionContext.from_account(account_row)
    service = BucketUiTagsService(db_session)
    targets = [PhysicalBucketTarget.create(endpoint.id, "", name) for name in ("a", "b", "c")]
    service.mutate(
        domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
        actor_user_id=owner.id,
        targets=targets[:2],
        add_tag_ids=[],
        create_tags=[("Blue", "blue", "private")],
        remove_tag_ids=[],
    )
    blue_id = service.catalog(
        domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
        actor_user_id=owner.id,
    ).definitions[0].id
    service.mutate(
        domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
        actor_user_id=owner.id,
        targets=targets[1:],
        add_tag_ids=[],
        create_tags=[("Gold", "amber", "private")],
        remove_tag_ids=[],
    )
    catalog = service.catalog(
        domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
        actor_user_id=owner.id,
    )
    gold_id = next(item.id for item in catalog.definitions if item.label == "Gold")
    db_session.commit()

    class FakeBucketsService:
        configuration = object()

        def list_buckets(self, _account, include=None, with_stats=True):  # noqa: ARG002
            return [Bucket(name=name) for name in ("a", "b", "c")]

    ref = StorageOpsContextRef(
        context_id=str(account_row.id),
        context_name=account_row.name,
        context_kind="account",
        endpoint_id=endpoint.id,
        endpoint_name=endpoint.name,
    )
    common = {
        "load_context_refs": lambda: [ref],
        "resolve_account": lambda _ref: account,
        "service": FakeBucketsService(),
        "page": 1,
        "page_size": 1,
        "filter": None,
        "advanced_filter": None,
        "sort_by": "name",
        "sort_dir": "asc",
        "include": [],
        "with_stats": False,
        "bucket_ui_tags_service": service,
        "actor_user_id": owner.id,
    }
    any_result = compute_storage_ops_bucket_listing(
        **common,
        ui_tag_ids=[blue_id, gold_id],
        ui_tag_match="any",
    )
    all_result = compute_storage_ops_bucket_listing(
        **common,
        ui_tag_ids=[blue_id, gold_id],
        ui_tag_match="all",
    )

    assert any_result.total == 3
    assert any_result.items[0].bucket_name == "a"
    assert [tag.label for tag in any_result.items[0].ui_tags] == ["Blue"]
    assert all_result.total == 1
    assert all_result.items[0].bucket_name == "b"
    assert {tag.label for tag in all_result.items[0].ui_tags} == {"Blue", "Gold"}


def test_storage_ops_replicates_private_tags_across_contexts_for_the_same_physical_bucket(
    db_session,
):
    owner = _user(8302, "shared-physical-bucket-owner@example.test")
    endpoint = _endpoint(db_session, "ui-tags-shared-physical-bucket")
    account_row = S3Account(
        name="shared-physical-bucket-account",
        rgw_account_id="RGW-SHARED-PHYSICAL",
        rgw_user_uid="shared-physical-user",
        rgw_access_key="AK-SHARED-PHYSICAL",
        rgw_secret_key="SK-SHARED-PHYSICAL",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add_all([owner, account_row])
    db_session.commit()
    account = S3ExecutionContext.from_account(account_row)
    service = BucketUiTagsService(db_session)
    service.mutate(
        domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
        actor_user_id=owner.id,
        targets=[PhysicalBucketTarget.create(endpoint.id, "", "shared-bucket")],
        add_tag_ids=[],
        create_tags=[("Across contexts", "violet", "private")],
        remove_tag_ids=[],
    )
    db_session.commit()

    class FakeBucketsService:
        configuration = object()

        def list_buckets(self, _account, include=None, with_stats=True):  # noqa: ARG002
            return [Bucket(name="shared-bucket")]

    refs = [
        StorageOpsContextRef(
            context_id=context_id,
            context_name=context_id,
            context_kind=context_kind,
            endpoint_id=endpoint.id,
            endpoint_name=endpoint.name,
        )
        for context_id, context_kind in (("account-context", "account"), ("user-context", "s3_user"))
    ]
    result = compute_storage_ops_bucket_listing(
        load_context_refs=lambda: refs,
        resolve_account=lambda _ref: account,
        service=FakeBucketsService(),
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=None,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        bucket_ui_tags_service=service,
        actor_user_id=owner.id,
    )

    assert result.total == 2
    assert {item.context_id for item in result.items} == {"account-context", "user-context"}
    assert [[tag.label for tag in item.ui_tags] for item in result.items] == [
        ["Across contexts"],
        ["Across contexts"],
    ]


def test_ceph_admin_ui_tag_filter_runs_before_pagination_and_does_not_taint_shared_cache(
    db_session,
):
    owner = _user(8401, "ceph-listing-owner@example.test")
    other = _user(8402, "ceph-listing-other@example.test")
    endpoint = _endpoint(db_session, "ui-tags-ceph-listing")
    db_session.add_all([owner, other])
    db_session.commit()
    service = BucketUiTagsService(db_session)
    targets = [
        PhysicalBucketTarget.create(endpoint.id, "tenant-a", name)
        for name in ("a", "b", "c")
    ]
    service.mutate(
        domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
        actor_user_id=owner.id,
        targets=targets[:2],
        add_tag_ids=[],
        create_tags=[("Blue", "blue", "private")],
        remove_tag_ids=[],
    )
    blue_id = service.catalog(
        domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
        actor_user_id=owner.id,
        endpoint_id=endpoint.id,
    ).definitions[0].id
    service.mutate(
        domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
        actor_user_id=owner.id,
        targets=targets[1:],
        add_tag_ids=[],
        create_tags=[("Gold", "amber", "private")],
        remove_tag_ids=[],
    )
    catalog = service.catalog(
        domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
        actor_user_id=owner.id,
        endpoint_id=endpoint.id,
    )
    gold_id = next(item.id for item in catalog.definitions if item.label == "Gold")
    db_session.commit()

    class FakeRgwAdmin:
        def get_all_buckets(self, with_stats=True):  # noqa: ARG002
            return [
                {"name": name, "tenant": "tenant-a", "owner": "owner-a"}
                for name in ("a", "b", "c")
            ]

    ctx = SimpleNamespace(
        endpoint=endpoint,
        rgw_admin=FakeRgwAdmin(),
        access_key="AK-UI-TAGS",
        secret_key="SK-UI-TAGS",
    )
    common = {
        "page": 1,
        "page_size": 1,
        "filter": None,
        "advanced_filter": None,
        "sort_by": "name",
        "sort_dir": "asc",
        "include": [],
        "with_stats": False,
        "ctx": ctx,
        "bucket_ui_tags_service": service,
    }
    any_result = compute_ceph_admin_bucket_listing(
        **common,
        ui_tag_ids=[blue_id, gold_id],
        ui_tag_match="any",
        actor_user_id=owner.id,
    )
    all_result = compute_ceph_admin_bucket_listing(
        **common,
        ui_tag_ids=[blue_id, gold_id],
        ui_tag_match="all",
        actor_user_id=owner.id,
    )
    other_result = compute_ceph_admin_bucket_listing(
        **common,
        ui_tag_ids=[],
        actor_user_id=other.id,
    )

    assert any_result.total == 3
    assert any_result.items[0].name == "a"
    assert [tag.label for tag in any_result.items[0].ui_tags] == ["Blue"]
    assert all_result.total == 1
    assert all_result.items[0].name == "b"
    assert {tag.label for tag in all_result.items[0].ui_tags} == {"Blue", "Gold"}
    assert other_result.total == 3
    assert all(item.ui_tags == [] for item in other_result.items)
