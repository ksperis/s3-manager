# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import timedelta
import io
import json
import time
from types import SimpleNamespace
from unittest.mock import patch

from botocore.exceptions import ClientError
from botocore.parsers import ResponseParserError
from sqlalchemy.orm import sessionmaker

from app.db import BucketMigration, BucketMigrationEvent, BucketMigrationItem, S3Account, S3User, StorageEndpoint, User, UserRole
from app.models.bucket_migration import BucketMigrationBucketMapping, BucketMigrationCreateRequest
from app.services.bucket_migration_service import (
    BucketMigrationService,
    BucketMigrationWorker,
    _BucketMigrationWebhookDispatcher,
    _DB_ERROR_MESSAGE_MAX_CHARS,
    _DB_EVENT_MESSAGE_MAX_CHARS,
)


def _create_user(db_session) -> User:
    user = User(
        email="admin@example.com",
        full_name="Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )
    db_session.add(user)
    db_session.flush()
    return user


def _create_account(db_session, *, name: str, endpoint_url: str, account_id: str) -> S3Account:
    endpoint = StorageEndpoint(
        name=f"{name}-endpoint",
        endpoint_url=endpoint_url,
        region="us-east-1",
        provider="ceph",
        is_default=False,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.flush()

    account = S3Account(
        name=name,
        rgw_account_id=account_id,
        rgw_access_key=f"AKIA-{name}",
        rgw_secret_key=f"SECRET-{name}",
        storage_endpoint_id=endpoint.id,
    )
    account.storage_endpoint = endpoint
    db_session.add(account)
    db_session.flush()
    return account


def _create_s3_user(db_session, *, name: str, endpoint: StorageEndpoint, uid: str) -> S3User:
    s3_user = S3User(
        name=name,
        rgw_user_uid=uid,
        email=f"{name}@example.test",
        rgw_access_key=f"AKIA-{name}",
        rgw_secret_key=f"SECRET-{name}",
        storage_endpoint_id=endpoint.id,
    )
    s3_user.storage_endpoint = endpoint
    db_session.add(s3_user)
    db_session.flush()
    return s3_user


def _app_settings_stub(
    *,
    parallelism_default: int = 16,
    parallelism_max: int = 16,
    max_active_per_endpoint: int = 2,
):
    return SimpleNamespace(
        manager=SimpleNamespace(
            bucket_migration_parallelism_default=parallelism_default,
            bucket_migration_parallelism_max=parallelism_max,
            bucket_migration_max_active_per_endpoint=max_active_per_endpoint,
        )
    )


def _bucket_profile_stub(
    bucket_name: str,
    *,
    versioning_status: str | None = None,
    has_noncurrent_versions: bool = False,
    has_delete_markers: bool = False,
    object_lock_enabled: bool = False,
    object_lock_mode: str | None = None,
    object_lock_days: int | None = None,
    object_lock_years: int | None = None,
    encryption_enabled: bool = False,
    encryption_supported: bool = True,
    encryption_algorithms: list[str] | None = None,
    kms_key_ids: list[str] | None = None,
    unsupported_reason: str | None = None,
    unsupported_settings: list[str] | None = None,
) -> dict[str, object]:
    return {
        "bucket_name": bucket_name,
        "versioning": {
            "status": versioning_status,
            "enabled": str(versioning_status or "").strip().lower() == "enabled",
            "suspended": str(versioning_status or "").strip().lower() == "suspended",
        },
        "version_scan": {
            "current_version_count": 1,
            "noncurrent_version_count": 1 if has_noncurrent_versions else 0,
            "delete_marker_count": 1 if has_delete_markers else 0,
            "has_noncurrent_versions": has_noncurrent_versions,
            "has_delete_markers": has_delete_markers,
            "current_version_sample": ["sample-current"],
            "noncurrent_version_sample": ["sample-noncurrent"] if has_noncurrent_versions else [],
            "delete_marker_sample": ["sample-delete-marker"] if has_delete_markers else [],
        },
        "object_lock": {
            "enabled": object_lock_enabled,
            "mode": object_lock_mode,
            "days": object_lock_days,
            "years": object_lock_years,
        },
        "encryption": {
            "enabled": encryption_enabled,
            "supported": encryption_supported,
            "algorithms": encryption_algorithms or (["AES256"] if encryption_enabled and encryption_supported else []),
            "kms_key_ids": kms_key_ids or [],
            "unsupported_reason": unsupported_reason,
            "rule_count": 1 if encryption_enabled else 0,
        },
        "supported_settings": {
            "versioning": str(versioning_status or "").strip().lower() == "enabled",
            "object_lock": object_lock_enabled,
            "encryption": encryption_enabled,
            "public_access_block": False,
            "lifecycle": False,
            "cors": False,
            "tags": False,
            "access_logging": False,
            "bucket_policy": False,
        },
        "feature_availability": {},
        "skipped_features": [],
        "unsupported_settings": list(unsupported_settings or []),
    }


def _current_only_execution_plan() -> str:
    return json.dumps(
        {
            "report_version": 2,
            "strategy": "current_only",
            "supported": True,
            "blocked": False,
            "delete_source_safe": True,
            "rollback_safe": True,
            "same_endpoint_copy_safe": True,
            "blocking_codes": [],
        }
    )


def _make_bucket_feature_probe_stub(
    *,
    get_bucket_website=None,
    get_bucket_notifications=None,
    get_bucket_replication=None,
    get_policy=None,
):
    website_calls = {"count": 0}
    notification_calls = {"count": 0}
    replication_calls = {"count": 0}
    policy_calls = {"count": 0}

    class _BucketsStub:
        def get_bucket_properties(self, *_args, **_kwargs):
            return SimpleNamespace(versioning_status=None)

        def get_bucket_object_lock(self, *_args, **_kwargs):
            return SimpleNamespace(enabled=False, mode=None, days=None, years=None)

        def get_bucket_encryption(self, *_args, **_kwargs):
            return SimpleNamespace(rules=[])

        def get_policy(self, *_args, **_kwargs):
            policy_calls["count"] += 1
            if get_policy is not None:
                return get_policy()
            return None

        def get_bucket_logging(self, *_args, **_kwargs):
            return SimpleNamespace(enabled=False, target_bucket=None)

        def get_bucket_tags(self, *_args, **_kwargs):
            return []

        def get_lifecycle(self, *_args, **_kwargs):
            return SimpleNamespace(rules=[])

        def get_bucket_cors(self, *_args, **_kwargs):
            return []

        def get_public_access_block(self, *_args, **_kwargs):
            return None

        def get_bucket_website(self, *_args, **_kwargs):
            website_calls["count"] += 1
            if get_bucket_website is not None:
                return get_bucket_website()
            return SimpleNamespace(index_document=None, error_document=None, redirect_all_requests_to=None, routing_rules=[])

        def get_bucket_notifications(self, *_args, **_kwargs):
            notification_calls["count"] += 1
            if get_bucket_notifications is not None:
                return get_bucket_notifications()
            return SimpleNamespace(configuration={})

        def get_bucket_replication(self, *_args, **_kwargs):
            replication_calls["count"] += 1
            if get_bucket_replication is not None:
                return get_bucket_replication()
            return SimpleNamespace(configuration={})

        def get_bucket_acl(self, *_args, **_kwargs):
            return SimpleNamespace(owner=None, grants=[])

    return _BucketsStub(), website_calls, notification_calls, replication_calls, policy_calls


def test_create_migration_creates_items_and_defaults(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mapping_prefix="mig-",
        mode="pre_sync",
        copy_bucket_settings=True,
        delete_source=True,
        auto_grant_source_read_for_copy=False,
        buckets=[
            BucketMigrationBucketMapping(source_bucket="bucket-a"),
            BucketMigrationBucketMapping(source_bucket="bucket-b", target_bucket="custom-b"),
        ],
    )

    migration = service.create_migration(payload, user)

    assert migration.status == "draft"
    assert migration.total_items == 2
    assert migration.mode == "pre_sync"
    assert migration.lock_target_writes is True
    assert migration.strong_integrity_check is False
    assert migration.use_same_endpoint_copy is False
    assert migration.auto_grant_source_read_for_copy is False
    by_source = {item.source_bucket: item for item in migration.items}
    assert by_source["bucket-a"].target_bucket == "mig-bucket-a"
    assert by_source["bucket-b"].target_bucket == "custom-b"


def test_create_migration_uses_admin_default_parallelism(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a")],
    )

    with patch(
        "app.services.bucket_migration_service.load_app_settings",
        return_value=_app_settings_stub(parallelism_default=7, parallelism_max=12),
    ):
        migration = service.create_migration(payload, user)

    assert migration.parallelism_max == 7
    assert migration.use_same_endpoint_copy is False
    assert migration.auto_grant_source_read_for_copy is False


def test_create_migration_defaults_auto_grant_to_true_when_same_endpoint_copy_enabled(db_session):
    user = _create_user(db_session)
    endpoint = "https://same.example.test"
    source = _create_account(db_session, name="source", endpoint_url=endpoint, account_id="RGW001")
    target = S3Account(
        name="target",
        rgw_account_id="RGW002",
        rgw_access_key="AKIA-target",
        rgw_secret_key="SECRET-target",
        storage_endpoint_id=source.storage_endpoint_id,
    )
    target.storage_endpoint = source.storage_endpoint
    db_session.add(target)
    db_session.flush()
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        use_same_endpoint_copy=True,
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-copy")],
    )

    migration = service.create_migration(payload, user)

    assert migration.use_same_endpoint_copy is True
    assert migration.auto_grant_source_read_for_copy is True


def test_create_migration_rejects_cross_account_when_admin_scope_missing_on_one_side(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(
        db_session,
        admin_account_context_ids={str(source.id)},
    )
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-copy")],
    )

    try:
        service.create_migration(payload, user)
        assert False, "Expected create_migration to reject cross-account migration without admin scope on both accounts"
    except PermissionError as exc:
        assert "admin access on both source and target account contexts" in str(exc).lower()


def test_create_migration_accepts_cross_account_when_admin_scope_present_on_both_sides(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(
        db_session,
        admin_account_context_ids={str(source.id), str(target.id)},
    )
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-copy")],
    )

    migration = service.create_migration(payload, user)
    assert migration.id is not None


def test_create_migration_rejects_same_endpoint_copy_for_cross_endpoint_contexts(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        use_same_endpoint_copy=True,
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-copy")],
    )

    try:
        service.create_migration(payload, user)
        assert False, "Expected create_migration to reject same-endpoint copy across different endpoints"
    except ValueError as exc:
        assert "x-amz-copy-source can only be enabled" in str(exc)


def test_create_migration_rejects_auto_grant_when_same_endpoint_copy_disabled(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        use_same_endpoint_copy=False,
        auto_grant_source_read_for_copy=True,
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-copy")],
    )

    try:
        service.create_migration(payload, user)
        assert False, "Expected create_migration to reject auto-grant without same-endpoint copy"
    except ValueError as exc:
        assert "auto_grant_source_read_for_copy cannot be enabled" in str(exc)


def test_create_migration_clamps_requested_parallelism_to_admin_max(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        parallelism_max=42,
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a")],
    )

    with patch(
        "app.services.bucket_migration_service.load_app_settings",
        return_value=_app_settings_stub(parallelism_default=7, parallelism_max=10),
    ):
        migration = service.create_migration(payload, user)

    assert migration.parallelism_max == 10


def test_update_draft_migration_replaces_configuration_and_resets_precheck(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    target_alt = _create_account(db_session, name="target-alt", endpoint_url="https://target-alt.example.test", account_id="RGW003")
    db_session.commit()

    service = BucketMigrationService(db_session)
    created = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            mapping_prefix="legacy-",
            mode="pre_sync",
            copy_bucket_settings=True,
            delete_source=True,
            lock_target_writes=True,
            auto_grant_source_read_for_copy=False,
            buckets=[
                BucketMigrationBucketMapping(source_bucket="bucket-a"),
                BucketMigrationBucketMapping(source_bucket="bucket-b"),
            ],
        ),
        user,
    )
    created.precheck_status = "failed"
    created.precheck_report_json = '{"status":"failed"}'
    created.precheck_checked_at = created.created_at
    first_item = created.items[0]
    first_item.status = "failed"
    first_item.step = "verify"
    first_item.objects_copied = 12
    first_item.source_count = 42
    first_item.target_count = 11
    first_item.error_message = "some previous error"
    db_session.commit()

    updated = service.update_draft_migration(
        created.id,
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target_alt.id),
            mapping_prefix="new-",
            mode="one_shot",
            copy_bucket_settings=False,
            delete_source=False,
            lock_target_writes=False,
            use_same_endpoint_copy=False,
            auto_grant_source_read_for_copy=False,
            webhook_url="https://example.com/migration",
            buckets=[
                BucketMigrationBucketMapping(source_bucket="bucket-a"),
                BucketMigrationBucketMapping(source_bucket="bucket-c", target_bucket="custom-c"),
            ],
        ),
    )

    assert updated.id == created.id
    assert updated.target_context_id == str(target_alt.id)
    assert updated.mode == "one_shot"
    assert updated.copy_bucket_settings is False
    assert updated.delete_source is False
    assert updated.strong_integrity_check is False
    assert updated.lock_target_writes is False
    assert updated.use_same_endpoint_copy is False
    assert updated.auto_grant_source_read_for_copy is False
    assert updated.mapping_prefix == "new-"
    assert updated.webhook_url == "https://example.com/migration"
    assert updated.status == "draft"
    assert updated.precheck_status == "pending"
    assert updated.precheck_report_json is None
    assert updated.precheck_checked_at is None
    assert updated.total_items == 2
    assert updated.completed_items == 0
    assert updated.failed_items == 0
    assert updated.skipped_items == 0
    assert updated.awaiting_items == 0

    by_source = {item.source_bucket: item for item in updated.items}
    assert set(by_source.keys()) == {"bucket-a", "bucket-c"}
    assert by_source["bucket-a"].target_bucket == "new-bucket-a"
    assert by_source["bucket-c"].target_bucket == "custom-c"
    assert all(item.status == "pending" for item in by_source.values())
    assert all(item.step == "create_bucket" for item in by_source.values())
    assert all(item.objects_copied == 0 for item in by_source.values())
    assert all(item.objects_deleted == 0 for item in by_source.values())
    assert all(item.error_message is None for item in by_source.values())
    assert all(item.source_snapshot_json is None for item in by_source.values())
    assert all(item.target_snapshot_json is None for item in by_source.values())
    assert all(item.execution_plan_json is None for item in by_source.values())
    assert any(event.message == "Migration configuration updated." for event in updated.events)


def test_update_draft_migration_rejects_cross_account_when_admin_scope_missing_on_one_side(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    creator_service = BucketMigrationService(db_session)
    migration = creator_service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a")],
        ),
        user,
    )

    service = BucketMigrationService(
        db_session,
        admin_account_context_ids={str(source.id)},
    )
    try:
        service.update_draft_migration(
            migration.id,
            BucketMigrationCreateRequest(
                source_context_id=str(source.id),
                target_context_id=str(target.id),
                buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-copy")],
            ),
        )
        assert False, "Expected update_draft_migration to reject cross-account migration without admin scope on both accounts"
    except PermissionError as exc:
        assert "admin access on both source and target account contexts" in str(exc).lower()


def test_update_draft_migration_rejects_non_draft_status(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a")],
        ),
        user,
    )
    migration.status = "queued"
    migration.precheck_status = "passed"
    db_session.commit()

    try:
        service.update_draft_migration(
            migration.id,
            BucketMigrationCreateRequest(
                source_context_id=str(source.id),
                target_context_id=str(target.id),
                buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="new-bucket-a")],
            ),
        )
        assert False, "Expected update_draft_migration to fail for non-draft migrations"
    except ValueError as exc:
        assert "Only draft migrations can be updated" in str(exc)


def test_update_draft_migration_rejects_same_endpoint_copy_for_cross_endpoint_contexts(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-copy")],
        ),
        user,
    )

    try:
        service.update_draft_migration(
            migration.id,
            BucketMigrationCreateRequest(
                source_context_id=str(source.id),
                target_context_id=str(target.id),
                use_same_endpoint_copy=True,
                buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-copy")],
            ),
        )
        assert False, "Expected update_draft_migration to reject same-endpoint copy across different endpoints"
    except ValueError as exc:
        assert "x-amz-copy-source can only be enabled" in str(exc)


def test_update_draft_migration_rejects_auto_grant_when_same_endpoint_copy_disabled(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-copy")],
        ),
        user,
    )

    try:
        service.update_draft_migration(
            migration.id,
            BucketMigrationCreateRequest(
                source_context_id=str(source.id),
                target_context_id=str(target.id),
                use_same_endpoint_copy=False,
                auto_grant_source_read_for_copy=True,
                buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-copy")],
            ),
        )
        assert False, "Expected update_draft_migration to reject auto-grant without same-endpoint copy"
    except ValueError as exc:
        assert "auto_grant_source_read_for_copy cannot be enabled" in str(exc)


def test_continue_after_presync_moves_items_to_cutover_step(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="pre_sync",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a")],
    )
    migration = service.create_migration(payload, user)

    migration.status = "awaiting_cutover"
    migration.items[0].status = "awaiting_cutover"
    migration.items[0].step = "awaiting_cutover"
    db_session.commit()

    updated = service.continue_after_presync(migration.id)

    assert updated.status == "queued"
    assert updated.items[0].status == "pending"
    assert updated.items[0].step == "apply_read_only"


def test_claim_next_runnable_migration_assigns_exclusive_lease(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a")],
    )
    migration = service.create_migration(payload, user)
    migration.status = "queued"
    migration.precheck_status = "passed"
    db_session.commit()

    claimed_by_worker_1 = service.claim_next_runnable_migration_id(worker_id="worker-1", lease_seconds=120)
    claimed_by_worker_2 = service.claim_next_runnable_migration_id(worker_id="worker-2", lease_seconds=120)

    db_session.refresh(migration)
    assert claimed_by_worker_1 == migration.id
    assert claimed_by_worker_2 is None
    assert migration.worker_lease_owner == "worker-1"
    assert migration.worker_lease_until is not None


def test_claim_next_runnable_migration_reclaims_expired_lease(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a")],
    )
    migration = service.create_migration(payload, user)
    migration.status = "queued"
    migration.precheck_status = "passed"
    db_session.commit()

    first_claim = service.claim_next_runnable_migration_id(worker_id="worker-1", lease_seconds=120)
    assert first_claim == migration.id
    db_session.refresh(migration)
    assert migration.worker_lease_until is not None
    migration.worker_lease_until = migration.worker_lease_until - timedelta(minutes=10)
    db_session.commit()

    second_claim = service.claim_next_runnable_migration_id(worker_id="worker-2", lease_seconds=120)
    db_session.refresh(migration)
    assert second_claim == migration.id
    assert migration.worker_lease_owner == "worker-2"


def test_claim_next_runnable_migration_respects_max_active_per_endpoint(db_session):
    user = _create_user(db_session)
    source_a = _create_account(db_session, name="source-a", endpoint_url="https://shared.example.test", account_id="RGW001")
    source_b_user = _create_s3_user(
        db_session,
        name="source-b-user",
        endpoint=source_a.storage_endpoint,
        uid="source-b-uid",
    )
    source_c = _create_account(db_session, name="source-c", endpoint_url="https://source-c.example.test", account_id="RGW003")
    target_a = _create_account(db_session, name="target-a", endpoint_url="https://target-a.example.test", account_id="RGW101")
    target_b = _create_account(db_session, name="target-b", endpoint_url="https://target-b.example.test", account_id="RGW102")
    target_c = _create_account(db_session, name="target-c", endpoint_url="https://target-c.example.test", account_id="RGW103")
    db_session.commit()

    service = BucketMigrationService(db_session)

    migration_a = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source_a.id),
            target_context_id=str(target_a.id),
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a")],
        ),
        user,
    )
    migration_b = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=f"s3u-{source_b_user.id}",
            target_context_id=str(target_b.id),
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-b")],
        ),
        user,
    )
    migration_c = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source_c.id),
            target_context_id=str(target_c.id),
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-c")],
        ),
        user,
    )
    for migration in (migration_a, migration_b, migration_c):
        migration.status = "queued"
        migration.precheck_status = "passed"
    db_session.commit()

    with patch(
        "app.services.bucket_migration_service.load_app_settings",
        return_value=_app_settings_stub(max_active_per_endpoint=1),
    ):
        first_claim = service.claim_next_runnable_migration_id(worker_id="worker-1", lease_seconds=120)
        second_claim = service.claim_next_runnable_migration_id(worker_id="worker-2", lease_seconds=120)

    assert first_claim == migration_a.id
    assert second_claim == migration_c.id


def test_claim_next_runnable_migration_rechecks_endpoint_limit_after_claim(db_session):
    user = _create_user(db_session)
    source_a = _create_account(db_session, name="source-a", endpoint_url="https://shared.example.test", account_id="RGW001")
    source_b_user = _create_s3_user(
        db_session,
        name="source-b-user",
        endpoint=source_a.storage_endpoint,
        uid="source-b-uid",
    )
    target_a = _create_account(db_session, name="target-a", endpoint_url="https://target-a.example.test", account_id="RGW101")
    target_b = _create_account(db_session, name="target-b", endpoint_url="https://target-b.example.test", account_id="RGW102")
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration_a = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source_a.id),
            target_context_id=str(target_a.id),
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a")],
        ),
        user,
    )
    migration_b = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=f"s3u-{source_b_user.id}",
            target_context_id=str(target_b.id),
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-b")],
        ),
        user,
    )
    for migration in (migration_a, migration_b):
        migration.status = "queued"
        migration.precheck_status = "passed"
    db_session.commit()

    test_session_factory = sessionmaker(autocommit=False, autoflush=False, bind=db_session.get_bind())
    with test_session_factory() as db_worker_1, test_session_factory() as db_worker_2:
        service_worker_1 = BucketMigrationService(db_worker_1)
        service_worker_2 = BucketMigrationService(db_worker_2)
        with patch(
            "app.services.bucket_migration_service.load_app_settings",
            return_value=_app_settings_stub(max_active_per_endpoint=1),
        ):
            with patch.object(service_worker_1, "_active_endpoint_usage", return_value={}), patch.object(
                service_worker_2, "_active_endpoint_usage", return_value={}
            ):
                first_claim = service_worker_1.claim_next_runnable_migration_id(worker_id="worker-1", lease_seconds=120)
                second_claim = service_worker_2.claim_next_runnable_migration_id(worker_id="worker-2", lease_seconds=120)

    db_session.refresh(migration_a)
    db_session.refresh(migration_b)

    assert first_claim == migration_a.id
    assert second_claim is None
    assert migration_a.worker_lease_owner == "worker-1"
    assert migration_b.worker_lease_owner is None


def test_bucket_already_exists_error_detection(db_session):
    service = BucketMigrationService(db_session)
    assert service._is_bucket_already_exists_error(RuntimeError("An error occurred (BucketAlreadyExists)"))
    assert service._is_bucket_already_exists_error(RuntimeError("An error occurred (BucketAlreadyOwnedByYou)"))
    assert not service._is_bucket_already_exists_error(RuntimeError("An error occurred (AccessDenied)"))


def test_create_migration_rejects_same_bucket_name_on_same_endpoint(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://same.example.test", account_id="RGW001")
    target_user = _create_s3_user(db_session, name="target-user", endpoint=source.storage_endpoint, uid="target-user-uid")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=f"s3u-{target_user.id}",
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a")],
    )

    try:
        service.create_migration(payload, user)
        assert False, "Expected create_migration to fail for same-bucket mapping on same endpoint"
    except ValueError as exc:
        assert "target bucket must differ from source bucket" in str(exc)


def test_apply_read_only_policy_uses_supported_actions(db_session):
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    db_session.commit()

    captured: dict[str, object] = {}

    class _BucketsStub:
        def get_policy(self, *_args, **_kwargs):
            return None

        def put_policy(self, _bucket_name, _account, policy):
            captured["policy"] = policy

    service = BucketMigrationService(db_session)
    service._buckets = _BucketsStub()  # type: ignore[assignment]

    item = SimpleNamespace(source_policy_backup_json=None)
    service._apply_read_only_policy(source, "bucket-a", item)

    statement = (captured["policy"] or {}).get("Statement", [])[0]
    actions = statement.get("Action", [])
    assert "s3:PutObject" in actions
    assert "s3:DeleteObject" in actions
    assert "s3:AbortMultipartUpload" in actions
    assert "s3:DeleteBucket" in actions
    assert "s3:Put*" not in actions
    assert "s3:Delete*" not in actions
    assert "s3:ObjectOwnerOverrideToBucketOwner" not in actions


def test_set_managed_block_policy_can_keep_put_block_without_delete_deny(db_session):
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    db_session.commit()

    captured: dict[str, object] = {}

    class _BucketsStub:
        def get_policy(self, *_args, **_kwargs):
            return None

        def put_policy(self, _bucket_name, _account, policy):
            captured["policy"] = policy

    service = BucketMigrationService(db_session)
    service._buckets = _BucketsStub()  # type: ignore[assignment]

    service._set_managed_block_policy("bucket-a", source, deny_delete=False)

    statement = (captured["policy"] or {}).get("Statement", [])[0]
    actions = statement.get("Action", [])
    assert "s3:PutObject" in actions
    assert "s3:AbortMultipartUpload" in actions
    assert "s3:DeleteObject" not in actions
    assert "s3:DeleteBucket" not in actions


def test_apply_target_write_lock_policy_uses_migration_user_agent_condition(db_session):
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    captured: dict[str, object] = {}

    class _BucketsStub:
        def get_policy(self, *_args, **_kwargs):
            return None

        def put_policy(self, _bucket_name, _account, policy):
            captured["policy"] = policy

    service = BucketMigrationService(db_session)
    service._buckets = _BucketsStub()  # type: ignore[assignment]

    item = SimpleNamespace(target_policy_backup_json=None)
    service._validate_target_lock_worker_access = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._apply_target_write_lock_policy(SimpleNamespace(account=target), "bucket-a", item)

    statement = (captured["policy"] or {}).get("Statement", [])[0]
    actions = statement.get("Action", [])
    condition = statement.get("Condition", {})
    user_agent_cond = condition.get("StringNotLike", {}).get("aws:UserAgent")

    assert statement.get("Sid") == "S3ManagerMigrationTargetWriteLockDeny"
    assert "s3:PutObject" in actions
    assert "s3:DeleteObject" in actions
    assert isinstance(user_agent_cond, str)
    assert "s3-manager-migration-worker" in user_agent_cond


def test_build_source_copy_grant_policy_uses_target_principal(db_session):
    service = BucketMigrationService(db_session)
    policy = service._build_source_copy_grant_policy(
        "bucket-a",
        None,
        principal="arn:aws:iam:::user/target-user",
    )

    statement = (policy.get("Statement") or [])[0]
    assert statement.get("Sid") == "S3ManagerMigrationSourceCopyGrantAllow"
    assert statement.get("Effect") == "Allow"
    assert statement.get("Principal", {}).get("AWS") == "arn:aws:iam:::user/target-user"
    actions = statement.get("Action", [])
    assert "s3:GetObject" in actions
    assert "s3:GetObjectVersion" in actions


def test_precheck_same_endpoint_copy_source_access_can_use_temporary_auto_grant(db_session):
    source = _create_account(db_session, name="source", endpoint_url="https://same.example.test", account_id="RGW001")
    target_user = _create_s3_user(
        db_session,
        name="target-user",
        endpoint=source.storage_endpoint,
        uid="target-user",
    )
    db_session.commit()

    service = BucketMigrationService(db_session)
    source_ctx = SimpleNamespace(context_id=str(source.id), account=source)
    target_ctx = SimpleNamespace(
        context_id=f"s3u-{target_user.id}",
        account=SimpleNamespace(
            rgw_account_id=None,
            rgw_user_uid=target_user.rgw_user_uid,
        ),
    )

    class _SourceClient:
        def list_objects_v2(self, **_kwargs):
            return {"Contents": [{"Key": "object-a"}]}

    class _TargetClient:
        allow = False

        def head_object(self, **_kwargs):
            if self.allow:
                return {"ContentLength": 12}
            raise ClientError(
                {
                    "Error": {"Code": "AccessDenied", "Message": "Denied"},
                    "ResponseMetadata": {"HTTPStatusCode": 403},
                },
                "HeadObject",
            )

    target_client = _TargetClient()

    service._context_client = (  # type: ignore[method-assign]
        lambda ctx: _SourceClient() if ctx is source_ctx else target_client
    )

    class _BucketsStub:
        def get_policy(self, *_args, **_kwargs):
            return None

        def put_policy(self, *_args, **_kwargs):
            target_client.allow = True

        def delete_policy(self, *_args, **_kwargs):
            target_client.allow = False

    service._buckets = _BucketsStub()  # type: ignore[assignment]

    result = service._precheck_same_endpoint_copy_source_access(
        source_ctx,
        target_ctx,
        "bucket-a",
        auto_grant=True,
    )

    assert result == "validated_with_temporary_grant"
    assert target_client.allow is False


def test_copy_single_object_falls_back_to_stream_copy_on_copy_source_access_denied(db_session):
    service = BucketMigrationService(db_session)
    source_ctx = SimpleNamespace()
    target_ctx = SimpleNamespace()
    source_client = SimpleNamespace(get_object=lambda **_kwargs: {"Body": io.BytesIO(b"payload")})

    copied: list[tuple[str, str]] = []

    class _TargetClient:
        def copy_object(self, **_kwargs):
            raise ClientError(
                {
                    "Error": {"Code": "AccessDenied", "Message": "Denied"},
                    "ResponseMetadata": {"HTTPStatusCode": 403},
                },
                "CopyObject",
            )

        def upload_fileobj(self, body, bucket, key):
            copied.append((bucket, key))
            body.read()

    target_client = _TargetClient()
    service._context_client = (  # type: ignore[method-assign]
        lambda ctx: source_client if ctx is source_ctx else target_client
    )

    service._copy_single_object(
        source_ctx,
        target_ctx,
        source_bucket="bucket-src",
        target_bucket="bucket-dst",
        key="object-key",
        same_endpoint=True,
    )

    assert copied == [("bucket-dst", "object-key")]


def test_strong_verify_single_object_prefers_head_checksum(db_session):
    service = BucketMigrationService(db_session)
    source_ctx = SimpleNamespace()
    target_ctx = SimpleNamespace()

    class _SourceClient:
        def head_object(self, **_kwargs):
            return {"ChecksumSHA256": "abc"}

        def get_object(self, **_kwargs):
            raise AssertionError("stream fallback should not be used when checksums are available")

    class _TargetClient:
        def head_object(self, **_kwargs):
            return {"ChecksumSHA256": "abc"}

        def get_object(self, **_kwargs):
            raise AssertionError("stream fallback should not be used when checksums are available")

    source_client = _SourceClient()
    target_client = _TargetClient()
    service._context_client = (  # type: ignore[method-assign]
        lambda ctx: source_client if ctx is source_ctx else target_client
    )

    verified, method = service._strong_verify_single_object(
        source_ctx,
        target_ctx,
        source_bucket="bucket-src",
        target_bucket="bucket-dst",
        key="object-key",
    )

    assert verified is True
    assert method == "head_checksum"


def test_strong_verify_single_object_falls_back_to_stream_sha256(db_session):
    service = BucketMigrationService(db_session)
    source_ctx = SimpleNamespace()
    target_ctx = SimpleNamespace()

    class _SourceClient:
        def head_object(self, **_kwargs):
            return {}

        def get_object(self, **_kwargs):
            return {"Body": io.BytesIO(b"payload")}

    class _TargetClient:
        def head_object(self, **_kwargs):
            return {}

        def get_object(self, **_kwargs):
            return {"Body": io.BytesIO(b"payload")}

    source_client = _SourceClient()
    target_client = _TargetClient()
    service._context_client = (  # type: ignore[method-assign]
        lambda ctx: source_client if ctx is source_ctx else target_client
    )

    verified, method = service._strong_verify_single_object(
        source_ctx,
        target_ctx,
        source_bucket="bucket-src",
        target_bucket="bucket-dst",
        key="object-key",
    )

    assert verified is True
    assert method == "stream_sha256"


def test_verify_blocks_delete_source_when_strong_verification_fails(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        delete_source=True,
        strong_integrity_check=True,
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a")],
    )
    migration = service.create_migration(payload, user)
    item = migration.items[0]
    item.status = "running"
    item.step = "verify"
    item.execution_plan_json = _current_only_execution_plan()
    db_session.commit()

    service._compare_buckets_streamed = lambda *_args, **_kwargs: SimpleNamespace(  # type: ignore[method-assign]
        source_count=1,
        target_count=1,
        matched_count=1,
        different_count=0,
        only_source_count=0,
        only_target_count=0,
        sample={"only_source_sample": [], "only_target_sample": [], "different_sample": []},
    )
    service._strong_verify_size_only_candidates_streamed = lambda *_args, **_kwargs: (  # type: ignore[method-assign]
        1,
        0,
        ["large-object.bin"],
        {"head_checksum": 0, "stream_sha256": 0},
    )
    source_ctx = SimpleNamespace(account=source)
    target_ctx = SimpleNamespace(account=target)

    service._run_item(migration, item, source_ctx, target_ctx, control_check=lambda: "run")

    db_session.refresh(item)
    assert item.status == "failed"
    assert item.step == "verify"
    assert item.error_message
    assert "Final strong verification failed" in item.error_message


def test_verify_allows_delete_source_when_strong_verification_succeeds(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        delete_source=True,
        strong_integrity_check=True,
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a")],
    )
    migration = service.create_migration(payload, user)
    item = migration.items[0]
    item.status = "running"
    item.step = "verify"
    item.execution_plan_json = _current_only_execution_plan()
    db_session.commit()

    service._compare_buckets_streamed = lambda *_args, **_kwargs: SimpleNamespace(  # type: ignore[method-assign]
        source_count=1,
        target_count=1,
        matched_count=1,
        different_count=0,
        only_source_count=0,
        only_target_count=0,
        sample={"only_source_sample": [], "only_target_sample": [], "different_sample": []},
    )
    service._strong_verify_size_only_candidates_streamed = lambda *_args, **_kwargs: (  # type: ignore[method-assign]
        1,
        1,
        [],
        {"head_checksum": 0, "stream_sha256": 1},
    )
    deleted: list[str] = []
    service._set_managed_block_policy = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._delete_source_bucket_with_retry = lambda bucket, *_args, **_kwargs: deleted.append(bucket)  # type: ignore[method-assign]
    source_ctx = SimpleNamespace(account=source)
    target_ctx = SimpleNamespace(account=target)

    service._run_item(migration, item, source_ctx, target_ctx, control_check=lambda: "run")

    db_session.refresh(item)
    assert item.status == "completed"
    assert item.step == "completed"
    assert deleted == ["bucket-a"]


def test_verify_delete_source_skips_strong_verification_when_disabled(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        delete_source=True,
        strong_integrity_check=False,
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a")],
    )
    migration = service.create_migration(payload, user)
    item = migration.items[0]
    item.status = "running"
    item.step = "verify"
    item.execution_plan_json = _current_only_execution_plan()
    db_session.commit()

    service._compare_buckets_streamed = lambda *_args, **_kwargs: SimpleNamespace(  # type: ignore[method-assign]
        source_count=1,
        target_count=1,
        matched_count=1,
        different_count=0,
        only_source_count=0,
        only_target_count=0,
        sample={"only_source_sample": [], "only_target_sample": [], "different_sample": []},
    )

    def _unexpected_strong_verify(*_args, **_kwargs):
        raise AssertionError("Strong verification must be skipped when strong_integrity_check is disabled")

    service._strong_verify_size_only_candidates_streamed = _unexpected_strong_verify  # type: ignore[method-assign]
    deleted: list[str] = []
    service._set_managed_block_policy = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._delete_source_bucket_with_retry = lambda bucket, *_args, **_kwargs: deleted.append(bucket)  # type: ignore[method-assign]
    source_ctx = SimpleNamespace(account=source)
    target_ctx = SimpleNamespace(account=target)

    service._run_item(migration, item, source_ctx, target_ctx, control_check=lambda: "run")

    db_session.refresh(item)
    assert item.status == "completed"
    assert item.step == "completed"
    assert deleted == ["bucket-a"]


def test_apply_read_only_policy_returns_clear_message_on_access_denied(db_session):
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    db_session.commit()

    class _BucketsStub:
        def get_policy(self, *_args, **_kwargs):
            return None

        def put_policy(self, *_args, **_kwargs):
            raise RuntimeError(
                "Unable to set bucket policy for 'bucket-a': "
                "An error occurred (AccessDenied) when calling the PutBucketPolicy operation: None"
            )

    service = BucketMigrationService(db_session)
    service._buckets = _BucketsStub()  # type: ignore[assignment]
    item = SimpleNamespace(source_policy_backup_json=None)

    try:
        service._apply_read_only_policy(source, "bucket-a", item)
        assert False, "Expected _apply_read_only_policy to fail"
    except RuntimeError as exc:
        assert "set source bucket to read-only" in str(exc)
        assert "s3:GetBucketPolicy and s3:PutBucketPolicy" in str(exc)


def test_start_migration_requires_precheck_passed(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a")],
    )
    migration = service.create_migration(payload, user)

    try:
        service.start_migration(migration.id)
        assert False, "Expected start_migration to be blocked until precheck passes"
    except ValueError as exc:
        assert "Precheck must pass before start" in str(exc)


def test_run_precheck_passed_then_start_allowed(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a")],
    )
    migration = service.create_migration(payload, user)

    def _resolve_context(context_id: str):
        return SimpleNamespace(
            context_id=context_id,
            account=source if context_id == str(source.id) else target,
            endpoint="https://s3.example.test",
            region="us-east-1",
            force_path_style=False,
            verify_tls=True,
        )

    service._resolve_context = _resolve_context  # type: ignore[method-assign]
    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._count_bucket_objects = lambda *_args, **_kwargs: 12  # type: ignore[method-assign]
    service._precheck_bucket_exists = lambda *_args, **_kwargs: False  # type: ignore[method-assign]
    service._precheck_same_endpoint_copy_source_access = lambda *_args, **_kwargs: "validated"  # type: ignore[method-assign]
    service._precheck_policy_roundtrip = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._precheck_target_lock_with_probe_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._inspector.inspect_bucket_state = lambda *_args, **_kwargs: _bucket_profile_stub("bucket-a")  # type: ignore[method-assign]

    migration = service.run_precheck(migration.id)

    assert migration.precheck_status == "passed"
    assert migration.items[0].source_count == 12
    report = json.loads(migration.precheck_report_json or "{}")
    assert report.get("errors") == 0
    assert report.get("report_version") == 2
    assert report.get("status") == "passed"
    assert migration.items[0].execution_plan_json is not None
    queued = service.start_migration(migration.id)
    assert queued.status == "queued"


def test_run_precheck_failed_blocks_start(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a")],
    )
    migration = service.create_migration(payload, user)

    def _resolve_context(context_id: str):
        return SimpleNamespace(
            context_id=context_id,
            account=source if context_id == str(source.id) else target,
            endpoint="https://s3.example.test",
            region="us-east-1",
            force_path_style=False,
            verify_tls=True,
        )

    def _fail_policy(*_args, **_kwargs):
        raise RuntimeError("Access denied")

    service._resolve_context = _resolve_context  # type: ignore[method-assign]
    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._count_bucket_objects = lambda *_args, **_kwargs: 9  # type: ignore[method-assign]
    service._precheck_bucket_exists = lambda *_args, **_kwargs: False  # type: ignore[method-assign]
    service._precheck_same_endpoint_copy_source_access = lambda *_args, **_kwargs: "validated"  # type: ignore[method-assign]
    service._precheck_policy_roundtrip = _fail_policy  # type: ignore[method-assign]
    service._inspector.inspect_bucket_state = lambda *_args, **_kwargs: _bucket_profile_stub("bucket-a")  # type: ignore[method-assign]

    migration = service.run_precheck(migration.id)
    assert migration.precheck_status == "failed"
    report = json.loads(migration.precheck_report_json or "{}")
    assert int(report.get("errors") or 0) > 0

    try:
        service.start_migration(migration.id)
        assert False, "Expected start_migration to fail when precheck is failed"
    except ValueError as exc:
        assert "Precheck must pass before start" in str(exc)


def test_run_precheck_skips_same_endpoint_copy_source_access_when_option_disabled(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://same.example.test", account_id="RGW001")
    target_user = _create_s3_user(db_session, name="target-user", endpoint=source.storage_endpoint, uid="target-user-uid")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=f"s3u-{target_user.id}",
        mode="one_shot",
        use_same_endpoint_copy=False,
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )
    migration = service.create_migration(payload, user)

    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._count_bucket_objects = lambda *_args, **_kwargs: 5  # type: ignore[method-assign]
    service._precheck_bucket_exists = lambda *_args, **_kwargs: False  # type: ignore[method-assign]
    service._precheck_policy_roundtrip = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._precheck_target_lock_with_probe_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._inspector.inspect_bucket_state = lambda *_args, **_kwargs: _bucket_profile_stub("bucket-a")  # type: ignore[method-assign]

    def _unexpected_same_endpoint_copy(*_args, **_kwargs):
        raise AssertionError("same-endpoint x-amz-copy-source precheck should be skipped when option is disabled")

    service._precheck_same_endpoint_copy_source_access = _unexpected_same_endpoint_copy  # type: ignore[method-assign]

    migration = service.run_precheck(migration.id)
    assert migration.precheck_status == "passed"
    report = json.loads(migration.precheck_report_json or "{}")
    item_messages = report.get("items", [])[0].get("messages", [])
    assert not any(
        "x-amz-copy-source" in str(message.get("message", ""))
        for message in item_messages
        if isinstance(message, dict)
    )


def test_run_precheck_fails_when_same_endpoint_copy_source_access_is_missing(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://same.example.test", account_id="RGW001")
    target_user = _create_s3_user(db_session, name="target-user", endpoint=source.storage_endpoint, uid="target-user-uid")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=f"s3u-{target_user.id}",
        mode="one_shot",
        use_same_endpoint_copy=True,
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )
    migration = service.create_migration(payload, user)

    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._count_bucket_objects = lambda *_args, **_kwargs: 5  # type: ignore[method-assign]
    service._precheck_bucket_exists = lambda *_args, **_kwargs: False  # type: ignore[method-assign]
    service._precheck_policy_roundtrip = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._precheck_target_lock_with_probe_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._inspector.inspect_bucket_state = lambda *_args, **_kwargs: _bucket_profile_stub("bucket-a")  # type: ignore[method-assign]

    def _deny_same_endpoint_copy(*_args, **_kwargs):
        raise RuntimeError("missing s3:GetObject on source")

    service._precheck_same_endpoint_copy_source_access = _deny_same_endpoint_copy  # type: ignore[method-assign]

    migration = service.run_precheck(migration.id)
    assert migration.precheck_status == "failed"
    report = json.loads(migration.precheck_report_json or "{}")
    item_messages = report.get("items", [])[0].get("messages", [])
    assert any(
        "Same-endpoint x-amz-copy-source precheck failed" in str(message.get("message", ""))
        for message in item_messages
        if isinstance(message, dict)
    )


def test_run_precheck_skips_disabled_endpoint_website_probe_when_copy_bucket_settings_enabled(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    source.storage_endpoint.features_config = "features:\n  static_website:\n    enabled: false\n  sse:\n    enabled: true\n"
    target.storage_endpoint.features_config = "features:\n  static_website:\n    enabled: false\n  sse:\n    enabled: true\n"
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            copy_bucket_settings=True,
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
        ),
        user,
    )

    def _resolve_context(context_id: str):
        return SimpleNamespace(
            context_id=context_id,
            account=source if context_id == str(source.id) else target,
            endpoint="https://s3.example.test",
            region="us-east-1",
            force_path_style=False,
            verify_tls=True,
        )

    buckets_stub, website_calls, _notification_calls, _replication_calls, _policy_calls = _make_bucket_feature_probe_stub()
    service._resolve_context = _resolve_context  # type: ignore[method-assign]
    service._buckets = buckets_stub  # type: ignore[assignment]
    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._count_bucket_objects = lambda *_args, **_kwargs: 1  # type: ignore[method-assign]
    service._precheck_bucket_exists = lambda *_args, **_kwargs: False  # type: ignore[method-assign]
    service._precheck_policy_roundtrip = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._precheck_target_lock_with_probe_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._inspector.scan_bucket_versions = lambda *_args, **_kwargs: _bucket_profile_stub("bucket-a")["version_scan"]  # type: ignore[method-assign]

    checked = service.run_precheck(migration.id)

    assert checked.precheck_status == "passed"
    assert website_calls["count"] == 0
    report = json.loads(checked.precheck_report_json or "{}")
    messages = report.get("items", [])[0].get("messages", [])
    assert not any(
        str(message.get("code", "")) == "source_profile_inspection_failed"
        for message in messages
        if isinstance(message, dict)
    )
    assert any(
        str(message.get("code", "")) == "source_feature_disabled_on_endpoint"
        and str((message.get("details") or {}).get("feature", "")) == "website"
        for message in messages
        if isinstance(message, dict)
    )


def test_run_precheck_skips_non_required_bucket_setting_probes_when_copy_bucket_settings_disabled(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    source.storage_endpoint.features_config = "features:\n  static_website:\n    enabled: true\n  sse:\n    enabled: true\n"
    target.storage_endpoint.features_config = "features:\n  static_website:\n    enabled: true\n  sse:\n    enabled: true\n"
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            copy_bucket_settings=False,
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
        ),
        user,
    )

    def _resolve_context(context_id: str):
        return SimpleNamespace(
            context_id=context_id,
            account=source if context_id == str(source.id) else target,
            endpoint="https://s3.example.test",
            region="us-east-1",
            force_path_style=False,
            verify_tls=True,
        )

    def _unexpected_website():
        raise AssertionError("Website probe must be skipped when copy_bucket_settings is disabled")

    def _unexpected_policy():
        raise AssertionError("Bucket policy probe must be skipped when copy_bucket_settings is disabled")

    buckets_stub, website_calls, _notification_calls, _replication_calls, policy_calls = _make_bucket_feature_probe_stub(
        get_bucket_website=_unexpected_website,
        get_policy=_unexpected_policy,
    )
    service._resolve_context = _resolve_context  # type: ignore[method-assign]
    service._buckets = buckets_stub  # type: ignore[assignment]
    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._count_bucket_objects = lambda *_args, **_kwargs: 1  # type: ignore[method-assign]
    service._precheck_bucket_exists = lambda *_args, **_kwargs: False  # type: ignore[method-assign]
    service._precheck_policy_roundtrip = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._precheck_target_lock_with_probe_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._inspector.scan_bucket_versions = lambda *_args, **_kwargs: _bucket_profile_stub("bucket-a")["version_scan"]  # type: ignore[method-assign]

    checked = service.run_precheck(migration.id)

    assert checked.precheck_status == "passed"
    assert website_calls["count"] == 0
    assert policy_calls["count"] == 0
    report = json.loads(checked.precheck_report_json or "{}")
    messages = report.get("items", [])[0].get("messages", [])
    assert any(
        str(message.get("code", "")) == "source_feature_skipped_not_required"
        and str((message.get("details") or {}).get("feature", "")) == "website"
        for message in messages
        if isinstance(message, dict)
    )
    assert any(
        str(message.get("code", "")) == "source_feature_skipped_not_required"
        and str((message.get("details") or {}).get("feature", "")) == "bucket_policy"
        for message in messages
        if isinstance(message, dict)
    )


def test_run_precheck_warns_when_website_probe_is_method_not_allowed_but_not_blocking(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    source.storage_endpoint.features_config = "features:\n  static_website:\n    enabled: true\n  sse:\n    enabled: true\n"
    target.storage_endpoint.features_config = "features:\n  static_website:\n    enabled: true\n  sse:\n    enabled: true\n"
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            copy_bucket_settings=True,
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
        ),
        user,
    )

    def _resolve_context(context_id: str):
        return SimpleNamespace(
            context_id=context_id,
            account=source if context_id == str(source.id) else target,
            endpoint="https://s3.example.test",
            region="us-east-1",
            force_path_style=False,
            verify_tls=True,
        )

    def _website_method_not_allowed():
        raise RuntimeError(
            "Unable to fetch bucket website for 'bucket-a': "
            "An error occurred (MethodNotAllowed) when calling the GetBucketWebsite operation: None"
        )

    buckets_stub, website_calls, _notification_calls, _replication_calls, _policy_calls = _make_bucket_feature_probe_stub(
        get_bucket_website=_website_method_not_allowed,
    )
    service._resolve_context = _resolve_context  # type: ignore[method-assign]
    service._buckets = buckets_stub  # type: ignore[assignment]
    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._count_bucket_objects = lambda *_args, **_kwargs: 1  # type: ignore[method-assign]
    service._precheck_bucket_exists = lambda *_args, **_kwargs: False  # type: ignore[method-assign]
    service._precheck_policy_roundtrip = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._precheck_target_lock_with_probe_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._inspector.scan_bucket_versions = lambda *_args, **_kwargs: _bucket_profile_stub("bucket-a")["version_scan"]  # type: ignore[method-assign]

    checked = service.run_precheck(migration.id)

    assert checked.precheck_status == "passed"
    assert website_calls["count"] == 1
    report = json.loads(checked.precheck_report_json or "{}")
    messages = report.get("items", [])[0].get("messages", [])
    assert not any(
        str(message.get("code", "")) == "source_profile_inspection_failed"
        for message in messages
        if isinstance(message, dict)
    )
    assert any(
        str(message.get("code", "")) == "source_feature_probe_unavailable"
        and str((message.get("details") or {}).get("feature", "")) == "website"
        for message in messages
        if isinstance(message, dict)
    )


def test_start_migration_requires_execution_plan_when_precheck_is_legacy(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
        ),
        user,
    )
    migration.precheck_status = "passed"
    migration.precheck_report_json = json.dumps({"status": "passed", "errors": 0})
    db_session.commit()

    try:
        service.start_migration(migration.id)
        assert False, "Expected start_migration to reject legacy precheck reports without execution plans"
    except ValueError as exc:
        assert "Precheck must be re-run before start" in str(exc)


def test_run_precheck_fails_when_source_bucket_requires_version_aware_strategy(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
        ),
        user,
    )

    def _resolve_context(context_id: str):
        return SimpleNamespace(
            context_id=context_id,
            account=source if context_id == str(source.id) else target,
            endpoint="https://s3.example.test",
            region="us-east-1",
            force_path_style=False,
            verify_tls=True,
        )

    service._resolve_context = _resolve_context  # type: ignore[method-assign]
    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._count_bucket_objects = lambda *_args, **_kwargs: 5  # type: ignore[method-assign]
    service._precheck_bucket_exists = lambda *_args, **_kwargs: False  # type: ignore[method-assign]
    service._precheck_policy_roundtrip = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._precheck_target_lock_with_probe_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._inspector.inspect_bucket_state = (  # type: ignore[method-assign]
        lambda *_args, **_kwargs: _bucket_profile_stub("bucket-a", versioning_status="Enabled", has_noncurrent_versions=True)
    )

    checked = service.run_precheck(migration.id)

    assert checked.precheck_status == "failed"
    report = json.loads(checked.precheck_report_json or "{}")
    item_report = report.get("items", [])[0]
    assert item_report.get("strategy") == "version_aware"
    assert item_report.get("blocking") is True
    assert any(
        str(message.get("code", "")) == "version_aware_required"
        for message in item_report.get("messages", [])
        if isinstance(message, dict)
    )


def test_run_precheck_fails_when_source_bucket_uses_unsupported_default_encryption(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
        ),
        user,
    )

    def _resolve_context(context_id: str):
        return SimpleNamespace(
            context_id=context_id,
            account=source if context_id == str(source.id) else target,
            endpoint="https://s3.example.test",
            region="us-east-1",
            force_path_style=False,
            verify_tls=True,
        )

    service._resolve_context = _resolve_context  # type: ignore[method-assign]
    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._count_bucket_objects = lambda *_args, **_kwargs: 5  # type: ignore[method-assign]
    service._precheck_bucket_exists = lambda *_args, **_kwargs: False  # type: ignore[method-assign]
    service._precheck_policy_roundtrip = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._precheck_target_lock_with_probe_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._inspector.inspect_bucket_state = (  # type: ignore[method-assign]
        lambda *_args, **_kwargs: _bucket_profile_stub(
            "bucket-a",
            encryption_enabled=True,
            encryption_supported=False,
            encryption_algorithms=["aws:kms"],
            kms_key_ids=["arn:aws:kms:eu-west-1:123:key/abc"],
            unsupported_reason="default SSE-KMS encryption is not supported",
        )
    )

    checked = service.run_precheck(migration.id)

    assert checked.precheck_status == "failed"
    report = json.loads(checked.precheck_report_json or "{}")
    messages = report.get("items", [])[0].get("messages", [])
    assert any(
        str(message.get("code", "")) == "unsupported_default_encryption"
        for message in messages
        if isinstance(message, dict)
    )


def test_run_precheck_fails_when_copy_bucket_settings_hits_unsupported_source_settings(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            copy_bucket_settings=True,
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
        ),
        user,
    )

    def _resolve_context(context_id: str):
        return SimpleNamespace(
            context_id=context_id,
            account=source if context_id == str(source.id) else target,
            endpoint="https://s3.example.test",
            region="us-east-1",
            force_path_style=False,
            verify_tls=True,
        )

    service._resolve_context = _resolve_context  # type: ignore[method-assign]
    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._count_bucket_objects = lambda *_args, **_kwargs: 5  # type: ignore[method-assign]
    service._precheck_bucket_exists = lambda *_args, **_kwargs: False  # type: ignore[method-assign]
    service._precheck_policy_roundtrip = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._precheck_target_lock_with_probe_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._inspector.inspect_bucket_state = (  # type: ignore[method-assign]
        lambda *_args, **_kwargs: _bucket_profile_stub("bucket-a", unsupported_settings=["website", "replication"])
    )

    checked = service.run_precheck(migration.id)

    assert checked.precheck_status == "failed"
    report = json.loads(checked.precheck_report_json or "{}")
    messages = report.get("items", [])[0].get("messages", [])
    assert any(
        str(message.get("code", "")) == "unsupported_bucket_settings_configured"
        for message in messages
        if isinstance(message, dict)
    )


def test_delete_objects_batch_falls_back_to_individual_deletes_on_invalid_xml_response(db_session):
    service = BucketMigrationService(db_session)

    class InvalidXmlDeleteClient:
        def __init__(self):
            self.batch_calls = []
            self.single_calls = []

        def delete_objects(self, **kwargs):
            self.batch_calls.append(kwargs)
            raise ResponseParserError("Unable to parse response, invalid XML received")

        def delete_object(self, **kwargs):
            self.single_calls.append(kwargs)
            return {}

    client = InvalidXmlDeleteClient()

    deleted = service._delete_objects_batch(
        client,
        "bucket-a",
        [
            {"Key": "one.txt"},
            {"Key": "two.txt", "VersionId": "v2"},
        ],
    )

    assert deleted == 2
    assert len(client.batch_calls) == 1
    assert client.single_calls == [
        {"Bucket": "bucket-a", "Key": "one.txt"},
        {"Bucket": "bucket-a", "Key": "two.txt", "VersionId": "v2"},
    ]


def test_sync_bucket_uses_stream_copy_when_same_endpoint_copy_option_is_disabled(db_session):
    service = BucketMigrationService(db_session)
    source_ctx = SimpleNamespace(endpoint="https://same.example.test", context_id="src", account=SimpleNamespace())
    target_ctx = SimpleNamespace(endpoint="https://same.example.test", context_id="dst", account=SimpleNamespace())
    migration = SimpleNamespace(
        use_same_endpoint_copy=False,
        auto_grant_source_read_for_copy=True,
        updated_at=None,
        last_heartbeat_at=None,
    )
    item = SimpleNamespace(objects_copied=0, objects_deleted=0, updated_at=None)
    diff = SimpleNamespace(
        copy_keys=["object-a"],
        delete_keys=[],
        source_count=1,
        target_count=0,
        matched_count=0,
        different_count=1,
        only_source_count=1,
        only_target_count=0,
        sample={},
    )

    captured_same_endpoint_flags: list[bool] = []
    captured_event_metadata: list[dict[str, object] | None] = []

    service._context_client = lambda *_args, **_kwargs: SimpleNamespace()  # type: ignore[method-assign]
    service._iter_bucket_diff_entries = lambda *_args, **_kwargs: iter(  # type: ignore[method-assign]
        [
            SimpleNamespace(
                kind="only_source",
                key="object-a",
                source_size=1,
                target_size=0,
                source_etag="etag-a",
                target_etag=None,
                compare_by="presence",
            )
        ]
    )
    service._run_delete_actions = lambda *_args, **_kwargs: 0  # type: ignore[method-assign]

    def _run_copy_actions_stub(*_args, **kwargs):
        captured_same_endpoint_flags.append(bool(kwargs.get("same_endpoint")))
        return 1

    def _add_event_stub(*_args, **kwargs):
        captured_event_metadata.append(kwargs.get("metadata"))

    service._run_copy_actions = _run_copy_actions_stub  # type: ignore[method-assign]
    service._add_event = _add_event_stub  # type: ignore[method-assign]

    copied, deleted, _ = service._sync_bucket(
        source_ctx,
        target_ctx,
        source_bucket="bucket-a",
        target_bucket="bucket-a-dst",
        allow_delete=False,
        parallelism_max=4,
        migration=migration,
        item=item,
        control_check=lambda: "ok",
    )

    assert copied == 1
    assert deleted == 0
    assert captured_same_endpoint_flags == [False]
    assert captured_event_metadata[0]["same_endpoint_copy"] is False


def test_restore_source_policy_replays_backup_policy_as_is(db_session):
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    db_session.commit()

    captured: dict[str, object] = {"delete_called": False}

    class _BucketsStub:
        def put_policy(self, _bucket_name, _account, policy):
            captured["policy"] = policy

        def delete_policy(self, *_args, **_kwargs):
            captured["delete_called"] = True

    service = BucketMigrationService(db_session)
    service._buckets = _BucketsStub()  # type: ignore[assignment]

    backup_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "S3ManagerMigrationReadOnlyDeny",
                "Effect": "Deny",
                "Principal": "*",
                "Action": ["s3:Put*", "s3:Delete*"],
                "Resource": ["arn:aws:s3:::bucket-a", "arn:aws:s3:::bucket-a/*"],
            },
            {
                "Sid": "KeepMe",
                "Effect": "Allow",
                "Principal": "*",
                "Action": ["s3:GetObject"],
                "Resource": ["arn:aws:s3:::bucket-a/*"],
            },
        ],
    }
    item = SimpleNamespace(source_policy_backup_json=json.dumps(backup_policy))

    service._restore_source_policy("bucket-a", source, item)

    restored = captured.get("policy")
    assert isinstance(restored, dict)
    assert restored == backup_policy
    assert captured["delete_called"] is False


def test_finalize_releases_target_lock_policy(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )
    migration = service.create_migration(payload, user)
    item = migration.items[0]
    item.status = "completed"
    item.step = "completed"
    item.target_lock_applied = True
    item.target_policy_backup_json = "{}"
    db_session.commit()

    restored: list[str] = []

    def _restore_target_write_lock_policy(_target_account, target_bucket: str, _item):
        restored.append(target_bucket)

    service._restore_target_write_lock_policy = _restore_target_write_lock_policy  # type: ignore[method-assign]

    service._finalize_or_wait_cutover(migration, target_ctx=SimpleNamespace(account=target))

    assert migration.status == "completed"
    assert restored == ["bucket-a-dst"]
    assert item.target_lock_applied is False
    assert item.target_policy_backup_json is None


def test_stop_migration_restores_source_and_target_policies(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )
    migration = service.create_migration(payload, user)
    migration.status = "paused"
    item = migration.items[0]
    item.read_only_applied = True
    item.source_policy_backup_json = "{}"
    item.target_lock_applied = True
    item.target_policy_backup_json = "{}"
    db_session.commit()

    restored_source: list[str] = []
    restored_target: list[str] = []

    def _restore_source_policy(bucket_name: str, _source_account, _item):
        restored_source.append(bucket_name)

    def _restore_target_write_lock_policy(_target_account, target_bucket: str, _item):
        restored_target.append(target_bucket)

    service._restore_source_policy = _restore_source_policy  # type: ignore[method-assign]
    service._restore_target_write_lock_policy = _restore_target_write_lock_policy  # type: ignore[method-assign]
    service._verify_restored_bucket_policy = lambda *_args, **_kwargs: None  # type: ignore[method-assign]

    updated = service.stop_migration(migration.id)

    db_session.refresh(updated)
    db_session.refresh(item)
    assert updated.status == "canceled"
    assert restored_source == ["bucket-a"]
    assert restored_target == ["bucket-a-dst"]
    assert item.read_only_applied is False
    assert item.source_policy_backup_json is None
    assert item.target_lock_applied is False
    assert item.target_policy_backup_json is None


def test_rollback_failed_migration_rejects_non_failed_status(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )
    migration = service.create_migration(payload, user)

    try:
        service.rollback_failed_migration(migration.id)
        assert False, "Expected rollback to be blocked for non-failed migration status"
    except ValueError as exc:
        assert "Rollback is only available for failed migrations" in str(exc)


def test_rollback_failed_migration_success_marks_migration_rolled_back(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[
            BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst"),
            BucketMigrationBucketMapping(source_bucket="bucket-b", target_bucket="bucket-b-dst"),
        ],
    )
    migration = service.create_migration(payload, user)
    migration.status = "failed"
    migration.items[0].status = "failed"
    migration.items[0].step = "sync"
    migration.items[0].read_only_applied = True
    migration.items[0].source_policy_backup_json = "{}"
    migration.items[0].objects_deleted = 1
    migration.items[1].status = "skipped"
    migration.items[1].step = "skipped"
    migration.items[1].read_only_applied = True
    db_session.commit()

    def _resolve_context(context_id: str):
        return SimpleNamespace(account=source if context_id == str(source.id) else target)

    restored: list[str] = []
    removed: list[str] = []
    purged: list[str] = []

    def _restore_source_policy(bucket_name: str, _source_account, _item):
        restored.append(bucket_name)

    def _remove_managed_statement(bucket_name: str, _source_account):
        removed.append(bucket_name)

    def _purge_target_bucket(_target_ctx, target_bucket: str):
        purged.append(target_bucket)
        if target_bucket == "bucket-a-dst":
            return 3, 2
        raise AssertionError(f"Unexpected purge call for {target_bucket}")

    service._resolve_context = _resolve_context  # type: ignore[method-assign]
    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._restore_source_policy = _restore_source_policy  # type: ignore[method-assign]
    service._remove_managed_read_only_statement = _remove_managed_statement  # type: ignore[method-assign]
    service._purge_target_bucket = _purge_target_bucket  # type: ignore[method-assign]

    rolled_back = service.rollback_failed_migration(migration.id)

    db_session.refresh(rolled_back)
    db_session.refresh(migration.items[0])
    db_session.refresh(migration.items[1])

    assert rolled_back.status == "rolled_back"
    assert rolled_back.error_message is None
    assert rolled_back.completed_items == 2
    assert rolled_back.failed_items == 0
    assert restored == ["bucket-a"]
    assert removed == ["bucket-b"]
    assert purged == ["bucket-a-dst"]
    assert migration.items[0].status == "rolled_back"
    assert migration.items[0].step == "rolled_back"
    assert migration.items[0].objects_deleted == 6
    assert migration.items[0].read_only_applied is False
    assert migration.items[0].source_policy_backup_json is None
    assert migration.items[1].status == "rolled_back"
    assert migration.items[1].step == "rolled_back"
    assert migration.items[1].read_only_applied is False


def test_rollback_failed_migration_with_item_errors_reports_completed_with_errors(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )
    migration = service.create_migration(payload, user)
    migration.status = "completed_with_errors"
    migration.items[0].status = "failed"
    migration.items[0].step = "verify"
    migration.items[0].read_only_applied = True
    migration.items[0].source_policy_backup_json = "{}"
    db_session.commit()

    def _resolve_context(context_id: str):
        return SimpleNamespace(account=source if context_id == str(source.id) else target)

    def _restore_source_policy(_bucket_name: str, _source_account, _item):
        raise RuntimeError("policy restore denied")

    def _purge_target_bucket(_target_ctx, _target_bucket: str):
        raise RuntimeError("target purge denied")

    service._resolve_context = _resolve_context  # type: ignore[method-assign]
    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._restore_source_policy = _restore_source_policy  # type: ignore[method-assign]
    service._purge_target_bucket = _purge_target_bucket  # type: ignore[method-assign]

    updated = service.rollback_failed_migration(migration.id)
    item = updated.items[0]

    assert updated.status == "completed_with_errors"
    assert updated.error_message
    assert "Rollback completed with 1 error(s)" in updated.error_message
    assert item.status == "failed"
    assert item.step == "rollback_failed"
    assert item.error_message
    assert "source policy restore failed" in item.error_message
    assert "destination cleanup failed" in item.error_message


def test_retry_item_queues_failed_bucket_item(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[
            BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst"),
            BucketMigrationBucketMapping(source_bucket="bucket-b", target_bucket="bucket-b-dst"),
        ],
    )
    migration = service.create_migration(payload, user)
    migration.status = "completed_with_errors"
    items_by_source = {item.source_bucket: item for item in migration.items}
    failed_item = items_by_source["bucket-a"]
    completed_item = items_by_source["bucket-b"]
    failed_item.status = "failed"
    failed_item.step = "verify"
    failed_item.error_message = "diff not clean"
    completed_item.status = "completed"
    completed_item.step = "completed"
    db_session.commit()

    updated = service.retry_item(migration.id, failed_item.id)
    updated_by_source = {item.source_bucket: item for item in updated.items}
    item = updated_by_source["bucket-a"]

    assert updated.status == "queued"
    assert item.status == "pending"
    assert item.step == "sync"
    assert item.error_message is None
    assert item.finished_at is None
    assert updated_by_source["bucket-b"].status == "completed"


def test_retry_failed_items_queues_all_failed_bucket_items(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[
            BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst"),
            BucketMigrationBucketMapping(source_bucket="bucket-b", target_bucket="bucket-b-dst"),
        ],
    )
    migration = service.create_migration(payload, user)
    migration.status = "completed_with_errors"
    migration.items[0].status = "failed"
    migration.items[0].step = "sync"
    migration.items[0].error_message = "sync denied"
    migration.items[1].status = "failed"
    migration.items[1].step = "rollback_failed"
    migration.items[1].error_message = "rollback denied"
    db_session.commit()

    updated, retried_count = service.retry_failed_items(migration.id)

    assert retried_count == 2
    assert updated.status == "queued"
    assert updated.items[0].status == "pending"
    assert updated.items[0].step == "sync"
    assert updated.items[1].status == "pending"
    assert updated.items[1].step == "sync"


def test_rollback_item_rolls_back_single_failed_bucket_item(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )
    migration = service.create_migration(payload, user)
    item = migration.items[0]
    migration.status = "completed_with_errors"
    item.status = "failed"
    item.step = "sync"
    item.read_only_applied = True
    item.source_policy_backup_json = "{}"
    item.target_lock_applied = True
    item.target_policy_backup_json = "{}"
    item.objects_deleted = 4
    db_session.commit()

    def _resolve_context(context_id: str):
        return SimpleNamespace(account=source if context_id == str(source.id) else target)

    restored_source: list[str] = []
    restored_target: list[str] = []

    def _restore_source_policy(bucket_name: str, _source_account, _item):
        restored_source.append(bucket_name)

    def _restore_target_lock(_target_account, target_bucket: str, _item):
        restored_target.append(target_bucket)

    service._resolve_context = _resolve_context  # type: ignore[method-assign]
    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._restore_source_policy = _restore_source_policy  # type: ignore[method-assign]
    service._restore_target_write_lock_policy = _restore_target_lock  # type: ignore[method-assign]
    service._purge_target_bucket = lambda *_args, **_kwargs: (2, 1)  # type: ignore[method-assign]

    updated = service.rollback_item(migration.id, item.id)
    updated_item = updated.items[0]

    assert updated.status == "completed"
    assert restored_source == ["bucket-a"]
    assert restored_target == ["bucket-a-dst"]
    assert updated_item.status == "rolled_back"
    assert updated_item.step == "rolled_back"
    assert updated_item.objects_deleted == 7
    assert updated_item.read_only_applied is False
    assert updated_item.source_policy_backup_json is None
    assert updated_item.target_lock_applied is False
    assert updated_item.target_policy_backup_json is None


def test_rollback_failed_items_keeps_completed_with_errors_when_one_item_fails(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[
            BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst"),
            BucketMigrationBucketMapping(source_bucket="bucket-b", target_bucket="bucket-b-dst"),
        ],
    )
    migration = service.create_migration(payload, user)
    migration.status = "completed_with_errors"
    migration.items[0].status = "failed"
    migration.items[0].step = "sync"
    migration.items[1].status = "failed"
    migration.items[1].step = "sync"
    db_session.commit()

    def _resolve_context(context_id: str):
        return SimpleNamespace(account=source if context_id == str(source.id) else target)

    def _purge_target_bucket(_target_ctx, target_bucket: str):
        if target_bucket == "bucket-a-dst":
            return 1, 0
        raise RuntimeError("purge denied")

    service._resolve_context = _resolve_context  # type: ignore[method-assign]
    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._purge_target_bucket = _purge_target_bucket  # type: ignore[method-assign]

    updated, rolled_back_count = service.rollback_failed_items(migration.id)

    assert rolled_back_count == 2
    assert updated.status == "completed_with_errors"
    by_source = {item.source_bucket: item for item in updated.items}
    assert by_source["bucket-a"].status == "rolled_back"
    assert by_source["bucket-a"].step == "rolled_back"
    assert by_source["bucket-b"].status == "failed"
    assert by_source["bucket-b"].step == "rollback_failed"


def test_rollback_failed_items_truncates_large_error_payloads(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )
    migration = service.create_migration(payload, user)
    migration.status = "completed_with_errors"
    item = migration.items[0]
    item.status = "failed"
    item.step = "sync"
    db_session.commit()

    def _resolve_context(context_id: str):
        return SimpleNamespace(account=source if context_id == str(source.id) else target)

    huge_error = "x" * 100_000

    def _purge_target_bucket(*_args, **_kwargs):
        raise RuntimeError(huge_error)

    service._resolve_context = _resolve_context  # type: ignore[method-assign]
    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._purge_target_bucket = _purge_target_bucket  # type: ignore[method-assign]

    updated, rolled_back_count = service.rollback_failed_items(migration.id)

    assert rolled_back_count == 1
    updated_item = updated.items[0]
    assert updated_item.status == "failed"
    assert updated_item.step == "rollback_failed"
    assert updated_item.error_message is not None
    assert len(updated_item.error_message) <= _DB_ERROR_MESSAGE_MAX_CHARS
    assert "truncated" in updated_item.error_message

    failure_event = (
        db_session.query(BucketMigrationEvent)
        .filter(
            BucketMigrationEvent.migration_id == migration.id,
            BucketMigrationEvent.item_id == updated_item.id,
            BucketMigrationEvent.message == "Rollback failed for bucket item.",
        )
        .order_by(BucketMigrationEvent.id.desc())
        .first()
    )
    assert failure_event is not None
    assert failure_event.metadata_json is not None
    metadata = json.loads(failure_event.metadata_json)
    assert isinstance(metadata, dict)
    issues = metadata.get("issues")
    assert isinstance(issues, list)
    assert issues
    assert isinstance(issues[0], str)
    assert len(issues[0]) <= _DB_EVENT_MESSAGE_MAX_CHARS
    assert "truncated" in issues[0]


def test_rollback_failed_migration_blocks_when_delete_source_already_completed(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        delete_source=True,
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )
    migration = service.create_migration(payload, user)
    migration.status = "completed_with_errors"
    migration.items[0].status = "completed"
    migration.items[0].step = "completed"
    db_session.commit()

    service._resolve_context = lambda *_args, **_kwargs: SimpleNamespace(account=source)  # type: ignore[method-assign]

    try:
        service.rollback_failed_migration(migration.id)
        assert False, "Expected rollback to be blocked when source deletion may be completed"
    except ValueError as exc:
        assert "prevent data loss" in str(exc)
        assert "source data may have been deleted" in str(exc)


def test_rollback_item_blocks_when_delete_source_step_failed(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        delete_source=True,
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )
    migration = service.create_migration(payload, user)
    migration.status = "completed_with_errors"
    item = migration.items[0]
    item.status = "failed"
    item.step = "delete_source"
    db_session.commit()

    service._resolve_context = lambda *_args, **_kwargs: SimpleNamespace(account=source)  # type: ignore[method-assign]

    try:
        service.rollback_item(migration.id, item.id)
        assert False, "Expected rollback to be blocked when delete_source step failed"
    except ValueError as exc:
        assert "prevent data loss" in str(exc)
        assert "source data may have been deleted" in str(exc)


def test_rollback_item_blocks_when_source_access_cannot_be_verified(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        delete_source=False,
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )
    migration = service.create_migration(payload, user)
    migration.status = "completed_with_errors"
    item = migration.items[0]
    item.status = "failed"
    item.step = "sync"
    db_session.commit()

    service._resolve_context = lambda *_args, **_kwargs: SimpleNamespace(account=source)  # type: ignore[method-assign]

    def _fail_source_access(*_args, **_kwargs):
        raise RuntimeError("NoSuchBucket")

    service._precheck_can_list_bucket = _fail_source_access  # type: ignore[method-assign]

    try:
        service.rollback_item(migration.id, item.id)
        assert False, "Expected rollback to be blocked when source accessibility cannot be verified"
    except ValueError as exc:
        assert "prevent data loss" in str(exc)
        assert "unable to verify source bucket accessibility" in str(exc)


def test_rollback_failed_items_blocks_when_any_source_may_be_deleted(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        delete_source=True,
        buckets=[
            BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst"),
            BucketMigrationBucketMapping(source_bucket="bucket-b", target_bucket="bucket-b-dst"),
        ],
    )
    migration = service.create_migration(payload, user)
    migration.status = "completed_with_errors"
    by_source = {item.source_bucket: item for item in migration.items}
    by_source["bucket-a"].status = "failed"
    by_source["bucket-a"].step = "sync"
    by_source["bucket-b"].status = "failed"
    by_source["bucket-b"].step = "delete_source"
    db_session.commit()

    service._resolve_context = lambda *_args, **_kwargs: SimpleNamespace(account=source)  # type: ignore[method-assign]

    try:
        service.rollback_failed_items(migration.id)
        assert False, "Expected bulk rollback to be blocked when one source bucket may be deleted"
    except ValueError as exc:
        assert "prevent data loss" in str(exc)
        assert "source data may have been deleted" in str(exc)


def test_create_migration_rejects_invalid_webhook_url(db_session):
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    try:
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            mode="one_shot",
            webhook_url="ftp://invalid.example.test/hook",
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a")],
        )
        assert False, "Expected payload validation to fail when webhook_url is invalid"
    except Exception as exc:  # noqa: BLE001
        assert "webhook_url must be a valid http(s) URL" in str(exc)


def test_create_migration_rejects_private_webhook_target(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        webhook_url="http://127.0.0.1:9001/hook",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )

    try:
        service.create_migration(payload, user)
        assert False, "Expected private webhook target to be rejected"
    except ValueError as exc:
        assert "private or local network" in str(exc)


def test_update_migration_rejects_private_webhook_target(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            mode="one_shot",
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
        ),
        user,
    )

    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        webhook_url="http://localhost:8080/hook",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )

    try:
        service.update_draft_migration(migration.id, payload)
        assert False, "Expected private webhook target to be rejected on update"
    except ValueError as exc:
        assert "private or local network" in str(exc)


def test_add_event_notifies_webhook_when_configured(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )
    migration = service.create_migration(payload, user)
    migration.webhook_url = "https://example.com/migration"
    item = migration.items[0]

    captured: dict[str, object] = {}

    class _Dispatcher:
        def enqueue(self, *, webhook_url, payload, migration_id, item_id):
            captured["webhook_url"] = webhook_url
            captured["payload"] = payload
            captured["migration_id"] = migration_id
            captured["item_id"] = item_id
            return True

    with patch("app.services.bucket_migration_service._validate_webhook_target_url", return_value=None):
        with patch(
            "app.services.bucket_migration_service.get_bucket_migration_webhook_dispatcher",
            return_value=_Dispatcher(),
        ):
            service._add_event(
                migration,
                item=item,
                level="info",
                message="Sync batch completed.",
                metadata={"copied": 12, "deleted": 1},
            )

    assert captured["webhook_url"] == "https://example.com/migration"
    assert captured["migration_id"] == migration.id
    assert captured["item_id"] == item.id

    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["type"] == "bucket_migration.event"
    assert payload["migration"]["id"] == migration.id
    assert payload["migration"]["status"] == migration.status
    assert payload["migration"]["strong_integrity_check"] is False
    assert payload["migration"]["use_same_endpoint_copy"] is False
    assert payload["item"]["id"] == item.id
    assert payload["item"]["source_bucket"] == item.source_bucket
    assert payload["item"]["target_bucket"] == item.target_bucket
    assert payload["event"]["message"] == "Sync batch completed."
    assert payload["event"]["metadata"]["copied"] == 12


def test_add_event_webhook_queue_full_does_not_break_migration_events(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )
    migration = service.create_migration(payload, user)
    migration.webhook_url = "https://example.com/migration"

    class _FullDispatcher:
        def enqueue(self, **_kwargs):
            return False

    with patch("app.services.bucket_migration_service._validate_webhook_target_url", return_value=None):
        with patch(
            "app.services.bucket_migration_service.get_bucket_migration_webhook_dispatcher",
            return_value=_FullDispatcher(),
        ):
            service._add_event(
                migration,
                level="warning",
                message="Webhook queue full must be ignored.",
                metadata={"reason": "test"},
            )
    db_session.flush()


def test_bucket_migration_webhook_dispatcher_posts_with_redirects_disabled_and_configured_timeout():
    dispatcher = _BucketMigrationWebhookDispatcher(queue_size=10, workers=1, timeout_seconds=1.7)
    task = SimpleNamespace(
        webhook_url="https://example.com/migration",
        payload={"hello": "world"},
        migration_id=44,
        item_id=None,
    )
    with patch("app.services.bucket_migration_service._validate_webhook_target_url", return_value=None):
        with patch("app.services.bucket_migration_service.requests.post") as mocked_post:
            mocked_post.return_value = SimpleNamespace(status_code=202)
            dispatcher._deliver(task)

    assert mocked_post.call_count == 1
    _args, kwargs = mocked_post.call_args
    assert kwargs["allow_redirects"] is False
    assert kwargs["timeout"] == 1.7


def test_add_event_webhook_failure_does_not_break_migration_events(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )
    migration = service.create_migration(payload, user)
    migration.webhook_url = "https://example.com/migration"

    task = SimpleNamespace(
        webhook_url=migration.webhook_url,
        payload={"x": 1},
        migration_id=migration.id,
        item_id=None,
    )
    dispatcher = _BucketMigrationWebhookDispatcher(queue_size=10, workers=1, timeout_seconds=1.0)
    with patch("app.services.bucket_migration_service._validate_webhook_target_url", return_value=None):
        with patch("app.services.bucket_migration_service.requests.post", side_effect=RuntimeError("network down")):
            dispatcher._deliver(task)
    db_session.flush()


def test_delete_migration_allows_final_statuses(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )
    migration = service.create_migration(payload, user)
    migration.status = "completed"
    db_session.commit()

    service.delete_migration(migration.id)

    deleted = db_session.query(BucketMigration).filter(BucketMigration.id == migration.id).first()
    assert deleted is None


def test_delete_migration_rejects_non_final_status(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        mode="one_shot",
        buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
    )
    migration = service.create_migration(payload, user)

    try:
        service.delete_migration(migration.id)
        assert False, "Expected delete_migration to be blocked for non-final status"
    except ValueError as exc:
        assert "can only be deleted from a final status" in str(exc)


def test_sync_bucket_updates_object_counters_incrementally(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            mode="one_shot",
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
        ),
        user,
    )
    item = migration.items[0]

    source_ctx = SimpleNamespace(
        context_id=str(source.id),
        account=source,
        endpoint="https://source.example.test",
        region="us-east-1",
        force_path_style=False,
        verify_tls=True,
    )
    target_ctx = SimpleNamespace(
        context_id=str(target.id),
        account=target,
        endpoint="https://target.example.test",
        region="us-east-1",
        force_path_style=False,
        verify_tls=True,
    )

    service._context_client = lambda *_args, **_kwargs: SimpleNamespace()  # type: ignore[method-assign]
    service._iter_bucket_diff_entries = lambda *_args, **_kwargs: iter(  # type: ignore[method-assign]
        [
            SimpleNamespace(
                kind="only_source",
                key=f"object-{index}",
                source_size=1,
                target_size=0,
                source_etag="a" * 32,
                target_etag=None,
                compare_by="presence",
            )
            for index in range(30)
        ]
    )
    service._is_same_endpoint = lambda *_args, **_kwargs: False  # type: ignore[method-assign]
    service._copy_single_object = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._add_event = lambda *_args, **_kwargs: None  # type: ignore[method-assign]

    commit_calls = {"count": 0}
    original_commit = db_session.commit

    def _counting_commit():
        commit_calls["count"] += 1
        original_commit()

    db_session.commit = _counting_commit  # type: ignore[assignment]
    copied, deleted, _diff = service._sync_bucket(
        source_ctx,
        target_ctx,
        source_bucket="bucket-a",
        target_bucket="bucket-a-dst",
        allow_delete=False,
        parallelism_max=8,
        migration=migration,
        item=item,
        control_check=lambda: "run",
    )
    db_session.commit = original_commit  # type: ignore[assignment]

    db_session.refresh(migration)
    db_session.refresh(item)

    assert copied == 30
    assert deleted == 0
    assert item.objects_copied == 30
    assert migration.last_heartbeat_at is not None
    # With throttled progress persistence, we keep one forced progress flush and one final sync commit.
    assert commit_calls["count"] >= 2


def test_sync_bucket_force_flushes_progress_when_pause_is_requested(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            mode="one_shot",
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
        ),
        user,
    )
    item = migration.items[0]

    source_ctx = SimpleNamespace(
        context_id=str(source.id),
        account=source,
        endpoint="https://source.example.test",
        region="us-east-1",
        force_path_style=False,
        verify_tls=True,
    )
    target_ctx = SimpleNamespace(
        context_id=str(target.id),
        account=target,
        endpoint="https://target.example.test",
        region="us-east-1",
        force_path_style=False,
        verify_tls=True,
    )

    service._context_client = lambda *_args, **_kwargs: SimpleNamespace()  # type: ignore[method-assign]
    service._iter_bucket_diff_entries = lambda *_args, **_kwargs: iter(  # type: ignore[method-assign]
        [
            SimpleNamespace(
                kind="only_source",
                key=f"object-{index}",
                source_size=1,
                target_size=0,
                source_etag="a" * 32,
                target_etag=None,
                compare_by="presence",
            )
            for index in range(5)
        ]
    )
    service._is_same_endpoint = lambda *_args, **_kwargs: False  # type: ignore[method-assign]
    service._copy_single_object = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._add_event = lambda *_args, **_kwargs: None  # type: ignore[method-assign]

    control_calls = {"count": 0}

    def _control_check() -> str:
        control_calls["count"] += 1
        return "pause" if control_calls["count"] >= 3 else "run"

    copied, deleted, _diff = service._sync_bucket(
        source_ctx,
        target_ctx,
        source_bucket="bucket-a",
        target_bucket="bucket-a-dst",
        allow_delete=False,
        parallelism_max=4,
        migration=migration,
        item=item,
        control_check=_control_check,
    )

    db_session.refresh(item)
    assert copied == -1
    assert deleted == -1
    # Progress already completed before pause must still be visible.
    assert item.objects_copied > 0


def test_run_precheck_executes_target_lock_probe_once_when_required(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            mode="one_shot",
            lock_target_writes=True,
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
        ),
        user,
    )

    probe_calls = {"count": 0}

    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._count_bucket_objects = lambda *_args, **_kwargs: 3  # type: ignore[method-assign]
    service._precheck_bucket_exists = lambda *_args, **_kwargs: False  # type: ignore[method-assign]
    service._precheck_policy_roundtrip = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._inspector.inspect_bucket_state = lambda *_args, **_kwargs: _bucket_profile_stub("bucket-a")  # type: ignore[method-assign]

    def _probe(_target_ctx, *, migration_id: int):
        assert migration_id == migration.id
        probe_calls["count"] += 1

    service._precheck_target_lock_with_probe_bucket = _probe  # type: ignore[method-assign]

    checked = service.run_precheck(migration.id)
    assert checked.precheck_status == "passed"
    assert probe_calls["count"] == 1



def test_run_precheck_fails_when_target_lock_probe_fails_in_fail_closed_mode(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            mode="one_shot",
            lock_target_writes=True,
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
        ),
        user,
    )

    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._count_bucket_objects = lambda *_args, **_kwargs: 3  # type: ignore[method-assign]
    service._precheck_bucket_exists = lambda *_args, **_kwargs: False  # type: ignore[method-assign]
    service._precheck_policy_roundtrip = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._inspector.inspect_bucket_state = lambda *_args, **_kwargs: _bucket_profile_stub("bucket-a")  # type: ignore[method-assign]
    service._precheck_target_lock_with_probe_bucket = (  # type: ignore[method-assign]
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("lock probe denied"))
    )

    checked = service.run_precheck(migration.id)
    assert checked.precheck_status == "failed"
    report = json.loads(checked.precheck_report_json or "{}")
    assert int(report.get("errors") or 0) >= 1
    messages = report.get("items", [])[0].get("messages", [])
    assert any(
        str(message.get("code", "")) == "target_write_lock_failed"
        for message in messages
        if isinstance(message, dict)
    )



def test_run_precheck_fails_when_target_lock_probe_cleanup_fails_in_fail_closed_mode(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            mode="one_shot",
            lock_target_writes=True,
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
        ),
        user,
    )

    service._precheck_can_list_bucket = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._count_bucket_objects = lambda *_args, **_kwargs: 3  # type: ignore[method-assign]
    service._precheck_bucket_exists = lambda *_args, **_kwargs: False  # type: ignore[method-assign]
    service._precheck_policy_roundtrip = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._inspector.inspect_bucket_state = lambda *_args, **_kwargs: _bucket_profile_stub("bucket-a")  # type: ignore[method-assign]
    service._precheck_target_lock_with_probe_bucket = (  # type: ignore[method-assign]
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("Target write-lock precheck cleanup failed"))
    )

    checked = service.run_precheck(migration.id)
    assert checked.precheck_status == "failed"
    report = json.loads(checked.precheck_report_json or "{}")
    assert int(report.get("errors") or 0) >= 1
    messages = report.get("items", [])[0].get("messages", [])
    assert any(
        "cleanup failed" in str(message.get("message", "")).lower()
        for message in messages
        if isinstance(message, dict)
    )



def test_apply_target_lock_fails_when_lock_cannot_be_applied(db_session):
    user = _create_user(db_session)
    source = _create_account(db_session, name="source", endpoint_url="https://source.example.test", account_id="RGW001")
    target = _create_account(db_session, name="target", endpoint_url="https://target.example.test", account_id="RGW002")
    db_session.commit()

    service = BucketMigrationService(db_session)
    migration = service.create_migration(
        BucketMigrationCreateRequest(
            source_context_id=str(source.id),
            target_context_id=str(target.id),
            mode="pre_sync",
            lock_target_writes=True,
            buckets=[BucketMigrationBucketMapping(source_bucket="bucket-a", target_bucket="bucket-a-dst")],
        ),
        user,
    )
    item = migration.items[0]
    item.status = "running"
    item.step = "apply_target_lock"
    item.execution_plan_json = _current_only_execution_plan()
    db_session.commit()

    service._apply_target_write_lock_policy = (  # type: ignore[method-assign]
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("lock denied"))
    )
    service._remove_managed_target_write_lock_statement = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    service._sync_bucket = lambda *_args, **_kwargs: (  # type: ignore[method-assign]
        -1,
        -1,
        SimpleNamespace(
            source_count=0,
            target_count=0,
            matched_count=0,
            different_count=0,
            only_source_count=0,
            only_target_count=0,
            sample={"only_source_sample": [], "only_target_sample": [], "different_sample": []},
        ),
    )

    source_ctx = SimpleNamespace(account=source)
    target_ctx = SimpleNamespace(account=target)
    control_calls = {"count": 0}

    def _control_check() -> str:
        control_calls["count"] += 1
        return "run" if control_calls["count"] == 1 else "pause"

    try:
        service._run_item(migration, item, source_ctx, target_ctx, control_check=_control_check)
        assert False, "Expected target write-lock application failure to stop the item"
    except RuntimeError as exc:
        assert "Target write-lock policy could not be applied" in str(exc)

    db_session.refresh(item)
    assert item.status == "running"
    assert item.step == "apply_target_lock"
    assert item.target_lock_applied is False

    warning_event = (
        db_session.query(BucketMigrationEvent)
        .filter(
            BucketMigrationEvent.migration_id == migration.id,
            BucketMigrationEvent.item_id == item.id,
            BucketMigrationEvent.level == "warning",
        )
        .order_by(BucketMigrationEvent.id.desc())
        .first()
    )
    assert warning_event is None


def test_fail_migration_fatal_marks_failed_and_releases_lease(db_session):
    migration = BucketMigration(
        source_context_id="10",
        target_context_id="20",
        mode="one_shot",
        copy_bucket_settings=False,
        delete_source=False,
        lock_target_writes=True,
        use_same_endpoint_copy=False,
        auto_grant_source_read_for_copy=False,
        status="running",
        precheck_status="passed",
        parallelism_max=4,
        total_items=1,
        worker_lease_owner="worker-1",
    )
    db_session.add(migration)
    db_session.flush()
    item = BucketMigrationItem(
        migration_id=migration.id,
        source_bucket="bucket-a",
        target_bucket="bucket-a-dst",
        status="running",
        step="sync",
    )
    db_session.add(item)
    db_session.commit()

    service = BucketMigrationService(db_session)
    service.fail_migration_fatal(migration.id, error=RuntimeError("boom"), worker_id="worker-1")

    db_session.refresh(migration)
    db_session.refresh(item)
    assert migration.status == "failed"
    assert migration.worker_lease_owner is None
    assert migration.worker_lease_until is None
    assert migration.error_message and "Fatal migration worker error" in migration.error_message
    assert item.status == "failed"
    event = (
        db_session.query(BucketMigrationEvent)
        .filter(BucketMigrationEvent.migration_id == migration.id, BucketMigrationEvent.level == "error")
        .order_by(BucketMigrationEvent.id.desc())
        .first()
    )
    assert event is not None



def test_fail_migration_fatal_is_idempotent_for_final_status(db_session):
    migration = BucketMigration(
        source_context_id="10",
        target_context_id="20",
        mode="one_shot",
        copy_bucket_settings=False,
        delete_source=False,
        lock_target_writes=True,
        use_same_endpoint_copy=False,
        auto_grant_source_read_for_copy=False,
        status="completed",
        precheck_status="passed",
        parallelism_max=4,
        total_items=0,
        worker_lease_owner="worker-1",
    )
    db_session.add(migration)
    db_session.commit()

    service = BucketMigrationService(db_session)
    service.fail_migration_fatal(migration.id, error=RuntimeError("ignored"), worker_id="worker-1")

    db_session.refresh(migration)
    assert migration.status == "completed"
    assert migration.worker_lease_owner is None



def test_worker_marks_migration_failed_on_fatal_exception(db_session, monkeypatch):
    migration = BucketMigration(
        source_context_id="10",
        target_context_id="20",
        mode="one_shot",
        copy_bucket_settings=False,
        delete_source=False,
        lock_target_writes=True,
        use_same_endpoint_copy=False,
        auto_grant_source_read_for_copy=False,
        status="queued",
        precheck_status="passed",
        parallelism_max=4,
        total_items=1,
    )
    db_session.add(migration)
    db_session.flush()
    db_session.add(
        BucketMigrationItem(
            migration_id=migration.id,
            source_bucket="bucket-a",
            target_bucket="bucket-a-dst",
            status="pending",
            step="create_bucket",
        )
    )
    db_session.commit()

    test_session_factory = sessionmaker(autocommit=False, autoflush=False, bind=db_session.get_bind())

    def _explode_run_migration(self, migration_id: int, *, worker_id=None, lease_seconds=None):
        raise RuntimeError(f"fatal-{migration_id}")

    monkeypatch.setattr(BucketMigrationService, "run_migration", _explode_run_migration)

    worker = BucketMigrationWorker(test_session_factory, poll_interval_seconds=0.05, lease_seconds=60)
    worker.start()
    deadline = time.time() + 2.0
    last_status = None
    while time.time() < deadline:
        with test_session_factory() as db:
            row = db.query(BucketMigration).filter(BucketMigration.id == migration.id).first()
            assert row is not None
            last_status = row.status
            if row.status == "failed":
                break
        time.sleep(0.05)
    worker.stop(timeout=1.0)

    with test_session_factory() as db:
        row = db.query(BucketMigration).filter(BucketMigration.id == migration.id).first()
        assert row is not None
        assert row.status == "failed", f"unexpected status={last_status}"
        assert row.error_message and "Fatal migration worker error" in row.error_message
