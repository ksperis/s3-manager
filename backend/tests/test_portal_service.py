# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import importlib.util as import_util
import hashlib
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from botocore.exceptions import ClientError
from fastapi import HTTPException

from app.db import (
    AuditLog,
    AccountIAMUser,
    AccountRole,
    PortalExternalAccessCredential,
    PortalPublicLink,
    PortalStorageSpaceGrant,
    PortalStorageSpaceMetadata,
    QuotaUsageDaily,
    S3Account,
    StorageEndpoint,
    UiGroup,
    UiGroupS3Account,
    User,
    UserUiGroup,
    UserS3Account,
)
from app.models.app_settings import AppSettings, PortalSettings, PortalSettingsOverride
from app.models.bucket import Bucket
from app.models.bucket_usage_stats import BucketUsageStatsDistributionEntry, BucketUsageStatsSnapshot
from app.models.iam import AccessKey as IAMAccessKey, IAMUser
from app.models.portal import (
    PortalAccessKey,
    PortalAccessKeyCreate,
    PortalAccessKeyStatusChange,
    PortalAlert,
    PortalIAMUser,
    PortalServerAccessLogFilterQuery,
    PortalServerAccessLogFilterRule,
    PortalState,
    PortalStorageObjectRestoreRequest,
    PortalStorageObjectRestoreResponse,
    PortalStorageSpace,
    PortalStorageSpaceInitialShare,
    PortalStorageSpaceShare,
    PortalStorageSpaceSummary,
    PortalUsage,
    portal_storage_space_version_cleanup_confirmation_phrase,
)
from app.routers.dependencies import AccountAccess, AccountCapabilities
from app.routers import portal as portal_router
from app.services import s3_client
from app.services.portal_service import (
    PortalAccessKeyLimitExceeded,
    PortalAccessKeyManagementDisabled,
    PortalAccessKeyProtected,
    PortalStorageSpaceNotEmpty,
    PortalService,
)
from app.services.portal.version_cleanup import PortalStorageSpaceVersionCleanupTarget
from app.services.portal.trash_restore import PortalDeletedPrefixRestoreTarget
from app.services.portal_role_sync import sync_portal_role_downgrades
from app.services.bucket_usage_stats_service import BucketUsageStatsService
from app.services.bucket_purge_service import BucketPurgeCancelled
from app.services.traffic_service import TrafficWindow
from app.utils.time import utcnow


def _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False):
    return AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=role,
        capabilities=AccountCapabilities(
            can_manage_buckets=can_manage_buckets,
            can_manage_portal_users=role == AccountRole.PORTAL_MANAGER.value,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )


def _usage_history_settings(enabled: bool) -> AppSettings:
    settings = AppSettings()
    settings.general.usage_history_enabled = enabled
    return settings


def _bucket_usage_settings(enabled: bool) -> AppSettings:
    settings = AppSettings()
    settings.general.bucket_usage_stats_enabled = enabled
    return settings


def _bucket_usage_snapshot(bucket_name: str, *, scope_id: str, bytes_value: int) -> BucketUsageStatsSnapshot:
    return BucketUsageStatsSnapshot(
        scope_kind="manager",
        scope_id=scope_id,
        scope_name="Portal source",
        bucket_name=bucket_name,
        scan_mode="versions",
        version_listing_available=True,
        object_version_count=1,
        current_version_count=1,
        noncurrent_version_count=0,
        delete_marker_count=0,
        total_bytes=bytes_value,
        current_bytes=bytes_value,
        noncurrent_bytes=0,
        data_type_distribution=[
            BucketUsageStatsDistributionEntry(
                key="documents",
                label="Documents",
                count=1,
                bytes=bytes_value,
                ratio_count=1,
                ratio_bytes=1,
            )
        ],
        storage_class_distribution=[
            BucketUsageStatsDistributionEntry(
                key="STANDARD",
                label="STANDARD",
                count=1,
                bytes=bytes_value,
                ratio_count=1,
                ratio_bytes=1,
            )
        ],
        size_distribution=[],
        age_distribution=[],
        current_vs_noncurrent=[
            BucketUsageStatsDistributionEntry(
                key="current",
                label="Current versions",
                count=1,
                bytes=bytes_value,
                ratio_count=1,
                ratio_bytes=1,
            )
        ],
        warnings=[],
        calculated_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )


def test_portal_storage_space_grants_migration_creates_constraints(monkeypatch):
    migration_path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0056_portal_storage_space_grants.py"
    spec = import_util.spec_from_file_location("migration_0056_portal_storage_space_grants", migration_path)
    assert spec is not None and spec.loader is not None
    migration = import_util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite:///:memory:")

    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(migration, "op", operations)

        migration.upgrade()
        inspector = sa.inspect(connection)
        assert "portal_storage_space_grants" in inspector.get_table_names()
        columns = {column["name"] for column in inspector.get_columns("portal_storage_space_grants")}
        assert {
            "id",
            "storage_space_metadata_id",
            "user_id",
            "role",
            "created_by_user_id",
            "created_at",
            "updated_at",
        } <= columns
        unique_columns = {
            tuple(constraint["column_names"])
            for constraint in inspector.get_unique_constraints("portal_storage_space_grants")
        }
        assert ("storage_space_metadata_id", "user_id") in unique_columns
        check_sql = " ".join(
            constraint.get("sqltext") or ""
            for constraint in inspector.get_check_constraints("portal_storage_space_grants")
        )
        assert "Viewer" in check_sql and "Editor" in check_sql and "Owner" in check_sql
        referred_tables = {
            foreign_key["referred_table"]
            for foreign_key in inspector.get_foreign_keys("portal_storage_space_grants")
        }
        assert {"portal_storage_space_metadata", "users"} <= referred_tables

        migration.downgrade()
        assert "portal_storage_space_grants" not in sa.inspect(connection).get_table_names()


def test_strict_storage_space_access_migration_purges_old_state_and_enforces_roles(monkeypatch):
    migration_path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0066_portal_storage_space_access_model.py"
    spec = import_util.spec_from_file_location("migration_0066_portal_storage_space_access_model", migration_path)
    assert spec is not None and spec.loader is not None
    migration = import_util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def create_schema(connection):
        connection.execute(sa.text(
            "CREATE TABLE portal_storage_space_metadata ("
            "id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, bucket_name VARCHAR NOT NULL, "
            "visibility VARCHAR NOT NULL, owner_user_id INTEGER, owner_label VARCHAR)"
        ))
        connection.execute(sa.text(
            "CREATE TABLE portal_storage_space_grants ("
            "id INTEGER PRIMARY KEY, storage_space_metadata_id INTEGER NOT NULL, role VARCHAR NOT NULL, "
            "CONSTRAINT ck_portal_storage_space_grants_role "
            "CHECK (role IN ('Viewer', 'Editor', 'Owner')))"
        ))
        connection.execute(sa.text(
            "CREATE TABLE portal_external_access_credentials ("
            "id INTEGER PRIMARY KEY, storage_space_metadata_id INTEGER NOT NULL)"
        ))
        connection.execute(sa.text(
            "CREATE TABLE portal_public_links ("
            "id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, bucket_name VARCHAR NOT NULL)"
        ))

    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        create_schema(connection)
        connection.execute(sa.text(
            "INSERT INTO portal_storage_space_metadata "
            "(id, account_id, bucket_name, visibility, owner_user_id, owner_label) "
            "VALUES (1, 4, 'private-space', 'private', 7, 'owner@example.test')"
        ))
        connection.execute(sa.text(
            "INSERT INTO portal_storage_space_grants (id, storage_space_metadata_id, role) "
            "VALUES (1, 1, 'Owner')"
        ))
        connection.execute(sa.text(
            "INSERT INTO portal_external_access_credentials (id, storage_space_metadata_id) VALUES (1, 1)"
        ))
        connection.execute(sa.text(
            "INSERT INTO portal_public_links (id, account_id, bucket_name) "
            "VALUES (1, 4, 'private-space'), (2, 4, 'unrelated-bucket')"
        ))
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        migration.upgrade()
        inspector = sa.inspect(connection)
        assert connection.execute(sa.text("SELECT COUNT(*) FROM portal_storage_space_metadata")).scalar_one() == 0
        assert connection.execute(sa.text("SELECT COUNT(*) FROM portal_storage_space_grants")).scalar_one() == 0
        assert connection.execute(sa.text("SELECT COUNT(*) FROM portal_external_access_credentials")).scalar_one() == 0
        assert connection.execute(sa.text("SELECT bucket_name FROM portal_public_links")).scalar_one() == "unrelated-bucket"
        assert "owner_label" not in {column["name"] for column in inspector.get_columns("portal_storage_space_metadata")}
        metadata_checks = " ".join(
            constraint.get("sqltext") or ""
            for constraint in inspector.get_check_constraints("portal_storage_space_metadata")
        )
        grant_checks = " ".join(
            constraint.get("sqltext") or ""
            for constraint in inspector.get_check_constraints("portal_storage_space_grants")
        )
        assert "private" in metadata_checks and "shared" in metadata_checks
        assert "Viewer" in grant_checks and "Editor" in grant_checks and "Owner" not in grant_checks


def test_portal_bucket_creation_uses_backend_credentials_without_legacy_policy(monkeypatch, db_session):
    account = S3Account(name="portal-account-manager", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=AccountRole.PORTAL_MANAGER.value,
        capabilities=AccountCapabilities(
            can_manage_buckets=True,
            can_manage_portal_users=False,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )

    service = PortalService(db_session)
    iam_service = object()
    link = AccountIAMUser(user_id=user.id, account_id=account.id, iam_user_id="iam-uid", iam_username="portal-iam")
    iam_user = IAMUser(name="portal-iam", arn="arn:aws:iam:::user/portal-iam")

    monkeypatch.setattr(service, "_get_iam_service", lambda acc: iam_service)
    monkeypatch.setattr(service, "_ensure_portal_user", lambda *args, **kwargs: (link, iam_user, False))
    monkeypatch.setattr(service, "_sync_user_group_membership", lambda *args, **kwargs: None)
    monkeypatch.setattr(service, "_active_credentials", lambda *args, **kwargs: ("AK-PORTAL", "SK-PORTAL"))

    created_buckets = []
    versioning_calls = []
    lifecycle_calls = []
    cors_calls = []
    monkeypatch.setattr(
        s3_client,
        "create_bucket",
        lambda name, access_key=None, secret_key=None, **kwargs: created_buckets.append((name, access_key, secret_key)),
    )
    monkeypatch.setattr(
        s3_client,
        "set_bucket_versioning",
        lambda name, enabled=True, access_key=None, secret_key=None, **kwargs: versioning_calls.append(
            (name, enabled, access_key, secret_key)
        ),
    )
    monkeypatch.setattr(
        s3_client,
        "put_bucket_lifecycle",
        lambda *args, **kwargs: lifecycle_calls.append((args, kwargs)),
    )
    monkeypatch.setattr(
        s3_client,
        "put_bucket_cors",
        lambda *args, **kwargs: cors_calls.append((args, kwargs)),
    )

    def fail_bucket_policy(*args, **kwargs):
        raise AssertionError("Bucket policy should not be created")

    monkeypatch.setattr(s3_client, "put_bucket_policy", fail_bucket_policy)

    portal_settings = PortalSettings()
    portal_settings.bucket_defaults.cors_allowed_origins = ["https://ui.example.test"]
    portal_settings.bucket_defaults.noncurrent_version_expiration_days = 45

    bucket = service.create_bucket(
        user,
        access,
        "user-bucket",
        versioning=True,
        portal_settings=portal_settings,
    )

    assert bucket.name == "user-bucket"
    assert created_buckets == [("user-bucket", "ROOT-AK", "ROOT-SK")]
    assert versioning_calls == [("user-bucket", True, "ROOT-AK", "ROOT-SK")]
    assert len(lifecycle_calls) == 1
    assert lifecycle_calls[0][1]["access_key"] == "ROOT-AK"
    assert lifecycle_calls[0][1]["secret_key"] == "ROOT-SK"
    assert lifecycle_calls[0][1]["rules"][1]["NoncurrentVersionExpiration"] == {"NoncurrentDays": 45}
    assert len(cors_calls) == 1
    assert cors_calls[0][1]["access_key"] == "ROOT-AK"
    assert cors_calls[0][1]["secret_key"] == "ROOT-SK"
    cors_rules = cors_calls[0][1]["rules"]
    assert isinstance(cors_rules, list) and len(cors_rules) == 1
    assert "Authorization" in (cors_rules[0].get("AllowedHeaders") or [])


def test_portal_user_bucket_creation_applies_defaults_with_account_credentials(monkeypatch, db_session):
    account = S3Account(name="portal-account-user", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=AccountRole.PORTAL_USER.value,
        capabilities=AccountCapabilities(
            can_manage_buckets=False,
            can_manage_portal_users=False,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )

    service = PortalService(db_session)
    iam_service = object()
    link = AccountIAMUser(user_id=user.id, account_id=account.id, iam_user_id="iam-uid", iam_username="portal-iam")
    iam_user = IAMUser(name="portal-iam", arn="arn:aws:iam:::user/portal-iam")

    monkeypatch.setattr(service, "_get_iam_service", lambda acc: iam_service)
    monkeypatch.setattr(service, "_ensure_portal_user", lambda *args, **kwargs: (link, iam_user, False))
    monkeypatch.setattr(service, "_sync_user_group_membership", lambda *args, **kwargs: None)
    monkeypatch.setattr(service, "_active_credentials", lambda *args, **kwargs: ("AK-PORTAL", "SK-PORTAL"))

    created_buckets = []
    versioning_calls = []
    lifecycle_calls = []
    cors_calls = []
    monkeypatch.setattr(
        s3_client,
        "create_bucket",
        lambda name, access_key=None, secret_key=None, **kwargs: created_buckets.append((name, access_key, secret_key)),
    )
    monkeypatch.setattr(
        s3_client,
        "set_bucket_versioning",
        lambda *args, **kwargs: versioning_calls.append((args, kwargs)),
    )
    monkeypatch.setattr(
        s3_client,
        "put_bucket_lifecycle",
        lambda *args, **kwargs: lifecycle_calls.append((args, kwargs)),
    )
    monkeypatch.setattr(
        s3_client,
        "put_bucket_cors",
        lambda *args, **kwargs: cors_calls.append((args, kwargs)),
    )

    portal_settings = PortalSettings()
    portal_settings.bucket_defaults.cors_allowed_origins = ["https://ui.example.test"]

    bucket = service.create_bucket(
        user,
        access,
        "user-bucket",
        versioning=True,
        portal_settings=portal_settings,
    )

    assert bucket.name == "user-bucket"
    assert created_buckets == [("user-bucket", "ROOT-AK", "ROOT-SK")]
    assert len(versioning_calls) == 1
    assert versioning_calls[0][1]["access_key"] == "ROOT-AK"
    assert versioning_calls[0][1]["secret_key"] == "ROOT-SK"
    assert len(lifecycle_calls) == 1
    assert lifecycle_calls[0][1]["access_key"] == "ROOT-AK"
    assert lifecycle_calls[0][1]["secret_key"] == "ROOT-SK"
    assert len(cors_calls) == 1
    cors_rules = cors_calls[0][1]["rules"]
    assert isinstance(cors_rules, list) and len(cors_rules) == 1
    assert "Authorization" in (cors_rules[0].get("AllowedHeaders") or [])
    assert cors_calls[0][1]["access_key"] == "ROOT-AK"
    assert cors_calls[0][1]["secret_key"] == "ROOT-SK"


def test_portal_user_group_policy_is_fixed_and_does_not_grant_direct_bucket_creation(db_session):
    service = PortalService(db_session)
    portal_settings = PortalSettings()
    portal_settings.allow_private_storage_space_create = True

    policy = service._resolve_group_policy(portal_settings, "user")

    assert isinstance(policy, dict)
    statements = policy.get("Statement") or []
    assert isinstance(statements, list) and statements
    actions = statements[0].get("Action") or []
    assert actions == ["s3:ListAllMyBuckets", "sts:GetSessionToken"]
    assert "s3:CreateBucket" not in actions
    assert "s3:DeleteBucket" not in actions


def test_portal_manager_group_policy_defaults_to_minimal_global_actions(db_session):
    service = PortalService(db_session)
    policy = service._resolve_group_policy(PortalSettings(), "manager")

    assert isinstance(policy, dict)
    statements = policy.get("Statement") or []
    assert isinstance(statements, list) and statements
    actions = statements[0].get("Action") or []

    assert actions == ["s3:ListAllMyBuckets", "sts:GetSessionToken"]
    assert "s3:CreateBucket" not in actions
    assert "iam:*" not in actions
    assert "s3:*" not in actions
    assert "sts:*" not in actions
    assert not any(action.startswith("iam:") for action in actions)


def test_portal_manager_group_policy_uses_fixed_account_access(db_session):
    service = PortalService(db_session)
    policy = service._resolve_group_policy(PortalSettings(), "manager")

    assert isinstance(policy, dict)
    statements = policy.get("Statement") or []
    assert isinstance(statements, list) and statements
    assert statements[0]["Action"] == ["s3:ListAllMyBuckets", "sts:GetSessionToken"]
    assert statements[1]["Resource"] == ["arn:aws:s3:::*", "arn:aws:s3:::*/*"]
    assert "s3:CreateBucket" not in statements[1]["Action"]
    assert "s3:*" not in statements[1]["Action"]


def test_manager_group_access_is_protected_before_policy_update(monkeypatch, db_session):
    service = PortalService(db_session)
    account = S3Account(name="ordering")
    events = []

    class FakeIAM:
        def list_group_users(self, group_name):
            return []

        def add_user_to_group(self, group_name, username):
            events.append(("add", group_name, username))

        def remove_user_from_group(self, group_name, username):
            events.append(("remove", group_name, username))

    monkeypatch.setattr(
        service,
        "_sync_portal_server_access_log_bucket_policy_if_present",
        lambda _account: events.append(("protect-technical-bucket",)),
    )
    monkeypatch.setattr(service, "_ensure_portal_groups", lambda *_args, **_kwargs: events.append(("update-groups",)))

    service._sync_user_group_membership(
        FakeIAM(),
        "portal-manager-1",
        AccountRole.PORTAL_MANAGER.value,
        account=account,
    )

    assert events[0] == ("protect-technical-bucket",)
    assert events[1] == ("update-groups",)
    assert events[2] == ("add", "portal-manager", "portal-manager-1")


def test_manager_demotion_removes_manager_group_before_adding_user_group(monkeypatch, db_session):
    service = PortalService(db_session)
    events = []

    class FakeIAM:
        def list_group_users(self, group_name):
            return [IAMUser(name="portal-1")] if group_name == "portal-manager" else []

        def add_user_to_group(self, group_name, username):
            events.append(("add", group_name, username))

        def remove_user_from_group(self, group_name, username):
            events.append(("remove", group_name, username))

    monkeypatch.setattr(service, "_ensure_portal_groups", lambda *_args, **_kwargs: None)
    service._sync_user_group_membership(FakeIAM(), "portal-1", AccountRole.PORTAL_USER.value)

    assert events == [
        ("remove", "portal-manager", "portal-1"),
        ("add", "portal-user", "portal-1"),
    ]


def test_portal_bucket_creation_rejects_unauthorized_role_before_s3_calls(monkeypatch, db_session):
    account = S3Account(name="portal-account-denied", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-denied@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=AccountRole.PORTAL_USER.value,
        capabilities=AccountCapabilities(
            can_manage_buckets=False,
            can_manage_portal_users=False,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )

    service = PortalService(db_session)
    monkeypatch.setattr(service, "_get_iam_service", lambda acc: pytest.fail("IAM should not be used"))
    monkeypatch.setattr(s3_client, "create_bucket", lambda *args, **kwargs: pytest.fail("S3 should not be used"))

    with pytest.raises(RuntimeError, match="Bucket creation not allowed"):
        service.create_bucket(
            user,
            access,
            "denied-bucket",
            portal_settings=PortalSettings(allow_private_storage_space_create=False),
        )


def test_get_state_without_bootstrap_is_read_only(monkeypatch, db_session):
    account = S3Account(name="portal-account-read-only", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-readonly@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=AccountRole.PORTAL_USER.value,
        capabilities=AccountCapabilities(
            can_manage_buckets=False,
            can_manage_portal_users=False,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )
    service = PortalService(db_session)

    def fail_get_iam_service(*args, **kwargs):
        raise AssertionError("IAM service should not be initialized when no portal link exists")

    monkeypatch.setattr(service, "_get_iam_service", fail_get_iam_service)

    state = service.get_state(user, access)

    assert state.iam_provisioned is False
    assert state.iam_user.iam_username is None
    assert state.access_keys == []
    assert state.just_created is False


def test_get_state_does_not_load_dynamic_quota_limits(monkeypatch, db_session):
    account = S3Account(
        name="portal-account-with-bucket-limit",
        rgw_account_id="tenant-a",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    user = User(email="portal-limit@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=AccountRole.PORTAL_USER.value,
        capabilities=AccountCapabilities(
            can_manage_buckets=False,
            can_manage_portal_users=False,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )
    service = PortalService(db_session)

    monkeypatch.setattr(
        service,
        "_quota_admin_for_account",
        lambda acc: pytest.fail("PortalState must not initialize RGW Admin"),
    )
    monkeypatch.setattr(service, "_get_iam_service", lambda *_args, **_kwargs: pytest.fail("IAM should not initialize without a portal link"))

    state = service.get_state(user, access)

    assert state.quota_max_size_bytes is None
    assert state.quota_max_objects is None
    assert state.max_buckets is None


def test_get_state_keeps_bucket_quota_null_when_limit_is_absent(monkeypatch, db_session):
    account = S3Account(
        name="portal-account-without-bucket-limit",
        rgw_account_id="tenant-no-limit",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    user = User(email="portal-no-limit@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user)
    service = PortalService(db_session)

    class FakeQuotaAdmin:
        def get_account(self, account_id, allow_not_found=False, allow_not_implemented=False):
            return {"quota": {"enabled": True, "max_size": 2048, "max_objects": 12}}

    monkeypatch.setattr(service, "_quota_admin_for_account", lambda acc: FakeQuotaAdmin())

    state = service.get_state(user, access)

    assert state.max_buckets is None


def test_portal_traffic_aggregates_visible_buckets_for_portal_user(monkeypatch, db_session):
    account = S3Account(name="portal-traffic-scope", rgw_account_id="tenant-traffic")
    user = User(email="portal-traffic@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user)
    service = PortalService(db_session)
    captured: dict = {}

    monkeypatch.setattr(
        service,
        "list_existing_user_bucket_access",
        lambda actor, scoped_account, role: ["bucket-a", "bucket-b"],  # noqa: ARG005
    )

    class FakeTrafficService:
        def __init__(self, scoped_account):
            captured["account"] = scoped_account

        def get_traffic(self, *, window, bucket=None, bucket_filters=None):
            captured["window"] = window
            captured["bucket"] = bucket
            captured["bucket_filters"] = bucket_filters
            return {
                "window": window.value,
                "start": "2026-06-10T00:00:00+00:00",
                "end": "2026-06-11T00:00:00+00:00",
                "resolution": "hourly",
                "bucket_filter": None,
                "data_points": 1,
                "series": [{"timestamp": "2026-06-10T00:00:00+00:00", "bytes_in": 2, "bytes_out": 3, "ops": 1, "success_ops": 1}],
                "totals": {"bytes_in": 2, "bytes_out": 3, "ops": 1, "success_ops": 1, "success_rate": 1},
                "bucket_rankings": [],
                "user_rankings": [],
                "request_breakdown": [],
                "category_breakdown": [],
            }

    monkeypatch.setattr(portal_router, "TrafficService", FakeTrafficService)

    result = portal_router.portal_traffic(
        window=TrafficWindow.DAY,
        bucket=None,
        access=access,
        portal_service=service,
    )

    assert result["totals"]["bytes_in"] == 2
    assert captured["account"] == account
    assert captured["bucket"] is None
    assert captured["bucket_filters"] == {"bucket-a", "bucket-b"}


def test_portal_traffic_filters_to_requested_visible_bucket(monkeypatch, db_session):
    account = S3Account(name="portal-traffic-bucket", rgw_account_id="tenant-traffic-bucket")
    user = User(email="portal-traffic-bucket@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    service = PortalService(db_session)
    captured: dict = {}
    monkeypatch.setattr(
        service,
        "list_existing_user_bucket_access",
        lambda *_args, **_kwargs: ["bucket-a"],
    )

    class FakeTrafficService:
        def __init__(self, _account):
            pass

        def get_traffic(self, *, window, bucket=None, bucket_filters=None):
            captured["bucket"] = bucket
            captured["bucket_filters"] = bucket_filters
            return {"window": window.value}

    monkeypatch.setattr(portal_router, "TrafficService", FakeTrafficService)

    portal_router.portal_traffic(
        window=TrafficWindow.WEEK,
        bucket="bucket-a",
        access=_portal_access(account, user),
        portal_service=service,
    )

    assert captured == {"bucket": "bucket-a", "bucket_filters": None}

    with pytest.raises(HTTPException) as excinfo:
        portal_router.portal_traffic(
            window=TrafficWindow.WEEK,
            bucket="bucket-b",
            access=_portal_access(account, user),
            portal_service=service,
        )
    assert excinfo.value.status_code == 403


def test_list_access_keys_without_bootstrap_returns_empty(monkeypatch, db_session):
    account = S3Account(name="portal-account-no-keys", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-nokeys@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=AccountRole.PORTAL_USER.value,
        capabilities=AccountCapabilities(
            can_manage_buckets=False,
            can_manage_portal_users=False,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )
    service = PortalService(db_session)

    def fail_get_iam_service(*args, **kwargs):
        raise AssertionError("IAM service should not be initialized when no portal link exists")

    monkeypatch.setattr(service, "_get_iam_service", fail_get_iam_service)

    keys = service.list_access_keys(user, access)

    assert keys == []


def test_bootstrap_portal_identity_sets_just_created(monkeypatch, db_session):
    account = S3Account(name="portal-account-bootstrap", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-bootstrap@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=AccountRole.PORTAL_MANAGER.value,
        capabilities=AccountCapabilities(
            can_manage_buckets=True,
            can_manage_portal_users=True,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )
    service = PortalService(db_session)
    link = AccountIAMUser(
        user_id=user.id,
        account_id=account.id,
        iam_user_id="iam-uid",
        iam_username="portal-bootstrap-iam",
        active_access_key="AK-PORTAL",
        active_secret_key="SK-PORTAL",
    )
    expected_state = PortalState(
        account_id=account.id,
        iam_user=PortalIAMUser(iam_user_id="iam-uid", iam_username="portal-bootstrap-iam"),
        iam_provisioned=True,
        access_keys=[],
        account_role=AccountRole.PORTAL_MANAGER.value,
        can_manage_buckets=True,
        can_manage_portal_users=True,
    )

    monkeypatch.setattr(service, "_get_iam_service", lambda acc: object())
    monkeypatch.setattr(service, "_ensure_portal_user", lambda *args, **kwargs: (link, None, True))
    monkeypatch.setattr(service, "_effective_portal_settings", lambda acc: PortalSettings())
    monkeypatch.setattr(service, "_sync_user_group_membership", lambda *args, **kwargs: None)
    monkeypatch.setattr(service, "_ensure_policy_and_key", lambda *args, **kwargs: None)
    monkeypatch.setattr(service, "get_state", lambda *_args, **_kwargs: expected_state)

    state = service.bootstrap_portal_identity(user, access)

    assert state.just_created is True


def test_get_state_keeps_portal_identity_metadata_local(monkeypatch, db_session):
    account = S3Account(name="portal-account-user-visibility", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-visibility@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    link = AccountIAMUser(
        user_id=user.id,
        account_id=account.id,
        iam_user_id="iam-uid",
        iam_username="portal-user-iam",
        active_access_key="AK-PORTAL",
        active_secret_key="SK-PORTAL",
    )
    db_session.add(link)
    db_session.commit()

    access = AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=AccountRole.PORTAL_USER.value,
        capabilities=AccountCapabilities(
            can_manage_buckets=True,
            can_manage_portal_users=False,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )
    service = PortalService(db_session)

    monkeypatch.setattr(service, "_effective_portal_settings", lambda acc: PortalSettings(allow_portal_key=True))
    monkeypatch.setattr(service, "_get_iam_service", lambda acc: pytest.fail("PortalState must not initialize IAM"))
    monkeypatch.setattr(service, "_account_quota", lambda acc: pytest.fail("PortalState must not load quotas"))

    state = service.get_state(user, access)

    assert state.iam_provisioned is True
    assert state.iam_user.iam_username == "portal-user-iam"
    assert state.iam_user.arn is None
    assert state.access_keys == []


def test_access_keys_state_hides_portal_key_and_exposes_policy(monkeypatch, db_session):
    endpoint = StorageEndpoint(
        name="portal-keys-path-style",
        endpoint_url="https://portal-keys.example.test",
        force_path_style=True,
    )
    account = S3Account(
        name="portal-account-keys-state",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
        storage_endpoint=endpoint,
    )
    user = User(email="portal-keys-state@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([endpoint, account, user])
    db_session.commit()

    link = AccountIAMUser(
        user_id=user.id,
        account_id=account.id,
        iam_user_id="iam-uid",
        iam_username="portal-user-iam",
        active_access_key="AK-PORTAL",
        active_secret_key="SK-PORTAL",
    )
    db_session.add(link)
    db_session.commit()

    service = PortalService(db_session)

    class _FakeIAMService:
        def get_user(self, iam_username):
            return IAMUser(name=iam_username, arn=f"arn:aws:iam:::user/{iam_username}")

        def list_access_keys(self, iam_username):  # noqa: ARG002
            return [
                PortalAccessKey(access_key_id="AK-PORTAL", status="Active", created_at="2026-01-01T00:00:00Z"),
                PortalAccessKey(access_key_id="AK-USER", status="Inactive", created_at="2026-01-02T00:00:00Z"),
            ]

    monkeypatch.setattr(service, "_get_iam_service", lambda acc: _FakeIAMService())
    monkeypatch.setattr(
        service,
        "_effective_portal_settings",
        lambda acc: PortalSettings(allow_portal_user_access_key_create=True, max_portal_user_access_keys=3),
    )

    state = service.get_access_keys_state(user, _portal_access(account, user))

    assert state.iam_user.iam_username == "portal-user-iam"
    assert state.s3_endpoint == "https://portal-keys.example.test"
    assert state.force_path_style is True
    assert state.can_manage_access_keys is True
    assert state.max_access_keys == 3
    assert [key.access_key_id for key in state.access_keys] == ["AK-USER"]
    assert state.access_keys[0].secret_access_key is None
    assert all(not key.is_portal for key in state.access_keys)


def test_get_state_does_not_list_buckets_for_portal_manager(monkeypatch, db_session):
    account = S3Account(name="portal-account-manager-scope", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-manager-scope@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    link = AccountIAMUser(
        user_id=user.id,
        account_id=account.id,
        iam_user_id="iam-uid",
        iam_username="portal-manager-iam",
        active_access_key="AK-PORTAL",
        active_secret_key="SK-PORTAL",
    )
    db_session.add(link)
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="bucket-a",
            visibility="shared",
        )
    )
    db_session.commit()

    access = AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=AccountRole.PORTAL_MANAGER.value,
        capabilities=AccountCapabilities(
            can_manage_buckets=True,
            can_manage_portal_users=True,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )
    service = PortalService(db_session)

    monkeypatch.setattr(service, "_get_iam_service", lambda acc: pytest.fail("PortalState must not initialize IAM"))
    monkeypatch.setattr(service, "_account_quota", lambda acc: pytest.fail("PortalState must not load quotas"))
    monkeypatch.setattr(s3_client, "list_buckets", lambda **kwargs: pytest.fail("PortalState must not list buckets"))

    state = service.get_state(user, access)

    assert state.can_manage_buckets is True


def test_get_state_does_not_list_buckets_for_portal_user(monkeypatch, db_session):
    account = S3Account(name="portal-account-user-scope", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-scope@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    link = AccountIAMUser(
        user_id=user.id,
        account_id=account.id,
        iam_user_id="iam-uid",
        iam_username="portal-user-iam",
        active_access_key="AK-PORTAL",
        active_secret_key="SK-PORTAL",
    )
    db_session.add(link)
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="bucket-user",
            visibility="shared",
        )
    )
    db_session.commit()

    access = AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=AccountRole.PORTAL_USER.value,
        capabilities=AccountCapabilities(
            can_manage_buckets=False,
            can_manage_portal_users=False,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )
    service = PortalService(db_session)

    class _FakeIAMService:
        def get_user(self, iam_username):
            return IAMUser(name=iam_username, arn=f"arn:aws:iam:::user/{iam_username}")

        def list_access_keys(self, iam_username):  # noqa: ARG002
            return [
                PortalAccessKey(access_key_id="AK-PORTAL", status="Active", created_at="2026-01-01T00:00:00Z"),
                PortalAccessKey(access_key_id="AK-USER", status="Active", created_at="2026-01-02T00:00:00Z"),
            ]

    monkeypatch.setattr(service, "_get_iam_service", lambda acc: _FakeIAMService())
    monkeypatch.setattr(service, "_account_quota", lambda acc: (None, None))
    monkeypatch.setattr(s3_client, "list_buckets", lambda **kwargs: pytest.fail("PortalState must not list buckets"))

    state = service.get_state(user, access)

    assert state.can_manage_buckets is False
    assert state.can_create_private_storage_spaces is True
    assert state.can_create_team_storage_spaces is False


def test_get_state_disables_storage_space_creation_for_portal_user_when_setting_is_disabled(
    monkeypatch,
    db_session,
):
    account = S3Account(name="portal-account-user-create-disabled", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-create-disabled@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
    portal_settings = PortalSettings(allow_private_storage_space_create=False)
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: portal_settings)

    state = service.get_state(user, access)

    assert state.can_manage_buckets is False
    assert state.can_create_private_storage_spaces is False
    assert state.can_create_team_storage_spaces is False


def test_get_state_exposes_effective_server_access_logging_setting(monkeypatch, db_session):
    account = S3Account(name="portal-account-server-logs-disabled", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-server-logs-disabled@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
    portal_settings = PortalSettings(server_access_logging_enabled=False)
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: portal_settings)

    state = service.get_state(user, access)

    assert state.server_access_logging_enabled is False


def test_get_state_ignores_bucket_scope_for_portal_state(monkeypatch, db_session):
    account = S3Account(name="portal-account-empty-scope", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-empty-scope@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    link = AccountIAMUser(
        user_id=user.id,
        account_id=account.id,
        iam_user_id="iam-uid",
        iam_username="portal-empty-iam",
        active_access_key="AK-PORTAL",
        active_secret_key="SK-PORTAL",
    )
    db_session.add(link)
    db_session.commit()

    access = AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=AccountRole.PORTAL_USER.value,
        capabilities=AccountCapabilities(
            can_manage_buckets=False,
            can_manage_portal_users=False,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )
    service = PortalService(db_session)

    class _FakeIAMService:
        def get_user(self, iam_username):
            return IAMUser(name=iam_username, arn=f"arn:aws:iam:::user/{iam_username}")

        def list_access_keys(self, iam_username):  # noqa: ARG002
            return [
                PortalAccessKey(access_key_id="AK-PORTAL", status="Active", created_at="2026-01-01T00:00:00Z"),
                PortalAccessKey(access_key_id="AK-USER", status="Active", created_at="2026-01-02T00:00:00Z"),
            ]

    monkeypatch.setattr(service, "_get_iam_service", lambda acc: _FakeIAMService())
    monkeypatch.setattr(service, "_account_quota", lambda acc: (None, None))
    monkeypatch.setattr(
        service,
        "list_existing_user_bucket_access",
        lambda target, scoped_account, role: [],  # noqa: ARG005
    )
    monkeypatch.setattr(s3_client, "list_buckets", lambda **kwargs: pytest.fail("PortalState must not list buckets"))

    state = service.get_state(user, access)

    assert state.iam_provisioned is True
    assert state.access_keys == []


def test_list_storage_spaces_maps_visible_metadata_to_workspace_summary(db_session):
    account = S3Account(name="portal-storage-spaces", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-spaces@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="research-data",
            display_name="Research Data",
            visibility="shared",
        )
    )
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)

    spaces = service.list_storage_spaces(user, access, search="research")

    assert len(spaces) == 1
    assert spaces[0].id == "research-data"
    assert spaces[0].name == "Research Data"
    assert spaces[0].role == "Manager"
    assert spaces[0].status == "Active"
    assert spaces[0].internal_bucket_name == "research-data"
    assert spaces[0].used_bytes is None
    assert spaces[0].object_count is None
    assert spaces[0].can_delete is True


def test_storage_space_metadata_filters_sorting_and_archive(db_session):
    account = S3Account(name="portal-storage-metadata", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-metadata@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    db_session.add_all(
        [
            PortalStorageSpaceMetadata(
                account_id=account.id,
                bucket_name="research-data",
                display_name="Genome Project",
                description="Primary sequencing dataset",
                visibility="shared",
                project_key="GEN-2026",
            ),
            PortalStorageSpaceMetadata(
                account_id=account.id,
                bucket_name="old-data",
                display_name="Old Data",
                owner_user_id=user.id,
                archived_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            ),
        ]
    )
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)

    spaces = service.list_storage_spaces(user, access, search="gen", sort="-used_bytes")
    archived = service.list_storage_spaces(user, access, include_archived=True, status="Archived")

    assert [(space.id, space.name, space.description, space.owner_label, space.visibility) for space in spaces] == [
        ("research-data", "Genome Project", "Primary sequencing dataset", "", "shared")
    ]
    assert [(space.id, space.status) for space in archived] == [("old-data", "Archived")]


def test_private_storage_space_is_visible_only_to_owner_and_portal_managers(db_session):
    account = S3Account(name="portal-private-space", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-private@example.com", hashed_password="x", role="ui_user")
    other = User(email="other-private@example.com", hashed_password="x", role="ui_user")
    manager = User(email="manager-private@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, other, manager])
    db_session.commit()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="private-data",
            display_name="Private Data",
            owner_user_id=owner.id,
            visibility="private",
        )
    )
    db_session.commit()

    service = PortalService(db_session)

    owner_spaces = service.list_storage_spaces(owner, _portal_access(account, owner))
    other_spaces = service.list_storage_spaces(other, _portal_access(account, other))
    manager_spaces = service.list_storage_spaces(
        manager,
        _portal_access(account, manager, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True),
    )

    assert [(space.id, space.role, space.status, space.visibility) for space in owner_spaces] == [
        ("private-data", "Owner", "Active", "private")
    ]
    assert owner_spaces[0].can_browse is True
    assert owner_spaces[0].can_delete is True
    assert other_spaces == []
    assert [(space.id, space.role, space.status) for space in manager_spaces] == [
        ("private-data", "Manager", "Active")
    ]
    assert manager_spaces[0].can_browse is True
    assert manager_spaces[0].can_take_ownership is True
    assert manager_spaces[0].can_delete is True


def test_portal_manager_can_take_private_storage_space_ownership(monkeypatch, db_session):
    account = S3Account(name="take-private-owner")
    previous_owner = User(email="previous-owner@example.test", hashed_password="x", role="ui_user")
    manager = User(email="taking-manager@example.test", hashed_password="x", role="ui_user")
    db_session.add_all([account, previous_owner, manager])
    db_session.commit()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="private-space",
        display_name="Private space",
        visibility="private",
        owner_user_id=previous_owner.id,
    )
    db_session.add(metadata)
    db_session.commit()

    service = PortalService(db_session)
    projection_calls = []
    policy_calls = []
    sentinel = object()
    monkeypatch.setattr(service, "_resolve_storage_space_bucket_name", lambda *_args, **_kwargs: "private-space")
    monkeypatch.setattr(
        service,
        "_sync_storage_space_user_projections",
        lambda _account, user_ids: projection_calls.append(set(user_ids)),
    )
    monkeypatch.setattr(
        service,
        "_sync_storage_space_bucket_policy",
        lambda _account, bucket_name, _metadata: policy_calls.append(bucket_name),
    )
    monkeypatch.setattr(service, "get_storage_space", lambda *_args, **_kwargs: sentinel)

    result = service.take_private_storage_space_ownership(
        manager,
        _portal_access(account, manager, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True),
        "private-space",
    )

    db_session.refresh(metadata)
    assert result is sentinel
    assert metadata.owner_user_id == manager.id
    assert projection_calls == [{previous_owner.id, manager.id}]
    assert policy_calls == ["private-space"]


def test_private_owner_cannot_lose_final_portal_role(db_session):
    account = S3Account(name="owned-role-guard")
    owner = User(email="guarded-owner@example.test", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner])
    db_session.commit()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="guarded-private-space",
            visibility="private",
            owner_user_id=owner.id,
        )
    )
    db_session.commit()

    before = {(owner.id, account.id): AccountRole.PORTAL_USER.value}
    after = {}

    with pytest.raises(ValueError, match="take ownership"):
        sync_portal_role_downgrades(db_session, before=before, after=after)


def test_delete_storage_space_removes_empty_imported_bucket_and_access_state(monkeypatch, db_session):
    account = S3Account(name="portal-delete-space", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-delete@example.com", hashed_password="x", role="ui_user")
    delegated_owner = User(email="delegated-delete@example.com", hashed_password="x", role="ui_user")
    viewer = User(email="viewer-delete@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, delegated_owner, viewer])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(user_id=owner.id, account_id=account.id, role=AccountRole.PORTAL_MANAGER.value),
            UserS3Account(user_id=delegated_owner.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            UserS3Account(user_id=viewer.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
        ]
    )
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="imported-data",
        display_name="Imported Data",
        visibility="shared",
        origin="imported",
    )
    db_session.add(metadata)
    db_session.flush()
    db_session.add_all(
        [
            PortalStorageSpaceGrant(
                storage_space_metadata_id=metadata.id,
                user_id=delegated_owner.id,
                role="Editor",
            ),
            PortalStorageSpaceGrant(
                storage_space_metadata_id=metadata.id,
                user_id=viewer.id,
                role="Viewer",
            ),
            PortalExternalAccessCredential(
                account_id=account.id,
                storage_space_metadata_id=metadata.id,
                bucket_name="imported-data",
                created_by_user_id=owner.id,
                external_email="external@example.com",
                permission="read_only",
                iam_user_id="external-delete-id",
                iam_username="external-delete-user",
                access_key_id="AK-EXTERNAL-DELETE",
                status="Active",
            ),
            PortalPublicLink(
                token="delete-space-token",
                account_id=account.id,
                bucket_name="imported-data",
                object_key="old-report.csv",
                created_by_user_id=owner.id,
                created_by_email=owner.email,
            ),
        ]
    )
    db_session.commit()

    service = PortalService(db_session)
    delete_bucket_calls = []
    projection_calls = []
    iam_calls = []

    class FakeIAMService:
        def delete_access_key(self, username, access_key_id):
            iam_calls.append(("delete_access_key", username, access_key_id))

        def delete_user_inline_policy(self, username, policy_name):
            iam_calls.append(("delete_policy", username, policy_name))

        def delete_user(self, username):
            iam_calls.append(("delete_user", username))

    monkeypatch.setattr(service, "_storage_space_deletion_usage", lambda *_args: (True, 0, 0))
    monkeypatch.setattr(
        service,
        "delete_bucket",
        lambda *args, **kwargs: delete_bucket_calls.append((args, kwargs)),
    )
    monkeypatch.setattr(service, "_get_iam_service", lambda _account: FakeIAMService())
    monkeypatch.setattr(
        service,
        "_sync_storage_space_user_projections",
        lambda scoped_account, user_ids: projection_calls.append((scoped_account.id, set(user_ids))),
    )

    result = service.delete_storage_space(
        owner,
        _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True),
        "imported-data",
    )

    assert result == {
        "storage_space_id": "imported-data",
        "storage_space_name": "Imported Data",
        "origin": "imported",
        "used_bytes": 0,
        "object_count": 0,
        "participant_count": 3,
        "external_access_count": 1,
        "public_link_count": 1,
        "bucket_already_absent": False,
    }
    assert delete_bucket_calls[0][0][2] == "imported-data"
    assert delete_bucket_calls[0][1] == {"force": False, "use_root": True}
    assert iam_calls == [
        ("delete_access_key", "external-delete-user", "AK-EXTERNAL-DELETE"),
        ("delete_policy", "external-delete-user", service._external_access_policy_name),
        ("delete_user", "external-delete-user"),
    ]
    assert projection_calls == [(account.id, {owner.id, delegated_owner.id, viewer.id})]
    assert db_session.query(PortalStorageSpaceMetadata).filter_by(bucket_name="imported-data").first() is None
    assert db_session.query(PortalStorageSpaceGrant).filter_by(storage_space_metadata_id=metadata.id).count() == 0
    assert db_session.query(PortalExternalAccessCredential).filter_by(bucket_name="imported-data").count() == 0
    link = db_session.query(PortalPublicLink).filter_by(token="delete-space-token").one()
    assert link.revoked_at is not None


def test_delete_storage_space_allows_portal_manager_on_private_space(monkeypatch, db_session):
    account = S3Account(name="portal-delete-denied", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-delete-denied@example.com", hashed_password="x", role="ui_user")
    manager = User(email="manager-delete-denied@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, manager])
    db_session.commit()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="private-delete-denied",
            owner_user_id=owner.id,
            visibility="private",
        )
    )
    db_session.commit()
    service = PortalService(db_session)
    calls = []
    monkeypatch.setattr(service, "_storage_space_deletion_usage", lambda *_args: calls.append(True) or (True, 1, 0))

    with pytest.raises(PortalStorageSpaceNotEmpty):
        service.delete_storage_space(
            manager,
            _portal_access(account, manager, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True),
            "private-delete-denied",
        )
    assert calls == [True]


@pytest.mark.parametrize("role", ["Editor", "Viewer"])
def test_delete_storage_space_rejects_non_owner_content_roles(monkeypatch, db_session, role):
    account = S3Account(name=f"portal-delete-{role.lower()}", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email=f"owner-delete-{role.lower()}@example.com", hashed_password="x", role="ui_user")
    participant = User(email=f"{role.lower()}-delete@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, participant])
    db_session.commit()
    db_session.add(UserS3Account(user_id=participant.id, account_id=account.id, role=AccountRole.PORTAL_USER.value))
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name=f"shared-delete-{role.lower()}",
        visibility="shared",
    )
    db_session.add(metadata)
    db_session.flush()
    db_session.add(
        PortalStorageSpaceGrant(
            storage_space_metadata_id=metadata.id,
            user_id=participant.id,
            role=role,
        )
    )
    db_session.commit()
    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "_storage_space_deletion_usage",
        lambda *_args: pytest.fail("Stats must not be fetched for an unauthorized deletion"),
    )

    with pytest.raises(RuntimeError, match="Full content access required"):
        service.delete_storage_space(
            participant,
            _portal_access(account, participant),
            f"shared-delete-{role.lower()}",
        )


@pytest.mark.parametrize(
    ("usage", "expected_message"),
    [
        ((True, 1, 0), "not empty"),
        ((True, 0, 1), "not empty"),
        ((True, None, None), "statistics are unavailable"),
    ],
)
def test_delete_storage_space_requires_zero_known_stats(monkeypatch, db_session, usage, expected_message):
    account = S3Account(name=f"portal-delete-stats-{usage}", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email=f"owner-delete-stats-{usage}@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner])
    db_session.commit()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="delete-stats-data",
            owner_user_id=owner.id,
            visibility="private",
        )
    )
    db_session.commit()
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_storage_space_deletion_usage", lambda *_args: usage)
    monkeypatch.setattr(service, "delete_bucket", lambda *_args, **_kwargs: pytest.fail("Bucket deletion must be blocked"))

    expected_exception = PortalStorageSpaceNotEmpty if "not empty" in expected_message else RuntimeError
    with pytest.raises(expected_exception, match=expected_message):
        service.delete_storage_space(owner, _portal_access(account, owner), "delete-stats-data")

    assert db_session.query(PortalStorageSpaceMetadata).filter_by(bucket_name="delete-stats-data").one()


def test_delete_storage_space_maps_delete_bucket_race_without_force(monkeypatch, db_session):
    account = S3Account(name="portal-delete-race", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-delete-race@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner])
    db_session.commit()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="delete-race-data",
            owner_user_id=owner.id,
            visibility="private",
        )
    )
    db_session.commit()
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_storage_space_deletion_usage", lambda *_args: (True, 0, 0))

    def reject_delete(_user, _access, _bucket_name, *, force, use_root):
        assert force is False
        assert use_root is True
        raise s3_client.BucketNotEmptyError("BucketNotEmpty")

    monkeypatch.setattr(service, "delete_bucket", reject_delete)
    with pytest.raises(PortalStorageSpaceNotEmpty, match="not empty"):
        service.delete_storage_space(owner, _portal_access(account, owner), "delete-race-data")


def test_delete_storage_space_finalizes_archived_metadata_when_bucket_is_already_absent(monkeypatch, db_session):
    account = S3Account(name="portal-delete-archived", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-delete-archived@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner])
    db_session.commit()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="delete-archived-data",
            owner_user_id=owner.id,
            visibility="private",
            archived_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
        )
    )
    db_session.commit()
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_storage_space_deletion_usage", lambda *_args: (False, None, None))
    monkeypatch.setattr(service, "delete_bucket", lambda *_args, **_kwargs: pytest.fail("Missing bucket must not be deleted again"))
    monkeypatch.setattr(service, "_delete_storage_space_external_iam_credentials", lambda *_args: 0)
    monkeypatch.setattr(service, "_sync_storage_space_user_projections", lambda *_args: None)

    result = service.delete_storage_space(owner, _portal_access(account, owner), "delete-archived-data")

    assert result["bucket_already_absent"] is True
    assert db_session.query(PortalStorageSpaceMetadata).filter_by(bucket_name="delete-archived-data").first() is None


def test_delete_storage_space_retry_finishes_after_partial_external_iam_cleanup(monkeypatch, db_session):
    account = S3Account(name="portal-delete-iam-retry", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-delete-iam-retry@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner])
    db_session.commit()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="delete-iam-retry-data",
        owner_user_id=owner.id,
        visibility="private",
    )
    db_session.add(metadata)
    db_session.flush()
    db_session.add(
        PortalExternalAccessCredential(
            account_id=account.id,
            storage_space_metadata_id=metadata.id,
            bucket_name=metadata.bucket_name,
            created_by_user_id=owner.id,
            external_email="already-cleaned@example.com",
            permission="read_only",
            iam_user_id="already-cleaned-id",
            iam_username="already-cleaned-user",
            access_key_id="AK-ALREADY-CLEANED",
            status="Active",
        )
    )
    db_session.commit()
    service = PortalService(db_session)
    iam_calls = []

    class AlreadyCleanedIAMService:
        def delete_access_key(self, username, access_key_id):
            iam_calls.append(("access_key", username, access_key_id))

        def delete_user_inline_policy(self, username, policy_name):
            iam_calls.append(("policy", username, policy_name))

        def delete_user(self, username):
            iam_calls.append(("user", username))

    monkeypatch.setattr(service, "_storage_space_deletion_usage", lambda *_args: (False, None, None))
    monkeypatch.setattr(service, "_get_iam_service", lambda _account: AlreadyCleanedIAMService())
    monkeypatch.setattr(service, "_sync_storage_space_user_projections", lambda *_args: None)

    result = service.delete_storage_space(owner, _portal_access(account, owner), metadata.bucket_name)

    assert result["bucket_already_absent"] is True
    assert iam_calls == [
        ("access_key", "already-cleaned-user", "AK-ALREADY-CLEANED"),
        ("policy", "already-cleaned-user", service._external_access_policy_name),
        ("user", "already-cleaned-user"),
    ]
    assert db_session.query(PortalExternalAccessCredential).filter_by(bucket_name=metadata.bucket_name).count() == 0
    assert db_session.query(PortalStorageSpaceMetadata).filter_by(bucket_name=metadata.bucket_name).first() is None


def test_delete_storage_space_route_returns_no_content_and_audits_without_secrets(db_session):
    account = S3Account(name="portal-delete-route", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-delete-route@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner])
    db_session.commit()
    result = {
        "storage_space_id": "route-data",
        "storage_space_name": "Route Data",
        "origin": "portal_generic",
        "used_bytes": 0,
        "object_count": 0,
        "participant_count": 1,
        "external_access_count": 0,
        "public_link_count": 0,
        "bucket_already_absent": False,
    }

    class FakePortalService:
        def delete_storage_space(self, actor, access, space_id):
            assert actor.id == owner.id
            assert access.account.id == account.id
            assert space_id == "route-data"
            return result

    class FakeAuditService:
        def __init__(self):
            self.actions = []

        def record_action(self, **kwargs):
            self.actions.append(kwargs)

    audit_service = FakeAuditService()
    response = portal_router.delete_portal_storage_space(
        "route-data",
        access=_portal_access(account, owner),
        audit_service=audit_service,
        service=FakePortalService(),
    )

    assert response.status_code == 204
    assert audit_service.actions[0]["action"] == "delete_storage_space"
    assert audit_service.actions[0]["metadata"] == result
    assert "ROOT-AK" not in json.dumps(audit_service.actions[0]["metadata"])
    assert "ROOT-SK" not in json.dumps(audit_service.actions[0]["metadata"])


def test_delete_storage_space_route_maps_non_empty_to_conflict(db_session):
    account = S3Account(name="portal-delete-route-conflict", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-delete-route-conflict@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner])
    db_session.commit()

    class FakePortalService:
        def delete_storage_space(self, *_args):
            raise PortalStorageSpaceNotEmpty("Storage Space is not empty. Clean up its history.")

    with pytest.raises(HTTPException) as exc_info:
        portal_router.delete_portal_storage_space(
            "route-data",
            access=_portal_access(account, owner),
            audit_service=None,
            service=FakePortalService(),
        )

    assert exc_info.value.status_code == 409
    assert "not empty" in exc_info.value.detail


def test_storage_space_list_includes_collaborator_avatar_previews(db_session):
    account = S3Account(name="portal-avatar-previews", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(
        email="owner-avatar@example.com",
        full_name="Owner Avatar",
        display_name="Owner Avatar",
        picture_url="https://identity.example.com/owner.png",
        hashed_password="x",
        role="ui_user",
    )
    viewer = User(
        email="viewer-avatar@example.com",
        full_name="Viewer Avatar",
        display_name="Viewer Avatar",
        hashed_password="x",
        role="ui_user",
    )
    manager = User(email="manager-avatar@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, viewer, manager])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(user_id=owner.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            UserS3Account(user_id=viewer.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            UserS3Account(user_id=manager.id, account_id=account.id, role=AccountRole.PORTAL_MANAGER.value),
        ]
    )
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="shared-avatar-data",
        display_name="Shared Avatar Data",
        visibility="shared",
        share_scope="restricted",
    )
    db_session.add(metadata)
    db_session.flush()
    db_session.add(
        PortalStorageSpaceGrant(
            storage_space_metadata_id=metadata.id,
            user_id=viewer.id,
            role="Viewer",
        )
    )
    db_session.commit()

    spaces = PortalService(db_session).list_storage_spaces(
        manager,
        _portal_access(account, manager, role=AccountRole.PORTAL_MANAGER.value),
    )

    assert len(spaces) == 1
    assert spaces[0].collaborator_count == 1
    assert [(item.display_name, item.role, item.avatar.source) for item in spaces[0].collaborators] == [
        ("Viewer Avatar", "Viewer", "gravatar"),
    ]
    assert spaces[0].collaborators[0].avatar.url


def test_portal_manager_content_access_is_carried_only_by_the_manager_group(monkeypatch, db_session):
    account = S3Account(name="portal-manager-content", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-content@example.com", hashed_password="x", role="ui_user")
    manager = User(email="manager-content@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, manager])
    db_session.commit()
    db_session.add_all(
        [
            PortalStorageSpaceMetadata(
                account_id=account.id,
                bucket_name="owner-private",
                display_name="Owner Private",
                owner_user_id=owner.id,
                visibility="private",
            ),
            PortalStorageSpaceMetadata(
                account_id=account.id,
                bucket_name="owner-shared",
                display_name="Owner Shared",
                visibility="shared",
            ),
            PortalStorageSpaceMetadata(
                account_id=account.id,
                bucket_name="manager-private",
                display_name="Manager Private",
                owner_user_id=manager.id,
                visibility="private",
            ),
        ]
    )
    db_session.commit()

    service = PortalService(db_session)

    class FakeIAMService:
        def __init__(self):
            self.policies = {}

        def get_user_inline_policy(self, username, policy_name):
            return self.policies.get((username, policy_name))

        def put_user_inline_policy(self, username, policy_name, policy_document):
            self.policies[(username, policy_name)] = policy_document

        def delete_user_inline_policy(self, username, policy_name):
            self.policies.pop((username, policy_name), None)

    iam = FakeIAMService()
    service._sync_user_storage_space_projection(
        manager,
        account,
        AccountRole.PORTAL_MANAGER.value,
        iam,
        "manager-iam",
    )

    assert ("manager-iam", service._bucket_access_policy_name) not in iam.policies


def test_portal_manager_can_read_and_modify_private_storage_space_content_owned_by_others(monkeypatch, db_session):
    account = S3Account(name="portal-manager-private-content", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-private-content@example.com", hashed_password="x", role="ui_user")
    manager = User(email="manager-private-content@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, manager])
    db_session.commit()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="private-data",
            display_name="Private Data",
            owner_user_id=owner.id,
            visibility="private",
        )
    )
    db_session.commit()

    service = PortalService(db_session)
    class FakeClient:
        def head_object(self, **_kwargs):
            return {"ContentLength": 4, "ContentType": "text/plain"}

        def get_object(self, **_kwargs):
            return {"Body": type("Body", (), {"read": lambda self, *_args: b"data"})()}

        def delete_object(self, **_kwargs):
            return None

    monkeypatch.setattr(service, "_portal_object_client", lambda *_args, **_kwargs: FakeClient())
    access = _portal_access(account, manager, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    assert service.get_storage_space_object_detail(manager, access, "private-data", "file.txt").size == 4
    assert service.download_storage_space_object(manager, access, "private-data", "file.txt")[0].read() == b"data"
    service.delete_storage_space_object(manager, access, "private-data", "file.txt")


def test_portal_browser_allowed_buckets_use_content_access(monkeypatch, db_session):
    from fastapi import Request
    from app.routers.dependencies_internal import portal_access as portal_access_deps

    account = S3Account(name="portal-browser-content", rgw_account_id="tenant-browser")
    user = User(email="portal-browser-content@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    link = UserS3Account(user_id=user.id, account_id=account.id, role=AccountRole.PORTAL_MANAGER.value)

    app_settings = AppSettings()
    app_settings.general.portal_enabled = True
    app_settings.general.browser_portal_enabled = True
    monkeypatch.setattr(portal_access_deps, "load_app_settings", lambda: app_settings)
    monkeypatch.setattr(portal_access_deps, "_validate_portal_account_surface", lambda _account: None)
    monkeypatch.setattr(PortalService, "get_portal_credentials", lambda *_args, **_kwargs: ("AK", "SK"))
    monkeypatch.setattr(
        PortalService,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="owner-private",
                name="Owner Private",
                role="Manager",
                can_browse=False,
                internal_bucket_name="owner-private",
            ),
            PortalStorageSpaceSummary(
                id="shared-data",
                name="Shared Data",
                role="Manager",
                can_browse=True,
                internal_bucket_name="shared-data",
            ),
        ],
    )
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/browser/buckets/search",
            "headers": [],
            "query_string": b"",
            "server": ("testserver", 80),
            "scheme": "http",
        }
    )

    scoped_account = portal_access_deps._resolve_portal_browser_context(
        db_session,
        user,
        account,
        link,
        request=request,
    )

    assert scoped_account._portal_allowed_buckets == {"shared-data"}
    assert [space.id for space in scoped_account._portal_storage_spaces] == ["shared-data"]


def _storage_space_policy_statement(policy: dict, sid: str) -> dict:
    statements = policy.get("Statement") or []
    if not isinstance(statements, list):
        statements = [statements]
    return next(stmt for stmt in statements if stmt.get("Sid") == sid)


def _storage_space_policy_principals(statement: dict) -> set[str]:
    principals = statement.get("NotPrincipal", {}).get("AWS", [])
    if isinstance(principals, str):
        principals = [principals]
    return {principal for principal in principals if isinstance(principal, str)}


def test_storage_space_bucket_policy_preserves_external_statements_and_private_owner_guard(db_session):
    account = S3Account(
        name="portal-policy-space",
        rgw_account_id="rgw-policy-account",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    owner = User(email="owner-policy@example.com", hashed_password="x", role="ui_user")
    manager = User(email="manager-policy@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, manager])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(user_id=manager.id, account_id=account.id, role=AccountRole.PORTAL_MANAGER.value),
            AccountIAMUser(user_id=owner.id, account_id=account.id, iam_user_id="owner-iam-id", iam_username="owner-iam"),
            AccountIAMUser(user_id=manager.id, account_id=account.id, iam_user_id="manager-iam-id", iam_username="manager-iam"),
        ]
    )
    db_session.commit()

    service = PortalService(db_session)
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="research-data",
        owner_user_id=owner.id,
        visibility="private",
    )
    existing = {
        "Version": "2012-10-17",
        "Statement": [
            {"Sid": "ExternalRule", "Effect": "Allow", "Action": "s3:GetObject", "Resource": "*"},
            {"Sid": service._storage_space_private_sid, "Effect": "Deny", "Action": "s3:*", "Resource": "*"},
            {"Sid": service._storage_space_archived_sid, "Effect": "Deny", "Action": "s3:*", "Resource": "*"},
        ],
    }

    private_policy = service._storage_space_bucket_policy(account, "research-data", metadata, existing)
    assert private_policy is not None
    assert [stmt["Sid"] for stmt in private_policy["Statement"]] == ["ExternalRule", service._storage_space_access_sid]
    private_statement = private_policy["Statement"][1]
    allowed_principals = _storage_space_policy_principals(private_statement)
    assert "Principal" not in private_statement
    assert "Condition" not in private_statement
    assert "arn:aws:iam:::user/owner-iam" in allowed_principals
    assert "arn:aws:iam::rgw-policy-account:user/owner-iam" in allowed_principals
    assert "arn:aws:iam:::user/manager-iam" in allowed_principals
    assert "arn:aws:iam::rgw-policy-account:user/manager-iam" in allowed_principals
    assert "arn:aws:iam::rgw-policy-account:root" not in allowed_principals
    assert {
        "s3:GetBucketVersioning",
        "s3:ListBucketVersions",
        "s3:GetObjectVersion",
        "s3:DeleteObjectVersion",
    }.issubset(private_statement["Action"])

    metadata.archived_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    archived_policy = service._storage_space_bucket_policy(account, "research-data", metadata, private_policy)
    assert archived_policy is not None
    assert [stmt["Sid"] for stmt in archived_policy["Statement"]] == ["ExternalRule", service._storage_space_archived_sid]

    metadata.archived_at = None
    metadata.visibility = "shared"
    metadata.owner_user_id = None
    restored_policy = service._storage_space_bucket_policy(account, "research-data", metadata, archived_policy)
    assert restored_policy is not None
    assert [stmt["Sid"] for stmt in restored_policy["Statement"]] == ["ExternalRule", service._storage_space_access_sid]
    restored_principals = _storage_space_policy_principals(restored_policy["Statement"][1])
    assert "arn:aws:iam:::user/owner-iam" not in restored_principals
    assert "arn:aws:iam::rgw-policy-account:root" in restored_principals


def test_account_scope_bucket_policy_allows_effective_portal_members(db_session):
    account = S3Account(
        name="portal-policy-account-scope",
        rgw_account_id="rgw-policy-account",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    owner = User(email="owner-policy-account@example.com", hashed_password="x", role="ui_user")
    direct = User(email="direct-policy-account@example.com", hashed_password="x", role="ui_user")
    grouped = User(email="grouped-policy-account@example.com", hashed_password="x", role="ui_user")
    manager = User(email="manager-policy-account@example.com", hashed_password="x", role="ui_user")
    inactive = User(email="inactive-policy-account@example.com", hashed_password="x", role="ui_user", is_active=False)
    outsider = User(email="outsider-policy-account@example.com", hashed_password="x", role="ui_user")
    group = UiGroup(name="Portal policy group")
    db_session.add_all([account, owner, direct, grouped, manager, inactive, outsider, group])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(user_id=direct.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            UserS3Account(user_id=manager.id, account_id=account.id, role=AccountRole.PORTAL_MANAGER.value),
            UserS3Account(user_id=inactive.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            UiGroupS3Account(group_id=group.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            UserUiGroup(user_id=grouped.id, group_id=group.id),
            AccountIAMUser(user_id=owner.id, account_id=account.id, iam_user_id="owner-iam-id", iam_username="owner-iam"),
            AccountIAMUser(user_id=direct.id, account_id=account.id, iam_user_id="direct-iam-id", iam_username="direct-iam"),
            AccountIAMUser(user_id=grouped.id, account_id=account.id, iam_user_id="grouped-iam-id", iam_username="grouped-iam"),
            AccountIAMUser(user_id=manager.id, account_id=account.id, iam_user_id="manager-iam-id", iam_username="manager-iam"),
            AccountIAMUser(user_id=inactive.id, account_id=account.id, iam_user_id="inactive-iam-id", iam_username="inactive-iam"),
            AccountIAMUser(user_id=outsider.id, account_id=account.id, iam_user_id="outsider-iam-id", iam_username="outsider-iam"),
        ]
    )
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="team-data",
        visibility="shared",
        share_scope="account",
        account_member_role="Editor",
    )
    db_session.add(metadata)
    db_session.commit()

    service = PortalService(db_session)
    policy = service._storage_space_bucket_policy(account, "team-data", metadata, None)
    assert policy is not None
    statement = _storage_space_policy_statement(policy, service._storage_space_access_sid)
    principals = _storage_space_policy_principals(statement)
    for username in ("direct-iam", "grouped-iam", "manager-iam"):
        assert f"arn:aws:iam:::user/{username}" in principals
        assert f"arn:aws:iam::rgw-policy-account:user/{username}" in principals
    assert "arn:aws:iam::rgw-policy-account:root" in principals
    assert "arn:aws:iam:::user/inactive-iam" not in principals
    assert "arn:aws:iam:::user/outsider-iam" not in principals


def test_restricted_bucket_policy_allows_owner_and_real_grants_only(db_session):
    account = S3Account(
        name="portal-policy-restricted",
        rgw_account_id="rgw-policy-account",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    owner = User(email="owner-policy-restricted@example.com", hashed_password="x", role="ui_user")
    viewer = User(email="viewer-policy-restricted@example.com", hashed_password="x", role="ui_user")
    editor = User(email="editor-policy-restricted@example.com", hashed_password="x", role="ui_user")
    delegated_owner = User(email="delegated-owner-policy-restricted@example.com", hashed_password="x", role="ui_user")
    member_without_grant = User(email="member-no-grant-policy-restricted@example.com", hashed_password="x", role="ui_user")
    outsider = User(email="outsider-policy-restricted@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, viewer, editor, delegated_owner, member_without_grant, outsider])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(user_id=viewer.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            UserS3Account(user_id=editor.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            UserS3Account(user_id=delegated_owner.id, account_id=account.id, role=AccountRole.PORTAL_MANAGER.value),
            UserS3Account(user_id=member_without_grant.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            AccountIAMUser(user_id=owner.id, account_id=account.id, iam_user_id="owner-iam-id", iam_username="owner-iam"),
            AccountIAMUser(user_id=viewer.id, account_id=account.id, iam_user_id="viewer-iam-id", iam_username="viewer-iam"),
            AccountIAMUser(user_id=editor.id, account_id=account.id, iam_user_id="editor-iam-id", iam_username="editor-iam"),
            AccountIAMUser(user_id=delegated_owner.id, account_id=account.id, iam_user_id="delegated-owner-iam-id", iam_username="delegated-owner-iam"),
            AccountIAMUser(user_id=member_without_grant.id, account_id=account.id, iam_user_id="member-no-grant-iam-id", iam_username="member-no-grant-iam"),
            AccountIAMUser(user_id=outsider.id, account_id=account.id, iam_user_id="outsider-iam-id", iam_username="outsider-iam"),
        ]
    )
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="restricted-data",
        visibility="shared",
        share_scope="restricted",
    )
    db_session.add(metadata)
    db_session.flush()
    db_session.add_all(
        [
            PortalStorageSpaceGrant(storage_space_metadata_id=metadata.id, user_id=viewer.id, role="Viewer"),
            PortalStorageSpaceGrant(storage_space_metadata_id=metadata.id, user_id=editor.id, role="Editor"),
        ]
    )
    db_session.commit()

    service = PortalService(db_session)
    policy = service._storage_space_bucket_policy(account, "restricted-data", metadata, None)
    assert policy is not None
    statement = _storage_space_policy_statement(policy, service._storage_space_access_sid)
    principals = _storage_space_policy_principals(statement)
    for username in ("viewer-iam", "editor-iam", "delegated-owner-iam"):
        assert f"arn:aws:iam:::user/{username}" in principals
        assert f"arn:aws:iam::rgw-policy-account:user/{username}" in principals
    assert "arn:aws:iam::rgw-policy-account:root" in principals
    assert "arn:aws:iam:::user/member-no-grant-iam" not in principals
    assert "arn:aws:iam:::user/outsider-iam" not in principals


def test_storage_space_bucket_policy_denies_everyone_without_projectable_principals(db_session):
    account = S3Account(name="portal-policy-empty", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-policy-empty@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner])
    db_session.commit()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="empty-data",
        visibility="shared",
        share_scope="restricted",
    )
    db_session.add(metadata)
    db_session.commit()

    service = PortalService(db_session)
    policy = service._storage_space_bucket_policy(account, "empty-data", metadata, None)
    assert policy is not None
    statement = _storage_space_policy_statement(policy, service._storage_space_access_sid)
    assert statement["Principal"] == "*"
    assert "NotPrincipal" not in statement


def test_get_storage_space_keeps_bucket_scope_and_returns_none_when_hidden(monkeypatch, db_session):
    account = S3Account(name="portal-storage-space-scope", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-space-scope@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="allowed-bucket",
            visibility="shared",
        )
    )
    db_session.flush()
    metadata = db_session.query(PortalStorageSpaceMetadata).filter_by(bucket_name="allowed-bucket").one()
    db_session.add(PortalStorageSpaceGrant(storage_space_metadata_id=metadata.id, user_id=user.id, role="Viewer"))
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)

    def fake_stats(_user, _access, bucket_name):
        assert bucket_name == "allowed-bucket"
        return Bucket(name=bucket_name, used_bytes=4096, object_count=24)

    monkeypatch.setattr(service, "get_bucket_stats", fake_stats)

    visible = service.get_storage_space(user, access, "allowed-bucket")
    hidden = service.get_storage_space(user, access, "hidden-bucket")

    assert visible is not None
    assert visible.id == "allowed-bucket"
    assert visible.name == "Allowed Bucket"
    assert visible.role == "Viewer"
    assert visible.status == "Active"
    assert visible.used_bytes == 4096
    assert visible.object_count == 24
    assert hidden is None


def test_create_storage_space_generic_uses_uuid_bucket_and_editable_name(monkeypatch, db_session):
    account = S3Account(name="portal-storage-generic", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-generic@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    created_buckets = []
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: PortalSettings(allow_private_storage_space_create=True))
    monkeypatch.setattr(service, "list_storage_spaces", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        service,
        "create_bucket",
        lambda _user, _access, bucket_name, **kwargs: created_buckets.append((bucket_name, kwargs.get("portal_settings"))),
    )
    monkeypatch.setattr(
        service,
        "get_storage_space",
        lambda _user, _access, bucket_name: PortalStorageSpace(
            id=bucket_name,
            name="Research Data",
            role="Owner",
            internal_bucket_name=bucket_name,
            origin="portal_generic",
            name_editable=True,
        ),
    )

    storage_space = service.create_storage_space(user, access, name="Research Data", description="Lab files")

    assert len(created_buckets) == 1
    bucket_name = created_buckets[0][0]
    assert str(uuid.UUID(bucket_name)) == bucket_name
    metadata = (
        db_session.query(PortalStorageSpaceMetadata)
        .filter_by(account_id=account.id, bucket_name=bucket_name)
        .one()
    )
    assert metadata.display_name == "Research Data"
    assert metadata.description == "Lab files"
    assert metadata.owner_user_id == user.id
    assert metadata.visibility == "private"
    assert metadata.origin == "portal_generic"
    assert metadata.name_editable is True
    assert storage_space.id == bucket_name


def test_create_storage_space_configures_server_access_logging(monkeypatch, db_session):
    account = S3Account(name="portal-storage-logging", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-logging@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    portal_settings = PortalSettings(server_access_logging_enabled=True)
    logging_calls = []
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: portal_settings)
    monkeypatch.setattr(service, "list_storage_spaces", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(service, "create_bucket", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        service,
        "sync_storage_space_server_access_logging",
        lambda account_arg, bucket_name, **kwargs: logging_calls.append(
            (account_arg.id, bucket_name, kwargs.get("portal_settings"))
        ),
    )
    monkeypatch.setattr(
        service,
        "get_storage_space",
        lambda _user, _access, bucket_name: PortalStorageSpace(
            id=bucket_name,
            name="Research Data",
            role="Owner",
            internal_bucket_name=bucket_name,
            origin="portal_generic",
            name_editable=True,
        ),
    )

    storage_space = service.create_storage_space(user, access, name="Research Data")

    assert storage_space.name == "Research Data"
    assert len(logging_calls) == 1
    assert logging_calls[0][0] == account.id
    assert logging_calls[0][2] is portal_settings


def test_storage_space_version_cleanup_deletes_noncurrent_versions_and_orphan_markers(db_session):
    class _FakeVersionClient:
        def __init__(self):
            self.deleted_batches = []

        def list_object_versions(self, **kwargs):  # noqa: ANN001
            assert kwargs["Bucket"] == "research-data"
            return {
                "Versions": [
                    {"Key": "current.txt", "VersionId": "v-current", "IsLatest": True, "Size": 100},
                    {"Key": "current.txt", "VersionId": "v-old", "IsLatest": False, "Size": 20},
                    {"Key": "removed.txt", "VersionId": "v-removed", "IsLatest": False, "Size": 30},
                ],
                "DeleteMarkers": [
                    {"Key": "current.txt", "VersionId": "dm-old", "IsLatest": False},
                    {"Key": "removed.txt", "VersionId": "dm-latest", "IsLatest": True},
                ],
            }

        def delete_objects(self, **kwargs):  # noqa: ANN001
            self.deleted_batches.append(kwargs["Delete"]["Objects"])
            return {"Deleted": kwargs["Delete"]["Objects"]}

    service = PortalService(db_session)
    client = _FakeVersionClient()
    progress = []

    result = service.run_storage_space_version_cleanup(
        PortalStorageSpaceVersionCleanupTarget(
            client=client,
            bucket_name="research-data",
            storage_space_id="research-data",
            storage_space_name="Research Data",
        ),
        progress_callback=progress.append,
    )

    assert result.status == "completed"
    assert result.scanned_versions == 3
    assert result.scanned_delete_markers == 2
    assert result.deleted_versions == 2
    assert result.deleted_delete_markers == 1
    assert result.bytes_freed == 50
    assert client.deleted_batches == [
        [
            {"Key": "current.txt", "VersionId": "v-old"},
            {"Key": "removed.txt", "VersionId": "v-removed"},
        ],
        [{"Key": "removed.txt", "VersionId": "dm-latest"}],
    ]
    assert progress[-1].stage == "completed"
    assert progress[-1].bytes_freed == 50


def test_storage_space_version_cleanup_confirmation_phrase_uses_displayed_uppercase():
    assert portal_storage_space_version_cleanup_confirmation_phrase("Test1") == "CLEAN HISTORY TEST1"
    assert portal_storage_space_version_cleanup_confirmation_phrase("Research Data") == "CLEAN HISTORY RESEARCH DATA"


def test_prepare_storage_space_version_cleanup_requires_effective_setting(monkeypatch, db_session):
    account = S3Account(name="portal-cleanup-disabled", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-cleanup-disabled@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="research-data",
            display_name="Research Data",
            visibility="shared",
        )
    )
    db_session.commit()

    service = PortalService(db_session)
    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    monkeypatch.setattr(
        service,
        "_effective_portal_settings",
        lambda _account: PortalSettings(storage_space_version_cleanup_enabled=False),
    )

    with pytest.raises(RuntimeError, match="not allowed"):
        service.prepare_storage_space_version_cleanup(
            user,
            access,
            "research-data",
            confirmation="CLEAN HISTORY RESEARCH DATA",
        )


def test_prepare_storage_space_version_cleanup_uses_long_running_profile(monkeypatch, db_session):
    account = S3Account(name="portal-cleanup-profile", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-cleanup-profile@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="research-data",
            display_name="Research Data",
            visibility="shared",
        )
    )
    db_session.commit()

    service = PortalService(db_session)
    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    captured: list[dict] = []
    fake_client = object()

    def fake_portal_object_client(_user, _account, **kwargs):  # noqa: ANN001
        captured.append(kwargs)
        return fake_client

    monkeypatch.setattr(service, "_portal_object_client", fake_portal_object_client)

    target = service.prepare_storage_space_version_cleanup(
        user,
        access,
        "research-data",
        confirmation="CLEAN HISTORY RESEARCH DATA",
    )

    assert target.client is fake_client
    assert captured == [{"request_profile": "long_running"}]


def test_portal_user_can_create_storage_space_when_setting_is_enabled(monkeypatch, db_session):
    account = S3Account(name="portal-storage-user-create", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-user-create@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
    portal_settings = PortalSettings(allow_private_storage_space_create=True)
    created_buckets = []
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: portal_settings)
    monkeypatch.setattr(service, "list_storage_spaces", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        service,
        "create_bucket",
        lambda _user, _access, bucket_name, **kwargs: created_buckets.append((bucket_name, kwargs.get("portal_settings"))),
    )
    monkeypatch.setattr(
        service,
        "get_storage_space",
        lambda _user, _access, bucket_name: PortalStorageSpace(
            id=bucket_name,
            name="Research Data",
            role="Owner",
            internal_bucket_name=bucket_name,
            origin="portal_generic",
            name_editable=True,
        ),
    )

    storage_space = service.create_storage_space(user, access, name="Research Data")

    assert storage_space.name == "Research Data"
    assert len(created_buckets) == 1
    bucket_name, applied_settings = created_buckets[0]
    assert str(uuid.UUID(bucket_name)) == bucket_name
    assert applied_settings is portal_settings
    metadata = (
        db_session.query(PortalStorageSpaceMetadata)
        .filter_by(account_id=account.id, bucket_name=bucket_name)
        .one()
    )
    assert metadata.visibility == "private"


def test_portal_user_cannot_create_shared_storage_space(monkeypatch, db_session):
    account = S3Account(name="portal-storage-user-shared-denied", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-user-shared-denied@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
    portal_settings = PortalSettings(allow_private_storage_space_create=True)
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: portal_settings)
    monkeypatch.setattr(
        service,
        "create_bucket",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("Bucket should not be created")),
    )

    with pytest.raises(RuntimeError, match="Portal users can only create private"):
        service.create_storage_space(user, access, name="Research Data", visibility="shared")


def test_portal_user_cannot_create_storage_space_when_setting_is_disabled(monkeypatch, db_session):
    account = S3Account(name="portal-storage-user-create-disabled", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-user-create-disabled@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
    portal_settings = PortalSettings(allow_private_storage_space_create=False)
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: portal_settings)

    with pytest.raises(RuntimeError, match="Storage Space creation not allowed"):
        service.create_storage_space(user, access, name="Research Data")


def test_portal_manager_needs_private_create_setting_but_can_always_create_team_space(monkeypatch, db_session):
    account = S3Account(name="portal-storage-manager-create", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-manager-create@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    portal_settings = PortalSettings(allow_private_storage_space_create=False)
    created_buckets: list[str] = []
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: portal_settings)
    monkeypatch.setattr(service, "_unique_uuid_storage_space_bucket_name", lambda existing: f"bucket-{len(existing) + 1}")
    monkeypatch.setattr(
        service,
        "create_bucket",
        lambda _user, _access, bucket_name, **_kwargs: created_buckets.append(bucket_name),
    )
    monkeypatch.setattr(service, "_sync_storage_space_access_projection", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        service,
        "get_bucket_stats",
        lambda _user, _access, bucket_name: Bucket(name=bucket_name),
    )

    with pytest.raises(RuntimeError, match="Private Storage Space creation is disabled"):
        service.create_storage_space(user, access, name="Private Space", visibility="private")
    shared_space = service.create_storage_space(user, access, name="Shared Space", visibility="shared")

    assert created_buckets == ["bucket-1"]
    assert shared_space.visibility == "shared"


def test_create_restricted_storage_space_persists_initial_shares_atomically(monkeypatch, db_session):
    account = S3Account(name="portal-storage-initial-shares", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-initial@example.com", hashed_password="x", role="ui_user")
    viewer = User(email="viewer-initial@example.com", hashed_password="x", role="ui_user")
    editor = User(email="editor-initial@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, viewer, editor])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(user_id=viewer.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            UserS3Account(user_id=editor.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
        ]
    )
    db_session.commit()

    access = _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: PortalSettings(allow_private_storage_space_create=True))
    monkeypatch.setattr(service, "list_storage_spaces", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(service, "_unique_uuid_storage_space_bucket_name", lambda _existing: "restricted-bucket")
    monkeypatch.setattr(service, "create_bucket", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_sync_storage_space_access_projection", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        service,
        "get_storage_space",
        lambda _user, _access, bucket_name: PortalStorageSpace(
            id=bucket_name,
            name="Restricted Research",
            role="Owner",
            visibility="shared",
            share_scope="restricted",
            internal_bucket_name=bucket_name,
        ),
    )

    service.create_storage_space(
        owner,
        access,
        name="Restricted Research",
        visibility="shared",
        share_scope="restricted",
        initial_shares=[
            PortalStorageSpaceInitialShare(user_id=viewer.id, role="Viewer"),
            PortalStorageSpaceInitialShare(user_id=editor.id, role="Editor"),
        ],
    )

    metadata = db_session.query(PortalStorageSpaceMetadata).filter_by(bucket_name="restricted-bucket").one()
    grants = db_session.query(PortalStorageSpaceGrant).filter_by(storage_space_metadata_id=metadata.id).order_by(PortalStorageSpaceGrant.user_id).all()
    assert [(grant.user_id, grant.role) for grant in grants] == [(viewer.id, "Viewer"), (editor.id, "Editor")]


@pytest.mark.parametrize(
    ("shares", "message"),
    [
        (lambda owner, viewer, outsider: [PortalStorageSpaceInitialShare(user_id=owner.id, role="Viewer")], "Only Portal users"),
        (lambda owner, viewer, outsider: [
            PortalStorageSpaceInitialShare(user_id=viewer.id, role="Viewer"),
            PortalStorageSpaceInitialShare(user_id=viewer.id, role="Editor"),
        ], "Duplicate"),
        (lambda owner, viewer, outsider: [PortalStorageSpaceInitialShare(user_id=outsider.id, role="Viewer")], "Only Portal users"),
    ],
)
def test_create_restricted_storage_space_rejects_invalid_initial_shares_before_bucket(monkeypatch, db_session, shares, message):
    account = S3Account(name=f"portal-storage-invalid-initial-{message}", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email=f"owner-invalid-{message}@example.com", hashed_password="x", role="ui_user")
    viewer = User(email=f"viewer-invalid-{message}@example.com", hashed_password="x", role="ui_user")
    outsider = User(email=f"outsider-invalid-{message}@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, viewer, outsider])
    db_session.commit()
    db_session.add(UserS3Account(user_id=viewer.id, account_id=account.id, role=AccountRole.PORTAL_USER.value))
    db_session.commit()

    access = _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: PortalSettings())
    monkeypatch.setattr(service, "list_storage_spaces", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        service,
        "create_bucket",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("Bucket should not be created")),
    )

    with pytest.raises(RuntimeError, match=message):
        service.create_storage_space(
            owner,
            access,
            name="Restricted Research",
            visibility="shared",
            share_scope="restricted",
            initial_shares=shares(owner, viewer, outsider),
        )

    assert db_session.query(PortalStorageSpaceMetadata).filter_by(account_id=account.id).all() == []
    assert db_session.query(PortalStorageSpaceGrant).all() == []


def test_create_restricted_storage_space_rolls_back_bucket_and_grants_when_sync_fails(monkeypatch, db_session):
    account = S3Account(name="portal-storage-initial-rollback", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-initial-rollback@example.com", hashed_password="x", role="ui_user")
    viewer = User(email="viewer-initial-rollback@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, viewer])
    db_session.commit()
    db_session.add(UserS3Account(user_id=viewer.id, account_id=account.id, role=AccountRole.PORTAL_USER.value))
    db_session.commit()

    access = _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    created_buckets: list[str] = []
    deleted_buckets: list[str] = []
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: PortalSettings())
    monkeypatch.setattr(service, "list_storage_spaces", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(service, "_unique_uuid_storage_space_bucket_name", lambda _existing: "rollback-bucket")
    monkeypatch.setattr(service, "create_bucket", lambda _user, _access, bucket_name, **_kwargs: created_buckets.append(bucket_name))
    monkeypatch.setattr(service, "delete_bucket", lambda _user, _access, bucket_name, **_kwargs: deleted_buckets.append(bucket_name))
    monkeypatch.setattr(
        service,
        "_sync_storage_space_access_projection",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("projection failed")),
    )

    with pytest.raises(RuntimeError, match="projection failed"):
        service.create_storage_space(
            owner,
            access,
            name="Rollback Research",
            visibility="shared",
            share_scope="restricted",
            initial_shares=[PortalStorageSpaceInitialShare(user_id=viewer.id, role="Viewer")],
        )

    assert created_buckets == ["rollback-bucket"]
    assert deleted_buckets == ["rollback-bucket"]
    assert db_session.query(PortalStorageSpaceMetadata).filter_by(bucket_name="rollback-bucket").first() is None
    assert db_session.query(PortalStorageSpaceGrant).all() == []


def test_create_storage_space_named_bucket_uses_legacy_slug_and_locks_name(monkeypatch, db_session):
    account = S3Account(name="portal-storage-named", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-named@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    portal_settings = PortalSettings()
    portal_settings.allow_private_storage_space_create = True
    portal_settings.allow_portal_named_bucket_create = True
    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    created_buckets = []
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: portal_settings)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="research-data",
                name="Research Data",
                role="Owner",
                internal_bucket_name="research-data",
            )
        ],
    )
    monkeypatch.setattr(
        service,
        "create_bucket",
        lambda _user, _access, bucket_name, **_kwargs: created_buckets.append(bucket_name),
    )
    monkeypatch.setattr(
        service,
        "get_storage_space",
        lambda _user, _access, bucket_name: PortalStorageSpace(
            id=bucket_name,
            name="Research Data",
            role="Owner",
            internal_bucket_name=bucket_name,
            origin="portal_named",
            name_editable=False,
        ),
    )

    storage_space = service.create_storage_space(user, access, name="Research Data", naming_mode="named_bucket")

    assert created_buckets == ["research-data-2"]
    metadata = (
        db_session.query(PortalStorageSpaceMetadata)
        .filter_by(account_id=account.id, bucket_name="research-data-2")
        .one()
    )
    assert metadata.display_name == "Research Data"
    assert metadata.owner_user_id == user.id
    assert metadata.visibility == "private"
    assert metadata.origin == "portal_named"
    assert metadata.name_editable is False
    assert storage_space.id == "research-data-2"


def test_create_storage_space_named_bucket_requires_effective_setting(monkeypatch, db_session):
    account = S3Account(name="portal-storage-named-disabled", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-named-disabled@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: PortalSettings(allow_private_storage_space_create=True))
    monkeypatch.setattr(service, "list_storage_spaces", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        service,
        "create_bucket",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("Bucket should not be created")),
    )

    with pytest.raises(RuntimeError, match="Named bucket Storage Space creation is not allowed"):
        service.create_storage_space(user, access, name="Research Data", naming_mode="named_bucket")


def test_import_storage_space_uses_existing_bucket_name_and_locks_name(monkeypatch, db_session):
    account = S3Account(name="portal-storage-import", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-import@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    link = AccountIAMUser(user_id=user.id, account_id=account.id, iam_user_id="iam-uid", iam_username="portal-iam")
    projection_calls = []
    monkeypatch.setattr(s3_client, "list_buckets", lambda **_kwargs: [{"name": "existing-bucket"}])
    monkeypatch.setattr(service, "_get_iam_service", lambda _account: object())
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: PortalSettings(allow_private_storage_space_create=True))
    monkeypatch.setattr(service, "_ensure_portal_user", lambda *_args, **_kwargs: (link, IAMUser(name="portal-iam"), False))
    monkeypatch.setattr(service, "_sync_user_group_membership", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_ensure_policy_and_key", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        service,
        "_sync_storage_space_access_projection",
        lambda _account, metadata_arg, **_kwargs: projection_calls.append(metadata_arg.bucket_name),
    )
    monkeypatch.setattr(
        service,
        "get_storage_space",
        lambda _user, _access, bucket_name: PortalStorageSpace(
            id=bucket_name,
            name=bucket_name,
            role="Owner",
            internal_bucket_name=bucket_name,
            origin="imported",
            name_editable=False,
        ),
    )

    storage_space = service.import_storage_space(user, access, bucket_name=" existing-bucket ", description="Imported bucket")

    assert storage_space.id == "existing-bucket"
    assert projection_calls == ["existing-bucket"]
    metadata = (
        db_session.query(PortalStorageSpaceMetadata)
        .filter_by(account_id=account.id, bucket_name="existing-bucket")
        .one()
    )
    assert metadata.display_name == "existing-bucket"
    assert metadata.description == "Imported bucket"
    assert metadata.owner_user_id == user.id
    assert metadata.visibility == "private"
    assert metadata.origin == "imported"
    assert metadata.name_editable is False


def test_import_restricted_storage_space_persists_initial_shares(monkeypatch, db_session):
    account = S3Account(name="portal-storage-import-restricted", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-import-restricted@example.com", hashed_password="x", role="ui_user")
    viewer = User(email="viewer-import-restricted@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, viewer])
    db_session.commit()
    db_session.add(UserS3Account(user_id=viewer.id, account_id=account.id, role=AccountRole.PORTAL_USER.value))
    db_session.commit()

    access = _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    link = AccountIAMUser(user_id=owner.id, account_id=account.id, iam_user_id="iam-uid", iam_username="portal-iam")
    monkeypatch.setattr(s3_client, "list_buckets", lambda **_kwargs: [{"name": "existing-restricted"}])
    monkeypatch.setattr(service, "_get_iam_service", lambda _account: object())
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: PortalSettings())
    monkeypatch.setattr(service, "_ensure_portal_user", lambda *_args, **_kwargs: (link, IAMUser(name="portal-iam"), False))
    monkeypatch.setattr(service, "_sync_user_group_membership", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_ensure_policy_and_key", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_sync_storage_space_access_projection", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        service,
        "get_storage_space",
        lambda _user, _access, bucket_name: PortalStorageSpace(
            id=bucket_name,
            name=bucket_name,
            role="Owner",
            visibility="shared",
            share_scope="restricted",
            internal_bucket_name=bucket_name,
            origin="imported",
            name_editable=False,
        ),
    )

    service.import_storage_space(
        owner,
        access,
        bucket_name="existing-restricted",
        visibility="shared",
        share_scope="restricted",
        initial_shares=[PortalStorageSpaceInitialShare(user_id=viewer.id, role="Editor")],
    )

    metadata = db_session.query(PortalStorageSpaceMetadata).filter_by(bucket_name="existing-restricted").one()
    grant = db_session.query(PortalStorageSpaceGrant).filter_by(storage_space_metadata_id=metadata.id, user_id=viewer.id).one()
    assert metadata.visibility == "shared"
    assert metadata.share_scope == "restricted"
    assert grant.role == "Editor"


def test_update_storage_space_locked_names_reject_rename_but_accept_description(monkeypatch, db_session):
    origin = "imported"
    account = S3Account(name=f"portal-storage-update-{origin}", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email=f"portal-storage-update-{origin}@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name=f"{origin}-bucket",
        display_name=f"{origin.title()} Bucket",
        description="Initial",
        owner_user_id=user.id,
        origin=origin,
        name_editable=False,
    )
    db_session.add(metadata)
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_resolve_storage_space_bucket_name", lambda *_args, **_kwargs: f"{origin}-bucket")
    monkeypatch.setattr(
        service,
        "get_storage_space",
        lambda _user, _access, bucket_name: PortalStorageSpace(
            id=bucket_name,
            name=metadata.display_name or bucket_name,
            role="Owner",
            description=metadata.description,
            internal_bucket_name=bucket_name,
            origin=origin,
            name_editable=False,
        ),
    )

    updated = service.update_storage_space(user, access, f"{origin}-bucket", description="Updated description")

    assert updated.description == "Updated description"
    assert metadata.description == "Updated description"
    with pytest.raises(RuntimeError, match="cannot be changed"):
        service.update_storage_space(user, access, f"{origin}-bucket", name="Renamed")


def test_update_storage_space_allows_rename_when_name_is_editable(monkeypatch, db_session):
    account = S3Account(name="portal-storage-update-editable", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-update-editable@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="uuid-bucket",
        display_name="Original Name",
        owner_user_id=user.id,
        origin="portal_generic",
        name_editable=True,
    )
    db_session.add(metadata)
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_resolve_storage_space_bucket_name", lambda *_args, **_kwargs: "uuid-bucket")
    monkeypatch.setattr(
        service,
        "get_storage_space",
        lambda _user, _access, bucket_name: PortalStorageSpace(
            id=bucket_name,
            name=metadata.display_name or bucket_name,
            role="Owner",
            internal_bucket_name=bucket_name,
            origin="portal_generic",
            name_editable=True,
        ),
    )

    updated = service.update_storage_space(user, access, "uuid-bucket", name="Renamed Space")

    assert updated.name == "Renamed Space"
    assert metadata.display_name == "Renamed Space"


def test_update_storage_space_restores_archived_space_without_deleting_links(monkeypatch, db_session):
    account = S3Account(name="portal-storage-restore", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="portal-storage-restore@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner])
    db_session.commit()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="restore-data",
        display_name="Restore Data",
        visibility="shared",
        archived_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    public_link = PortalPublicLink(
        token="restore-link-token",
        account_id=account.id,
        bucket_name="restore-data",
        object_key="report.csv",
        created_by_user_id=owner.id,
        created_by_email=owner.email,
        created_at=utcnow(),
    )
    db_session.add_all([metadata, public_link])
    db_session.commit()

    access = _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    sync_archived_values = []
    monkeypatch.setattr(service, "_resolve_storage_space_bucket_name", lambda *_args, **_kwargs: "restore-data")
    monkeypatch.setattr(service, "list_existing_user_storage_space_access", lambda *_args, **_kwargs: {"restore-data": "Owner"})
    monkeypatch.setattr(
        service,
        "_sync_storage_space_access_projection",
        lambda _account, metadata_arg, **_kwargs: sync_archived_values.append(metadata_arg.archived_at),
    )
    monkeypatch.setattr(
        service,
        "get_storage_space",
        lambda _user, _access, bucket_name: PortalStorageSpace(
            id=bucket_name,
            name=metadata.display_name or bucket_name,
            role="Owner",
            internal_bucket_name=bucket_name,
            visibility=metadata.visibility,
            archived_at=metadata.archived_at,
        ),
    )

    restored = service.update_storage_space(owner, access, "restore-data", archived=False)

    assert restored.archived_at is None
    assert metadata.archived_at is None
    assert sync_archived_values == [None]
    assert db_session.query(PortalPublicLink).filter_by(token="restore-link-token").one().revoked_at is None


def test_portal_account_override_uses_canonical_payload(monkeypatch, db_session):
    account = S3Account(
        name="portal-storage-override",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
        portal_settings_override=json.dumps(
            {
                "allow_private_storage_space_create": False,
            }
        ),
    )
    db_session.add(account)
    db_session.commit()

    base = PortalSettings()
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_portal_settings", lambda: base)
    monkeypatch.setattr(
        s3_client,
        "put_bucket_lifecycle",
        lambda *args, **kwargs: pytest.fail("Account overrides must not update existing bucket lifecycles"),
    )

    effective = service.get_effective_portal_settings(account)
    assert effective.allow_private_storage_space_create is False
    assert effective.allow_portal_named_bucket_create is False
    assert effective.allow_portal_user_access_key_create is True
    assert effective.server_access_logging_enabled is True
    assert effective.storage_space_version_cleanup_enabled is True
    assert effective.bucket_defaults.enable_cors is True

    account_settings = service.get_portal_account_settings(account).model_dump(exclude_unset=True)
    assert account_settings["admin_override"]["allow_private_storage_space_create"] is False
    assert "portal_manager_override" not in account_settings
    assert "override_policy" not in account_settings

    service.update_admin_portal_settings_override(
        account,
        PortalSettingsOverride(
            allow_private_storage_space_create=True,
            server_access_logging_enabled=False,
            storage_space_version_cleanup_enabled=False,
            bucket_defaults={
                "enable_cors": False,
                "noncurrent_version_expiration_days": 45,
            },
        ),
    )
    db_session.refresh(account)
    stored = json.loads(account.portal_settings_override)
    assert stored == {
        "allow_private_storage_space_create": True,
        "server_access_logging_enabled": False,
        "storage_space_version_cleanup_enabled": False,
        "bucket_defaults": {
            "enable_cors": False,
            "noncurrent_version_expiration_days": 45,
        },
    }
    assert service.get_effective_portal_settings(account).bucket_defaults.enable_cors is False
    assert service.get_effective_portal_settings(account).bucket_defaults.noncurrent_version_expiration_days == 45
    assert service.get_effective_portal_settings(account).server_access_logging_enabled is False
    assert service.get_effective_portal_settings(account).storage_space_version_cleanup_enabled is False


def test_portal_server_access_log_bucket_policy_preserves_existing_statements(db_session):
    account = S3Account(
        name="portal-log-policy",
        rgw_account_id="rgw-policy-account",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    manager = User(email="log-manager@example.test", hashed_password="x", role="ui_user")
    db_session.add_all([account, manager])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(
                user_id=manager.id,
                account_id=account.id,
                role=AccountRole.PORTAL_MANAGER.value,
            ),
            AccountIAMUser(
                user_id=manager.id,
                account_id=account.id,
                iam_user_id="arn:aws:iam::rgw-policy-account:user/portal-manager-1",
                iam_username="portal-manager-1",
            ),
        ]
    )
    db_session.commit()

    service = PortalService(db_session)
    bucket_name = service._portal_server_access_log_bucket_name(account)
    policy = service._portal_server_access_log_policy(
        account,
        bucket_name,
        {
            "Version": "2012-10-17",
            "Statement": [
                {"Sid": "KeepMe", "Effect": "Allow", "Principal": "*", "Action": "s3:GetObject", "Resource": "*"},
                {"Sid": "S3ManagerPortalServerAccessLogging", "Effect": "Deny", "Principal": "*", "Action": "s3:*"},
            ],
        },
    )

    assert bucket_name.startswith(f"s3m-portal-access-logs-{account.id}-")
    expected_hash = hashlib.sha256(f"{account.rgw_account_id}{account.name}".encode("utf-8")).hexdigest()[:8]
    assert bucket_name == f"s3m-portal-access-logs-{account.id}-{expected_hash}"
    statements = {statement["Sid"]: statement for statement in policy["Statement"]}
    assert "KeepMe" in statements
    managed = statements["S3ManagerPortalServerAccessLogging"]
    assert managed["Principal"] == {"Service": "logging.s3.amazonaws.com"}
    assert managed["Action"] == "s3:PutObject"
    assert managed["Resource"] == f"arn:aws:s3:::{bucket_name}/portal-server-access/*"
    assert managed["Condition"]["StringEquals"] == {"aws:SourceAccount": "rgw-policy-account"}
    assert managed["Condition"]["ArnLike"] == {"aws:SourceArn": "arn:aws:s3:::*"}
    manager_deny = statements["S3ManagerPortalManagerDeny"]
    assert manager_deny["Effect"] == "Deny"
    assert manager_deny["Action"] == "s3:*"
    assert manager_deny["Resource"] == [
        f"arn:aws:s3:::{bucket_name}",
        f"arn:aws:s3:::{bucket_name}/*",
    ]
    assert manager_deny["Principal"]["AWS"] == [
        "arn:aws:iam:::user/portal-manager-1",
        "arn:aws:iam::rgw-policy-account:user/portal-manager-1",
    ]


def test_portal_server_access_log_bucket_policy_removes_manager_deny_when_no_manager_remains(db_session):
    account = S3Account(name="portal-log-policy-user", rgw_account_id="rgw-policy-user")
    db_session.add(account)
    db_session.commit()
    service = PortalService(db_session)
    bucket_name = service._portal_server_access_log_bucket_name(account)

    policy = service._portal_server_access_log_policy(
        account,
        bucket_name,
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "S3ManagerPortalManagerDeny",
                    "Effect": "Deny",
                    "Principal": {"AWS": ["arn:aws:iam::rgw-policy-user:user/former-manager"]},
                    "Action": "s3:*",
                    "Resource": [f"arn:aws:s3:::{bucket_name}", f"arn:aws:s3:::{bucket_name}/*"],
                }
            ],
        },
    )

    assert not any(statement.get("Sid") == "S3ManagerPortalManagerDeny" for statement in policy["Statement"])


def test_portal_server_access_log_bucket_creation_sets_retention_lifecycle(monkeypatch, db_session):
    account = S3Account(
        name="portal-log-retention",
        rgw_account_id="rgw-log-retention",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    db_session.add(account)
    db_session.commit()

    service = PortalService(db_session)
    created_buckets = []
    lifecycle_calls = []

    class _MissingBucketClient:
        def head_bucket(self, **_kwargs):
            raise ClientError({"Error": {"Code": "NoSuchBucket"}}, "HeadBucket")

    monkeypatch.setattr(service, "_portal_server_access_client", lambda _account: _MissingBucketClient())
    monkeypatch.setattr(
        s3_client,
        "create_bucket",
        lambda name, **kwargs: created_buckets.append((name, kwargs)),
    )
    monkeypatch.setattr(
        s3_client,
        "put_bucket_lifecycle",
        lambda name, **kwargs: lifecycle_calls.append((name, kwargs)),
    )

    log_bucket = service._ensure_portal_server_access_log_bucket(
        account,
        portal_settings=PortalSettings(server_access_log_retention_days=45),
    )

    assert log_bucket == service._portal_server_access_log_bucket_name(account)
    assert created_buckets == [
        (
            log_bucket,
            {
                "access_key": "ROOT-AK",
                "secret_key": "ROOT-SK",
                "endpoint": None,
                "region": None,
                "force_path_style": False,
                "verify_tls": True,
            },
        )
    ]
    assert lifecycle_calls == [
        (
            log_bucket,
            {
                "rules": [
                    {
                        "ID": "ExpirePortalServerAccessLogs",
                        "Status": "Enabled",
                        "Prefix": "portal-server-access/",
                        "Expiration": {"Days": 45},
                    }
                ],
                "access_key": "ROOT-AK",
                "secret_key": "ROOT-SK",
                "endpoint": None,
                "region": None,
                "force_path_style": False,
                "verify_tls": True,
            },
        )
    ]


def test_portal_server_access_log_existing_bucket_keeps_retention_unchanged(monkeypatch, db_session):
    account = S3Account(
        name="portal-log-retention-existing",
        rgw_account_id="rgw-log-retention-existing",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    db_session.add(account)
    db_session.commit()

    service = PortalService(db_session)

    class _ExistingBucketClient:
        def head_bucket(self, **_kwargs):
            return {}

    monkeypatch.setattr(service, "_portal_server_access_client", lambda _account: _ExistingBucketClient())
    monkeypatch.setattr(
        s3_client,
        "create_bucket",
        lambda *args, **kwargs: pytest.fail("Bucket should already exist"),
    )
    monkeypatch.setattr(
        s3_client,
        "put_bucket_lifecycle",
        lambda *args, **kwargs: pytest.fail("Existing access log buckets should not be migrated"),
    )

    log_bucket = service._ensure_portal_server_access_log_bucket(
        account,
        portal_settings=PortalSettings(server_access_log_retention_days=45),
    )

    assert log_bucket == service._portal_server_access_log_bucket_name(account)


def test_portal_server_access_logs_parse_standard_records_and_filter_mode(monkeypatch, db_session):
    account = S3Account(
        name="portal-log-read",
        rgw_account_id="rgw-log-read",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    user = User(email="portal-log-read@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="research-data",
        display_name="Research Data",
        owner_user_id=user.id,
        visibility="private",
    )
    db_session.add(metadata)
    db_session.commit()

    log_key = "portal-server-access/research-data/2026-07-08-10-30-00-0000000001 ABCDEF"
    log_body = "\n".join(
        [
            'owner research-data [08/Jul/2026:10:30:00 +0000] 10.0.0.5 external req-1 REST.PUT.OBJECT reports/external.csv "PUT /research-data/reports/external.csv HTTP/1.1" 200 - 512 512 - 3 - "aws-cli/2" - - SigV4 TLS_AES AuthHeader s3.example TLSv1.3 - -',
            'owner research-data [08/Jul/2026:10:35:00 +0000] 10.0.0.6 external req-2 REST.DELETE.OBJECT reports/old.csv "DELETE /research-data/reports/old.csv HTTP/1.1" 204 - - 128 - 4 - "aws-cli/2" - - SigV4 TLS_AES AuthHeader s3.example TLSv1.3 - -',
            'owner research-data [08/Jul/2026:10:40:00 +0000] 10.0.0.7 external req-3 REST.POST.OBJECT captures s3-manager/maquette/manager_dashboard.png "POST /research-data HTTP/1.1" 204 - 1254754 1252241 - 101ms http://localhost:5173/ "Safari" - - SigV4 TLS_AES AuthHeader s3.example TLSv1.3 - -',
            'owner research-data [09/Jul/2026:00:10:00 +0000] 10.0.0.8 external req-4 REST.GET.OBJECT reports/tomorrow.csv "GET /research-data/reports/tomorrow.csv HTTP/1.1" 200 - 64 64 - 3 - "aws-cli/2" - - SigV4 TLS_AES AuthHeader s3.example TLSv1.3 - -',
        ]
    )

    class _Body:
        def read(self):
            return log_body.encode("utf-8")

    class _Client:
        def __init__(self):
            self.prefixes = []

        def list_objects_v2(self, **kwargs):
            self.prefixes.append(kwargs["Prefix"])
            return {"Contents": [{"Key": log_key}]}

        def get_object(self, **kwargs):
            assert kwargs["Bucket"] == service._portal_server_access_log_bucket_name(account)
            assert kwargs["Key"] == log_key
            return {"Body": _Body()}

    service = PortalService(db_session)
    client = _Client()
    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    monkeypatch.setattr(service, "_portal_server_access_client", lambda _account: client)

    transfers = service.list_portal_server_access_logs(user, access, date="2026-07-08", mode="transfers")
    operations = service.list_portal_server_access_logs(user, access, date="2026-07-08", mode="operations")
    page = service.list_portal_server_access_log_page(
        user,
        access,
        date="2026-07-08",
        mode="operations",
        limit=1,
        offset=1,
    )
    filtered_page = service.list_portal_server_access_log_page(
        user,
        access,
        date="2026-07-08",
        mode="operations",
        limit=10,
        offset=0,
        advanced_filter=PortalServerAccessLogFilterQuery(
            rules=[
                PortalServerAccessLogFilterRule(field="action", op="eq", value="upload"),
                PortalServerAccessLogFilterRule(field="path", op="contains", value="maquette"),
            ]
        ),
    )
    raw_logs = service.get_portal_server_access_logs_raw(
        user,
        access,
        date_from="2026-07-08",
        date_to="2026-07-08",
    )

    assert client.prefixes
    assert [entry.operation for entry in transfers] == ["REST.POST.OBJECT", "REST.PUT.OBJECT"]
    assert len(operations) == 3
    assert transfers[0].direction == "Upload"
    assert transfers[0].object_key == "captures/s3-manager/maquette/manager_dashboard.png"
    assert transfers[0].request_uri == "POST /research-data HTTP/1.1"
    assert transfers[1].operation == "REST.PUT.OBJECT"
    assert transfers[1].object_key == "reports/external.csv"
    assert transfers[1].object_size == 512
    assert transfers[1].requester == "external"
    assert transfers[1].client_ip == "10.0.0.5"
    assert transfers[1].auth_type == "AuthHeader"
    assert operations[1].operation_category == "delete"
    assert page.total == 3
    assert page.limit == 1
    assert page.offset == 1
    assert len(page.entries) == 1
    assert page.entries[0].operation_category == "delete"
    assert filtered_page.total == 1
    assert filtered_page.entries[0].operation == "REST.POST.OBJECT"
    assert "REST.POST.OBJECT captures s3-manager/maquette/manager_dashboard.png" in raw_logs
    assert "reports/tomorrow.csv" not in raw_logs


def test_portal_server_access_logs_require_portal_manager(db_session):
    account = S3Account(name="portal-log-denied", rgw_account_id="rgw-log-denied")
    user = User(email="portal-log-denied@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value)
    service = PortalService(db_session)

    with pytest.raises(RuntimeError, match="Only project managers"):
        service.list_portal_server_access_logs(user, access, date="2026-07-08")
    with pytest.raises(RuntimeError, match="Only project managers"):
        service.list_portal_server_access_log_page(user, access, date="2026-07-08")
    with pytest.raises(RuntimeError, match="Only project managers"):
        service.get_portal_server_access_logs_raw(
            user,
            access,
            date_from="2026-07-08",
            date_to="2026-07-08",
        )
def test_portal_server_access_logs_resolve_requester_identities(monkeypatch, db_session):
    account = S3Account(
        name="portal-log-identities",
        rgw_account_id="rgw-log-identities",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    actor = User(email="actor-log-identities@example.com", hashed_password="x", role="ui_user")
    portal_user = User(
        email="portal.identity@example.com",
        display_name="Portal Identity",
        hashed_password="x",
        role="ui_user",
    )
    db_session.add_all([account, actor, portal_user])
    db_session.commit()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="research-data",
        display_name="Research Data",
        owner_user_id=actor.id,
        visibility="private",
    )
    db_session.add(metadata)
    db_session.flush()
    db_session.add_all(
        [
            AccountIAMUser(
                user_id=portal_user.id,
                account_id=account.id,
                iam_user_id="portal-iam-id",
                iam_username="portal-user-iam",
                active_access_key="PORTALKEY123456",
            ),
            PortalExternalAccessCredential(
                account_id=account.id,
                storage_space_metadata_id=metadata.id,
                bucket_name="research-data",
                created_by_user_id=actor.id,
                external_email="partner@example.org",
                permission="read_write",
                iam_user_id="external-iam-id",
                iam_username="portal-ext-partner",
                access_key_id="EXTKEY123456",
                status="Active",
            ),
        ]
    )
    db_session.commit()

    log_key = "portal-server-access/research-data/2026-07-08-10-30-00-0000000001 ABCDEF"
    log_body = "\n".join(
        [
            'owner research-data [08/Jul/2026:10:30:00 +0000] 10.0.0.5 external-iam-id req-1 REST.PUT.OBJECT reports/external.csv "PUT /research-data/reports/external.csv HTTP/1.1" 200 - 512 512 - 3 - "aws-cli/2" - - SigV4 TLS_AES AuthHeader s3.example TLSv1.3 - -',
            'owner research-data [08/Jul/2026:10:31:00 +0000] 10.0.0.6 portal-iam-id req-2 REST.GET.OBJECT reports/portal.csv "GET /research-data/reports/portal.csv HTTP/1.1" 200 - 64 64 - 4 - "aws-cli/2" - - SigV4 TLS_AES AuthHeader s3.example TLSv1.3 - -',
            'owner research-data [08/Jul/2026:10:32:00 +0000] 10.0.0.7 cfb56965-6240-4335-85c4-0850c8e7ab23 req-3 REST.DELETE.OBJECT reports/rgw.csv "DELETE /research-data/reports/rgw.csv HTTP/1.1" 204 - - 32 - 5 - "aws-cli/2" - - SigV4 TLS_AES AuthHeader s3.example TLSv1.3 - -',
            'owner research-data [08/Jul/2026:10:33:00 +0000] 10.0.0.8 cfb56965-6240-4335-85c4-0850c8e7ab23 req-4 REST.HEAD.OBJECT reports/rgw.csv "HEAD /research-data/reports/rgw.csv HTTP/1.1" 200 - - 32 - 5 - "aws-cli/2" - - SigV4 TLS_AES AuthHeader s3.example TLSv1.3 - -',
            'owner research-data [08/Jul/2026:10:34:00 +0000] 10.0.0.9 unknown-rgw-uid req-5 REST.GET.OBJECT reports/unknown.csv "GET /research-data/reports/unknown.csv HTTP/1.1" 200 - 64 64 - 6 - "aws-cli/2" - - SigV4 TLS_AES AuthHeader s3.example TLSv1.3 - -',
        ]
    )

    class _Body:
        def read(self):
            return log_body.encode("utf-8")

    class _Client:
        def list_objects_v2(self, **_kwargs):
            return {"Contents": [{"Key": log_key}]}

        def get_object(self, **_kwargs):
            return {"Body": _Body()}

    class _Admin:
        def __init__(self):
            self.calls: list[str] = []

        def get_user(self, uid, allow_not_found=False):
            self.calls.append(uid)
            assert allow_not_found is True
            if uid == "cfb56965-6240-4335-85c4-0850c8e7ab23":
                return {"user_id": uid, "account_id": account.rgw_account_id, "display_name": "portal-6-1"}
            return None

    service = PortalService(db_session)
    admin = _Admin()
    access = _portal_access(account, actor, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    monkeypatch.setattr(service, "_portal_server_access_client", lambda _account: _Client())
    monkeypatch.setattr(service, "_portal_server_access_rgw_admin_client", lambda _account: admin)

    page = service.list_portal_server_access_log_page(actor, access, date="2026-07-08", mode="operations", limit=10)
    identities = {entry.requester: entry.requester_identity for entry in page.entries}

    assert identities["external-iam-id"].kind == "external_access"
    assert identities["external-iam-id"].label == "partner@example.org"
    assert identities["external-iam-id"].iam_username == "portal-ext-partner"
    assert identities["external-iam-id"].access_key_id == "EXTKEY123456"
    assert identities["portal-iam-id"].kind == "portal_user"
    assert identities["portal-iam-id"].label == "portal-user-iam"
    assert identities["portal-iam-id"].email == "portal.identity@example.com"
    assert identities["cfb56965-6240-4335-85c4-0850c8e7ab23"].kind == "rgw_user"
    assert identities["cfb56965-6240-4335-85c4-0850c8e7ab23"].label == "portal-6-1"
    assert identities["cfb56965-6240-4335-85c4-0850c8e7ab23"].access_key_id is None
    assert identities["unknown-rgw-uid"].kind == "unknown"
    assert identities["unknown-rgw-uid"].resolved is False
    assert admin.calls.count("cfb56965-6240-4335-85c4-0850c8e7ab23") == 1
    assert admin.calls.count("unknown-rgw-uid") == 1
    assert "external-iam-id" not in admin.calls
    assert "portal-iam-id" not in admin.calls
    identity_filtered_page = service.list_portal_server_access_log_page(
        actor,
        access,
        date="2026-07-08",
        mode="operations",
        limit=10,
        advanced_filter=PortalServerAccessLogFilterQuery(
            rules=[PortalServerAccessLogFilterRule(field="identity", op="contains", value="portal-6-1")]
        ),
    )
    assert identity_filtered_page.total == 2
    assert {entry.requester for entry in identity_filtered_page.entries} == {"cfb56965-6240-4335-85c4-0850c8e7ab23"}


def test_reconcile_portal_server_access_logging_enables_and_disables_managed_buckets(monkeypatch, db_session):
    account = S3Account(
        name="portal-log-reconcile",
        rgw_account_id="rgw-log-reconcile",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    db_session.add(account)
    db_session.commit()
    db_session.add_all(
        [
            PortalStorageSpaceMetadata(account_id=account.id, bucket_name="space-a", display_name="Space A", visibility="shared"),
            PortalStorageSpaceMetadata(account_id=account.id, bucket_name="space-b", display_name="Space B", visibility="shared"),
        ]
    )
    db_session.commit()

    service = PortalService(db_session)
    enabled_calls = []
    disabled_calls = []
    monkeypatch.setattr(service, "_portal_server_access_logging_account_ready", lambda _account: True)
    monkeypatch.setattr(service, "_ensure_portal_server_access_log_bucket", lambda _account, **_kwargs: "technical-logs")
    monkeypatch.setattr(service, "_ensure_portal_server_access_log_bucket_policy", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        service,
        "_put_portal_server_access_logging",
        lambda _account, source_bucket, log_bucket: enabled_calls.append((source_bucket, log_bucket)),
    )
    monkeypatch.setattr(
        service,
        "_delete_managed_portal_server_access_logging",
        lambda _account, source_bucket: disabled_calls.append(source_bucket) or True,
    )

    enabled = service.reconcile_portal_server_access_logging(
        account,
        portal_settings=PortalSettings(server_access_logging_enabled=True),
    )
    disabled = service.reconcile_portal_server_access_logging(
        account,
        portal_settings=PortalSettings(server_access_logging_enabled=False),
    )

    assert enabled == {"enabled": 2, "disabled": 0, "skipped": 0}
    assert sorted(enabled_calls) == [("space-a", "technical-logs"), ("space-b", "technical-logs")]
    assert disabled == {"enabled": 0, "disabled": 2, "skipped": 0}
    assert sorted(disabled_calls) == ["space-a", "space-b"]


def test_portal_object_client_uses_existing_portal_credentials(monkeypatch, db_session):
    account = S3Account(name="portal-object-credentials", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-object-credentials@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    db_session.add(
        AccountIAMUser(
            user_id=user.id,
            account_id=account.id,
            iam_user_id="iam-uid",
            iam_username="portal-iam",
            active_access_key="AK-PORTAL",
            active_secret_key="SK-PORTAL",
        )
    )
    db_session.commit()

    captured = {}
    monkeypatch.setattr(
        "app.services.portal_service.resolve_s3_client_options",
        lambda acc: ("https://s3.example.test", "eu-west-3", True, False),
    )

    def fake_get_s3_client(access_key, secret_key, **kwargs):
        captured["access_key"] = access_key
        captured["secret_key"] = secret_key
        captured["kwargs"] = kwargs
        return object()

    monkeypatch.setattr("app.services.portal_service.get_s3_client", fake_get_s3_client)

    client = PortalService(db_session)._portal_object_client(user, account)

    assert client is not None
    assert captured == {
        "access_key": "AK-PORTAL",
        "secret_key": "SK-PORTAL",
        "kwargs": {
            "endpoint": "https://s3.example.test",
            "region": "eu-west-3",
            "force_path_style": True,
            "verify_tls": False,
        },
    }


def test_storage_space_role_matrix_for_files_shares_and_portal_settings(monkeypatch, db_session):
    account = S3Account(name="portal-role-matrix", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    actor = User(email="matrix-actor@example.com", hashed_password="x", role="ui_user")
    target = User(email="matrix-target@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, actor, target])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(user_id=target.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            AccountIAMUser(user_id=target.id, account_id=account.id, iam_user_id="iam-target", iam_username=f"iam-{target.id}"),
        ]
    )
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="bucket-research-data",
        display_name="Research Data",
        visibility="shared",
    )
    db_session.add(metadata)
    db_session.flush()
    actor_grant = PortalStorageSpaceGrant(
        storage_space_metadata_id=metadata.id,
        user_id=actor.id,
        role="Viewer",
    )
    db_session.add(actor_grant)
    db_session.commit()

    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="research-data",
                name="Research Data",
                role=actor_grant.role,
                internal_bucket_name="bucket-research-data",
            )
        ],
    )

    class FakeBody:
        def iter_chunks(self, chunk_size):  # noqa: ARG002
            return iter([b"content"])

    class FakeClient:
        def __init__(self):
            self.uploads = 0
            self.puts = 0
            self.deletes = 0

        def list_objects_v2(self, **kwargs):  # noqa: ARG002
            return {"Contents": [], "CommonPrefixes": [], "IsTruncated": False}

        def get_object(self, **kwargs):  # noqa: ARG002
            return {"Body": FakeBody(), "ContentType": "text/plain"}

        def upload_fileobj(self, *args, **kwargs):  # noqa: ARG002
            self.uploads += 1

        def put_object(self, **kwargs):  # noqa: ARG002
            self.puts += 1

        def delete_object(self, **kwargs):  # noqa: ARG002
            self.deletes += 1

    fake_client = FakeClient()
    monkeypatch.setattr(service, "_portal_object_client", lambda *_args, **_kwargs: fake_client)

    class FakeIAMService:
        def __init__(self):
            self.policies = {}

        def get_user_inline_policy(self, username, policy_name):
            return self.policies.get((username, policy_name))

        def put_user_inline_policy(self, username, policy_name, policy_document):
            self.policies[(username, policy_name)] = policy_document

        def delete_user_inline_policy(self, username, policy_name):
            self.policies.pop((username, policy_name), None)

    iam_service = FakeIAMService()
    monkeypatch.setattr(service, "_get_iam_service", lambda _account: iam_service)
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: PortalSettings())
    monkeypatch.setattr(
        service,
        "_ensure_portal_user",
        lambda target_user, scoped_account, _iam_service: (
            AccountIAMUser(
                user_id=target_user.id,
                account_id=scoped_account.id,
                iam_user_id=f"iam-{target_user.id}",
                iam_username=f"iam-{target_user.id}",
            ),
            IAMUser(name=f"iam-{target_user.id}", arn=f"arn:aws:iam:::user/iam-{target_user.id}"),
            False,
        ),
    )
    monkeypatch.setattr(service, "_sync_user_group_membership", lambda *_args, **_kwargs: None)
    access = _portal_access(account, actor, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)

    def assert_file_capabilities(role, *, can_write: bool, can_share: bool):
        actor_grant.role = role
        db_session.add(actor_grant)
        db_session.commit()

        stream, content_type, filename = service.download_storage_space_object(actor, access, "research-data", "raw-data/file.txt")

        assert list(stream) == [b"content"]
        assert content_type == "text/plain"
        assert filename == "file.txt"

        if can_write:
            service.delete_storage_space_object(actor, access, "research-data", "raw-data/file.txt")
        else:
            with pytest.raises(RuntimeError, match="Delete not allowed"):
                service.delete_storage_space_object(actor, access, "research-data", "raw-data/file.txt")

        assert can_share is False
        with pytest.raises(RuntimeError, match="Full management access required"):
            service.set_storage_space_share(actor, access, target, "research-data", "Viewer")

    assert_file_capabilities("Viewer", can_write=False, can_share=False)
    assert_file_capabilities("Editor", can_write=True, can_share=False)
    manager_access = _portal_access(account, actor, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    share = service.set_storage_space_share(actor, manager_access, target, "research-data", "Viewer")
    assert share.email == target.email
    target_grant = (
        db_session.query(PortalStorageSpaceGrant)
        .filter_by(storage_space_metadata_id=metadata.id, user_id=target.id)
        .one()
    )
    assert target_grant.role == "Viewer"
    target_policy = iam_service.policies[(f"iam-{target.id}", service._bucket_access_policy_name)]
    assert service._extract_storage_space_access(target_policy) == {"bucket-research-data": "Viewer"}
    assert ("GET", "/portal/settings") in {
        (method, route.path)
        for route in portal_router.router.routes
        for method in getattr(route, "methods", set())
    }


def test_object_detail_and_delete_use_safe_portal_operations(monkeypatch, db_session):
    account = S3Account(name="portal-object-detail", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-object-detail@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="bucket-research-data",
            display_name="Research Data",
            visibility="shared",
        )
    )
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_user_storage_space_content_role", lambda *_args, **_kwargs: "Editor")
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="research-data",
                name="Research Data",
                role="Editor",
                internal_bucket_name="bucket-research-data",
            )
        ],
    )

    class FakeBody:
        def read(self):
            return b"hello preview"

    class FakeClient:
        def __init__(self):
            self.deletes = []

        def head_object(self, **kwargs):
            assert kwargs == {"Bucket": "bucket-research-data", "Key": "raw-data/readme.txt"}
            return {
                "ContentLength": 13,
                "ContentType": "text/plain",
                "LastModified": datetime(2026, 5, 27, 8, 15, tzinfo=timezone.utc),
                "StorageClass": "STANDARD",
                "ServerSideEncryption": "AES256",
            }

        def get_object(self, **kwargs):
            assert kwargs == {
                "Bucket": "bucket-research-data",
                "Key": "raw-data/readme.txt",
                "Range": "bytes=0-65535",
            }
            return {"Body": FakeBody()}

        def delete_object(self, **kwargs):
            self.deletes.append(kwargs)

    fake_client = FakeClient()
    monkeypatch.setattr(service, "_portal_object_client", lambda *_args, **_kwargs: fake_client)

    detail = service.get_storage_space_object_detail(user, access, "research-data", "/raw-data/readme.txt")
    deleted_key = service.delete_storage_space_object(user, access, "research-data", "/raw-data/old.txt")

    assert detail.content_type == "text/plain"
    assert detail.storage_class == "STANDARD"
    assert detail.encryption == "AES256"
    assert detail.preview_type == "text"
    assert detail.preview_text == "hello preview"
    assert deleted_key == "raw-data/old.txt"
    assert fake_client.deletes == [{"Bucket": "bucket-research-data", "Key": "raw-data/old.txt"}]


def test_portal_object_history_lists_versions_and_delete_markers(monkeypatch, db_session):
    account = S3Account(name="portal-object-history")
    user = User(email="history@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_resolve_storage_space_bucket_name", lambda *_args: "history-bucket")
    monkeypatch.setattr(service, "_require_storage_space_content_role", lambda *_args: "Editor")

    class FakeClient:
        def get_bucket_versioning(self, **kwargs):
            assert kwargs == {"Bucket": "history-bucket"}
            return {"Status": "Enabled"}

        def list_object_versions(self, **kwargs):
            assert kwargs == {
                "Bucket": "history-bucket",
                "Prefix": "folder/report.txt",
                "MaxKeys": 1000,
            }
            return {
                "Versions": [
                    {
                        "Key": "folder/report.txt",
                        "VersionId": "v2",
                        "IsLatest": True,
                        "LastModified": datetime(2026, 7, 29, 12, 0, tzinfo=timezone.utc),
                        "Size": 20,
                    },
                    {
                        "Key": "folder/report.txt",
                        "VersionId": "v1",
                        "LastModified": datetime(2026, 7, 27, 12, 0, tzinfo=timezone.utc),
                        "Size": 10,
                    },
                ],
                "DeleteMarkers": [
                    {
                        "Key": "folder/report.txt",
                        "VersionId": "d1",
                        "LastModified": datetime(2026, 7, 28, 12, 0, tzinfo=timezone.utc),
                    }
                ],
                "IsTruncated": False,
            }

    monkeypatch.setattr(service, "_portal_object_client", lambda *_args, **_kwargs: FakeClient())

    result = service.get_storage_space_object_versions(
        user,
        access,
        "research-data",
        "/folder/report.txt",
    )

    assert result.versioning_status == "Enabled"
    assert result.can_restore is True
    assert [entry.version_id for entry in result.versions] == ["v2", "d1", "v1"]
    assert result.versions[1].is_delete_marker is True


def test_portal_trash_lists_only_current_delete_markers(monkeypatch, db_session):
    account = S3Account(name="portal-trash")
    user = User(email="trash@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_resolve_storage_space_bucket_name", lambda *_args: "trash-bucket")
    monkeypatch.setattr(service, "_require_storage_space_content_role", lambda *_args: "Viewer")

    class FakeClient:
        def get_bucket_versioning(self, **_kwargs):
            return {"Status": "Suspended"}

        def list_object_versions(self, **kwargs):
            assert kwargs == {"Bucket": "trash-bucket", "MaxKeys": 1000}
            return {
                "Versions": [
                    {
                        "Key": "folder/deleted.txt",
                        "VersionId": "v1",
                        "LastModified": datetime(2026, 7, 27, 12, 0, tzinfo=timezone.utc),
                        "Size": 14,
                    }
                ],
                "DeleteMarkers": [
                    {
                        "Key": "folder/deleted.txt",
                        "VersionId": "d2",
                        "IsLatest": True,
                        "LastModified": datetime(2026, 7, 29, 12, 0, tzinfo=timezone.utc),
                    },
                    {
                        "Key": "folder/restored.txt",
                        "VersionId": "d1",
                        "IsLatest": False,
                        "LastModified": datetime(2026, 7, 28, 12, 0, tzinfo=timezone.utc),
                    },
                ],
            }

    monkeypatch.setattr(service, "_portal_object_client", lambda *_args, **_kwargs: FakeClient())

    result = service.list_storage_space_trash(user, access, "research-data")

    assert result.versioning_status == "Suspended"
    assert result.can_restore is False
    assert len(result.items) == 1
    assert result.items[0].key == "folder/deleted.txt"
    assert result.items[0].previous_version_id == "v1"
    assert result.items[0].size == 14


def test_portal_restore_deleted_object_creates_new_current_version(monkeypatch, db_session):
    account = S3Account(name="portal-trash-restore")
    user = User(email="trash-restore@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_resolve_storage_space_bucket_name", lambda *_args: "trash-bucket")
    monkeypatch.setattr(service, "_require_storage_space_content_role", lambda *_args: "Editor")

    class FakeClient:
        def __init__(self):
            self.head_calls = []
            self.copy_calls = []

        def get_bucket_versioning(self, **_kwargs):
            return {"Status": "Enabled"}

        def list_object_versions(self, **kwargs):
            assert kwargs == {
                "Bucket": "trash-bucket",
                "Prefix": "folder/deleted.txt",
                "MaxKeys": 1000,
            }
            return {
                "Versions": [
                    {
                        "Key": "folder/deleted.txt",
                        "VersionId": "v7",
                        "LastModified": datetime(2026, 7, 28, 12, 0, tzinfo=timezone.utc),
                    }
                ],
                "DeleteMarkers": [
                    {
                        "Key": "folder/deleted.txt",
                        "VersionId": "d8",
                        "IsLatest": True,
                        "LastModified": datetime(2026, 7, 29, 12, 0, tzinfo=timezone.utc),
                    }
                ],
            }

        def head_object(self, **kwargs):
            self.head_calls.append(kwargs)
            return {"ContentLength": 12}

        def copy_object(self, **kwargs):
            self.copy_calls.append(kwargs)
            return {"VersionId": "v9"}

    client = FakeClient()
    monkeypatch.setattr(service, "_portal_object_client", lambda *_args, **_kwargs: client)

    result = service.restore_storage_space_object_version(
        user,
        access,
        "research-data",
        "/folder/deleted.txt",
    )

    assert result.restored_from_version_id == "v7"
    assert client.head_calls == [
        {
            "Bucket": "trash-bucket",
            "Key": "folder/deleted.txt",
            "VersionId": "v7",
        }
    ]
    assert client.copy_calls == [
        {
            "Bucket": "trash-bucket",
            "Key": "folder/deleted.txt",
            "CopySource": {
                "Bucket": "trash-bucket",
                "Key": "folder/deleted.txt",
                "VersionId": "v7",
            },
        }
    ]


def test_portal_restore_deleted_prefix_paginates_and_reports_partial_failures(
    monkeypatch,
    db_session,
):
    service = PortalService(db_session)

    class FakeClient:
        def __init__(self):
            self.list_calls = []

        def list_object_versions(self, **kwargs):
            self.list_calls.append(kwargs)
            if len(self.list_calls) == 1:
                return {
                    "Versions": [
                        {"Key": "reports/good.txt", "VersionId": "v2"},
                        {"Key": "reports/good.txt", "VersionId": "v1"},
                        {"Key": "reports/not-deleted.txt", "VersionId": "v3"},
                    ],
                    "DeleteMarkers": [
                        {
                            "Key": "reports/good.txt",
                            "VersionId": "d2",
                            "IsLatest": True,
                        },
                        {
                            "Key": "reports/old-marker.txt",
                            "VersionId": "d1",
                            "IsLatest": False,
                        },
                    ],
                    "IsTruncated": True,
                    "NextKeyMarker": "reports/good.txt",
                    "NextVersionIdMarker": "v1",
                }
            return {
                "Versions": [
                    {"Key": "reports/broken.txt", "VersionId": "v4"},
                ],
                "DeleteMarkers": [
                    {
                        "Key": "reports/broken.txt",
                        "VersionId": "d4",
                        "IsLatest": True,
                    }
                ],
                "IsTruncated": False,
            }

    client = FakeClient()
    restored: list[tuple[str, str]] = []

    def fake_restore(
        _client,
        _bucket_name,
        key,
        version_id,
        *,
        space_id,
    ):
        assert space_id == "research-data"
        if key == "reports/broken.txt":
            raise RuntimeError("copy failed")
        restored.append((key, version_id))

    monkeypatch.setattr(
        service,
        "_restore_storage_space_object_version_with_client",
        fake_restore,
    )
    progress = []
    result = service.run_deleted_prefix_restore(
        PortalDeletedPrefixRestoreTarget(
            client=client,
            bucket_name="trash-bucket",
            storage_space_id="research-data",
            storage_space_name="Research Data",
            prefix="reports/",
        ),
        progress_callback=progress.append,
    )

    assert client.list_calls == [
        {
            "Bucket": "trash-bucket",
            "Prefix": "reports/",
            "MaxKeys": 1000,
        },
        {
            "Bucket": "trash-bucket",
            "Prefix": "reports/",
            "MaxKeys": 1000,
            "KeyMarker": "reports/good.txt",
            "VersionIdMarker": "v1",
        },
    ]
    assert restored == [("reports/good.txt", "v2")]
    assert result.status == "partial"
    assert result.restore_candidates == 2
    assert result.restored_objects == 1
    assert result.failed_objects == 1
    assert result.failures[0].key == "reports/broken.txt"
    assert progress[-1].stage == "completed"
    assert progress[-1].total_candidates_final is True


def test_portal_restore_deleted_prefix_can_cancel_during_listing(db_session):
    service = PortalService(db_session)

    class FakeClient:
        def list_object_versions(self, **_kwargs):
            return {
                "Versions": [
                    {"Key": "reports/deleted.txt", "VersionId": "v1"},
                ],
                "DeleteMarkers": [
                    {
                        "Key": "reports/deleted.txt",
                        "VersionId": "d1",
                        "IsLatest": True,
                    }
                ],
                "IsTruncated": True,
                "NextKeyMarker": "reports/deleted.txt",
                "NextVersionIdMarker": "v1",
            }

    checks = 0

    def cancel_after_first_page():
        nonlocal checks
        checks += 1
        if checks > 1:
            raise BucketPurgeCancelled()

    with pytest.raises(BucketPurgeCancelled):
        service.run_deleted_prefix_restore(
            PortalDeletedPrefixRestoreTarget(
                client=FakeClient(),
                bucket_name="trash-bucket",
                storage_space_id="research-data",
                storage_space_name="Research Data",
                prefix="reports/",
            ),
            cancel_check=cancel_after_first_page,
        )

    assert checks == 2


def test_portal_viewer_cannot_restore_object_version(monkeypatch, db_session):
    account = S3Account(name="portal-history-viewer")
    user = User(email="history-viewer@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_resolve_storage_space_bucket_name", lambda *_args: "history-bucket")
    monkeypatch.setattr(service, "_require_storage_space_content_role", lambda *_args: "Viewer")

    with pytest.raises(RuntimeError, match="Restore not allowed"):
        service.restore_storage_space_object_version(
            user,
            access,
            "research-data",
            "folder/report.txt",
            version_id="v1",
        )


def test_storage_space_share_roles_are_translated_to_iam_policy(db_session):
    service = PortalService(db_session)

    class FakeIAMService:
        def __init__(self):
            self.policies = {}
            self.deleted = []

        def get_user_inline_policy(self, username, policy_name):
            return self.policies.get((username, policy_name))

        def put_user_inline_policy(self, username, policy_name, policy_document):
            self.policies[(username, policy_name)] = policy_document

        def delete_user_inline_policy(self, username, policy_name):
            self.deleted.append((username, policy_name))
            self.policies.pop((username, policy_name), None)

    iam = FakeIAMService()

    service._sync_user_storage_space_policy_projection(iam, "portal-iam", {"research-data": "Viewer"})
    policy = iam.policies[("portal-iam", service._bucket_access_policy_name)]
    access = service._extract_storage_space_access(policy)

    assert access == {"research-data": "Viewer"}
    viewer_statement = next(stmt for stmt in policy["Statement"] if stmt["Sid"] == "PortalStorageSpaceViewer")
    assert {
        "s3:GetBucketLocation",
        "s3:GetBucketVersioning",
        "s3:ListBucket",
        "s3:GetObject",
    }.issubset(viewer_statement["Action"])

    service._sync_user_storage_space_policy_projection(iam, "portal-iam", {"research-data": "Editor"})
    policy = iam.policies[("portal-iam", service._bucket_access_policy_name)]
    access = service._extract_storage_space_access(policy)

    assert access == {"research-data": "Editor"}
    assert not any(stmt["Sid"] == "PortalStorageSpaceViewer" for stmt in policy["Statement"])
    editor_statement = next(stmt for stmt in policy["Statement"] if stmt["Sid"] == "PortalStorageSpaceEditor")
    assert "s3:PutObject" in editor_statement["Action"]
    assert "s3:DeleteObject" in editor_statement["Action"]

    service._sync_user_storage_space_policy_projection(iam, "portal-iam", {"research-data": "Owner"})
    policy = iam.policies[("portal-iam", service._bucket_access_policy_name)]
    access = service._extract_storage_space_access(policy)

    assert access == {"research-data": "Owner"}
    owner_statement = next(stmt for stmt in policy["Statement"] if stmt["Sid"] == "PortalStorageSpaceOwner")
    assert "s3:*" not in owner_statement["Action"]
    assert {"s3:PutObject", "s3:DeleteObject", "s3:GetBucketPolicy"}.issubset(owner_statement["Action"])


def test_list_storage_space_shares_uses_db_grants(monkeypatch, db_session):
    account = S3Account(name="portal-share-list", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner@example.com", hashed_password="x", role="ui_user")
    viewer = User(email="viewer@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, viewer])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(user_id=owner.id, account_id=account.id, role=AccountRole.PORTAL_MANAGER.value),
            UserS3Account(user_id=viewer.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
        ]
    )
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="research-data",
        display_name="Research Data",
        visibility="shared",
    )
    db_session.add(metadata)
    db_session.flush()
    db_session.add(
        PortalStorageSpaceGrant(
            storage_space_metadata_id=metadata.id,
            user_id=viewer.id,
            role="Viewer",
            created_by_user_id=owner.id,
        )
    )
    db_session.commit()

    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="research-data",
                name="Research Data",
                role="Owner",
                internal_bucket_name="research-data",
            )
        ],
    )
    owner_access = _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    viewer_access = _portal_access(account, viewer, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)

    owner_shares = service.list_storage_space_shares(owner, owner_access, "research-data")
    viewer_shares = service.list_storage_space_shares(viewer, viewer_access, "research-data")

    assert [(share.email, share.role, share.direction) for share in owner_shares] == [
        ("viewer@example.com", "Viewer", "by_me"),
    ]
    assert [(share.email, share.role, share.direction) for share in viewer_shares] == [
        ("viewer@example.com", "Viewer", "with_me"),
    ]


def test_account_scope_storage_space_grants_dynamic_member_access(db_session):
    account = S3Account(name="portal-account-scope", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-account-scope@example.com", hashed_password="x", role="ui_user")
    member = User(email="member-account-scope@example.com", hashed_password="x", role="ui_user")
    manager = User(email="manager-account-scope@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, member, manager])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(user_id=member.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            UserS3Account(user_id=manager.id, account_id=account.id, role=AccountRole.PORTAL_MANAGER.value),
        ]
    )
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="team-data",
        display_name="Team Data",
        visibility="shared",
        share_scope="account",
        account_member_role="Viewer",
    )
    db_session.add(metadata)
    db_session.commit()

    service = PortalService(db_session)

    assert service.list_existing_user_storage_space_content_access(
        member,
        account,
        AccountRole.PORTAL_USER.value,
    ) == {"team-data": "Viewer"}
    assert service.list_existing_user_storage_space_content_access(
        manager,
        account,
        AccountRole.PORTAL_MANAGER.value,
    ) == {"team-data": "Manager"}

    db_session.add(
        PortalStorageSpaceGrant(
            storage_space_metadata_id=metadata.id,
            user_id=member.id,
            role="Editor",
            created_by_user_id=owner.id,
        )
    )
    db_session.commit()

    assert service.list_existing_user_storage_space_content_access(
        member,
        account,
        AccountRole.PORTAL_USER.value,
    ) == {"team-data": "Editor"}


def test_storage_space_share_candidates_use_effective_portal_members(monkeypatch, db_session):
    account = S3Account(name="portal-share-candidates", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-candidates@example.com", hashed_password="x", role="ui_user")
    direct = User(email="direct-candidates@example.com", hashed_password="x", role="ui_user")
    grouped = User(email="grouped-candidates@example.com", hashed_password="x", role="ui_user")
    outsider = User(email="outsider-candidates@example.com", hashed_password="x", role="ui_user")
    group = UiGroup(name="Portal group")
    db_session.add_all([account, owner, direct, grouped, outsider, group])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(user_id=owner.id, account_id=account.id, role=AccountRole.PORTAL_MANAGER.value),
            UserS3Account(user_id=direct.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            UiGroupS3Account(group_id=group.id, account_id=account.id, role=AccountRole.PORTAL_MANAGER.value),
            UserUiGroup(user_id=grouped.id, group_id=group.id),
        ]
    )
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="research-data",
        display_name="Research Data",
        visibility="shared",
    )
    db_session.add(metadata)
    db_session.flush()
    db_session.add(
        PortalStorageSpaceGrant(
            storage_space_metadata_id=metadata.id,
            user_id=direct.id,
            role="Viewer",
            created_by_user_id=owner.id,
        )
    )
    db_session.commit()

    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="research-data",
                name="Research Data",
                role="Owner",
                internal_bucket_name="research-data",
            )
        ],
    )
    owner_access = _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    candidates = service.list_storage_space_share_candidates(owner, owner_access, "research-data")

    assert [(candidate.email, candidate.account_role, candidate.access_source, candidate.already_shared) for candidate in candidates] == [
        ("direct-candidates@example.com", "portal_user", "direct", True),
    ]
    assert all(candidate.email != outsider.email for candidate in candidates)


def test_portal_collaborators_summarize_effective_members_and_visible_external_access(monkeypatch, db_session):
    now = utcnow()
    account = S3Account(name="portal-collaborators", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    actor = User(email="actor-collab@example.com", display_name="Actor", hashed_password="x", role="ui_user")
    direct = User(email="direct-collab@example.com", display_name="Direct", hashed_password="x", role="ui_user")
    grouped = User(email="grouped-collab@example.com", display_name="Grouped", hashed_password="x", role="ui_user")
    promoted = User(email="promoted-collab@example.com", display_name="Promoted", hashed_password="x", role="ui_user")
    inactive = User(email="inactive-collab@example.com", hashed_password="x", role="ui_user", is_active=False)
    group = UiGroup(name="Portal collaborator group")
    manager_group = UiGroup(name="Portal collaborator managers")
    db_session.add_all([account, actor, direct, grouped, promoted, inactive, group, manager_group])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(
                user_id=actor.id,
                account_id=account.id,
                role=AccountRole.PORTAL_MANAGER.value,
                created_at=now - timedelta(days=40),
            ),
            UserS3Account(
                user_id=direct.id,
                account_id=account.id,
                role=AccountRole.PORTAL_USER.value,
                created_at=now - timedelta(days=35),
            ),
            UserS3Account(
                user_id=promoted.id,
                account_id=account.id,
                role=AccountRole.PORTAL_USER.value,
                created_at=now - timedelta(days=35),
            ),
            UserS3Account(
                user_id=inactive.id,
                account_id=account.id,
                role=AccountRole.PORTAL_USER.value,
                created_at=now - timedelta(days=35),
            ),
            UiGroupS3Account(
                group_id=group.id,
                account_id=account.id,
                role=AccountRole.PORTAL_USER.value,
                created_at=now - timedelta(days=20),
            ),
            UiGroupS3Account(
                group_id=manager_group.id,
                account_id=account.id,
                role=AccountRole.PORTAL_MANAGER.value,
                created_at=now - timedelta(days=40),
            ),
            UserUiGroup(user_id=grouped.id, group_id=group.id, created_at=now - timedelta(days=10)),
            UserUiGroup(user_id=promoted.id, group_id=manager_group.id, created_at=now - timedelta(days=34)),
        ]
    )
    visible_metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="visible-data",
        display_name="Visible Data",
        visibility="shared",
    )
    hidden_metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="hidden-data",
        display_name="Hidden Data",
        visibility="shared",
    )
    db_session.add_all([visible_metadata, hidden_metadata])
    db_session.flush()
    db_session.add_all(
        [
            PortalExternalAccessCredential(
                account_id=account.id,
                storage_space_metadata_id=visible_metadata.id,
                bucket_name="visible-data",
                created_by_user_id=actor.id,
                external_email="partner@example.org",
                permission="read_only",
                iam_username="portal-ext-visible",
                access_key_id="AK-VISIBLE",
                status="Active",
            ),
            PortalExternalAccessCredential(
                account_id=account.id,
                storage_space_metadata_id=hidden_metadata.id,
                bucket_name="hidden-data",
                created_by_user_id=actor.id,
                external_email="hidden@example.org",
                permission="read_only",
                iam_username="portal-ext-hidden",
                access_key_id="AK-HIDDEN",
                status="Active",
            ),
            PortalExternalAccessCredential(
                account_id=account.id,
                storage_space_metadata_id=visible_metadata.id,
                bucket_name="visible-data",
                created_by_user_id=actor.id,
                external_email="revoked@example.org",
                permission="read_only",
                iam_username="portal-ext-revoked",
                access_key_id="AK-REVOKED",
                status="Active",
                revoked_at=now,
            ),
            PortalExternalAccessCredential(
                account_id=account.id,
                storage_space_metadata_id=visible_metadata.id,
                bucket_name="visible-data",
                created_by_user_id=actor.id,
                external_email="inactive-key@example.org",
                permission="read_only",
                iam_username="portal-ext-inactive",
                access_key_id="AK-INACTIVE",
                status="Inactive",
            ),
        ]
    )
    db_session.commit()

    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="visible-data",
                name="Visible Data",
                role="Owner",
                internal_bucket_name="visible-data",
            )
        ],
    )
    access = _portal_access(account, actor, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    result = service.list_portal_collaborators(actor, access)

    assert result.summary.collaborator_count == 4
    assert result.summary.external_access_key_count == 1
    assert result.summary.trend is not None
    assert result.summary.trend.window == "month"
    assert result.summary.trend.collaborator_count == 3
    assert [(item.email, item.account_role, item.access_source) for item in result.collaborators] == [
        ("actor-collab@example.com", "portal_manager", "direct"),
        ("direct-collab@example.com", "portal_user", "direct"),
        ("grouped-collab@example.com", "portal_user", "group"),
        ("promoted-collab@example.com", "portal_manager", "direct_and_group"),
    ]
    grouped_row = next(item for item in result.collaborators if item.email == "grouped-collab@example.com")
    assert grouped_row.member_since is not None
    assert grouped_row.member_since.date() == (now - timedelta(days=10)).date()


def test_portal_collaborator_access_review_reports_effective_sources_and_revoke_scope(db_session):
    account = S3Account(name="portal-access-review", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    other_account = S3Account(name="portal-access-review-other", rgw_access_key="OTHER-AK", rgw_secret_key="OTHER-SK")
    manager = User(email="manager-review@example.com", display_name="Manager", hashed_password="x", role="ui_user")
    member = User(email="member-review@example.com", display_name="Member", hashed_password="x", role="ui_user")
    outsider = User(email="outsider-review@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, other_account, manager, member, outsider])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(user_id=manager.id, account_id=account.id, role=AccountRole.PORTAL_MANAGER.value),
            UserS3Account(user_id=member.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            UserS3Account(user_id=outsider.id, account_id=other_account.id, role=AccountRole.PORTAL_USER.value),
        ]
    )
    owned = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="owned-space",
        display_name="Alpha owned",
        owner_user_id=member.id,
        visibility="private",
    )
    direct = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="direct-space",
        display_name="Beta direct",
        visibility="shared",
        share_scope="restricted",
    )
    team = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="team-space",
        display_name="Gamma team",
        visibility="shared",
        share_scope="account",
        account_member_role="Viewer",
    )
    hidden = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="hidden-space",
        display_name="Hidden private",
        owner_user_id=manager.id,
        visibility="private",
    )
    archived = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="archived-space",
        display_name="Archived direct",
        visibility="shared",
        share_scope="restricted",
        archived_at=utcnow(),
    )
    other_space = PortalStorageSpaceMetadata(
        account_id=other_account.id,
        bucket_name="other-space",
        display_name="Other project",
        visibility="shared",
        share_scope="restricted",
    )
    db_session.add_all([owned, direct, team, hidden, archived, other_space])
    db_session.flush()
    db_session.add_all(
        [
            PortalStorageSpaceGrant(storage_space_metadata_id=direct.id, user_id=member.id, role="Editor"),
            PortalStorageSpaceGrant(storage_space_metadata_id=team.id, user_id=member.id, role="Editor"),
            PortalStorageSpaceGrant(storage_space_metadata_id=archived.id, user_id=member.id, role="Viewer"),
            PortalStorageSpaceGrant(storage_space_metadata_id=other_space.id, user_id=member.id, role="Viewer"),
        ]
    )
    db_session.commit()

    service = PortalService(db_session)
    manager_access = _portal_access(account, manager, role=AccountRole.PORTAL_MANAGER.value)

    result = service.get_portal_collaborator_access_review(manager, manager_access, member.id)

    assert result.collaborator.email == "member-review@example.com"
    assert result.collaborator.can_review_access is True
    assert result.can_request_project_removal is True
    assert [
        (item.storage_space_name, item.role, item.source, item.can_revoke)
        for item in result.space_accesses
    ] == [
        ("Alpha owned", "Owner", "owner", False),
        ("Beta direct", "Editor", "direct", True),
        ("Gamma team", "Viewer", "team", False),
    ]

    manager_result = service.get_portal_collaborator_access_review(manager, manager_access, manager.id)
    manager_sources = {item.storage_space_id: (item.role, item.source, item.can_revoke) for item in manager_result.space_accesses}
    assert manager_sources["direct-space"] == ("Manager", "project_manager", False)
    assert manager_sources["hidden-space"] == ("Owner", "owner", False)
    assert "archived-space" not in manager_sources
    assert "other-space" not in manager_sources


def test_portal_collaborator_access_review_authorizes_manager_or_self_and_isolates_projects(db_session):
    account = S3Account(name="portal-access-review-auth", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    other_account = S3Account(name="portal-access-review-auth-other", rgw_access_key="OTHER-AK", rgw_secret_key="OTHER-SK")
    manager = User(email="manager-review-auth@example.com", hashed_password="x", role="ui_user")
    member = User(email="member-review-auth@example.com", hashed_password="x", role="ui_user")
    peer = User(email="peer-review-auth@example.com", hashed_password="x", role="ui_user")
    outsider = User(email="outsider-review-auth@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, other_account, manager, member, peer, outsider])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(user_id=manager.id, account_id=account.id, role=AccountRole.PORTAL_MANAGER.value),
            UserS3Account(user_id=member.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            UserS3Account(user_id=peer.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            UserS3Account(user_id=outsider.id, account_id=other_account.id, role=AccountRole.PORTAL_USER.value),
        ]
    )
    space = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="member-direct-space",
        display_name="Member direct",
        visibility="shared",
        share_scope="restricted",
    )
    db_session.add(space)
    db_session.flush()
    db_session.add(PortalStorageSpaceGrant(storage_space_metadata_id=space.id, user_id=member.id, role="Viewer"))
    db_session.commit()

    service = PortalService(db_session)
    member_access = _portal_access(account, member)
    self_result = service.get_portal_collaborator_access_review(member, member_access, member.id)
    assert self_result.space_accesses[0].can_revoke is False
    assert self_result.can_request_project_removal is False

    with pytest.raises(RuntimeError, match="not allowed"):
        service.get_portal_collaborator_access_review(member, member_access, peer.id)
    with pytest.raises(RuntimeError, match="not found"):
        service.get_portal_collaborator_access_review(manager, _portal_access(account, manager, AccountRole.PORTAL_MANAGER.value), outsider.id)

    manager_rows = service.list_portal_collaborators(
        manager,
        _portal_access(account, manager, AccountRole.PORTAL_MANAGER.value),
    ).collaborators
    assert all(item.can_review_access for item in manager_rows)
    member_rows = service.list_portal_collaborators(member, member_access).collaborators
    assert [item.user_id for item in member_rows if item.can_review_access] == [member.id]


def test_storage_space_access_summary_reflects_modes_counts_and_manager_access(monkeypatch, db_session):
    account = S3Account(name="portal-access-summary", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-access-summary@example.com", display_name="Owner Summary", hashed_password="x", role="ui_user")
    member = User(email="member-access-summary@example.com", hashed_password="x", role="ui_user")
    manager = User(email="manager-access-summary@example.com", hashed_password="x", role="ui_user")
    outsider = User(email="outsider-access-summary@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, member, manager, outsider])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(user_id=member.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            UserS3Account(user_id=manager.id, account_id=account.id, role=AccountRole.PORTAL_MANAGER.value),
        ]
    )
    private_metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="private-data",
        display_name="Private Data",
        owner_user_id=owner.id,
        visibility="private",
    )
    all_metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="all-data",
        display_name="All Data",
        visibility="shared",
        share_scope="account",
        account_member_role="Viewer",
    )
    restricted_metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="restricted-data",
        display_name="Restricted Data",
        visibility="shared",
        share_scope="restricted",
    )
    archived_metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="archived-data",
        display_name="Archived Data",
        visibility="shared",
        share_scope="restricted",
        archived_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    db_session.add_all([private_metadata, all_metadata, restricted_metadata, archived_metadata])
    db_session.flush()
    db_session.add_all(
        [
            PortalStorageSpaceGrant(storage_space_metadata_id=restricted_metadata.id, user_id=member.id, role="Editor"),
            PortalPublicLink(
                token="summary-token",
                account_id=account.id,
                bucket_name="restricted-data",
                object_key="report.csv",
                label="report.csv",
                created_by_user_id=owner.id,
                created_by_email=owner.email,
            ),
        ]
    )
    db_session.commit()

    service = PortalService(db_session)

    def fake_list_storage_spaces(_user, _access, include_archived=False, **_kwargs):
        rows = [
            ("private-data", "Private Data"),
            ("all-data", "All Data"),
            ("restricted-data", "Restricted Data"),
            ("archived-data", "Archived Data"),
        ]
        return [
            PortalStorageSpaceSummary(
                id=bucket_name,
                name=display_name,
                role="Manager",
                internal_bucket_name=bucket_name,
            )
            for bucket_name, display_name in rows
            if include_archived or bucket_name != "archived-data"
        ]

    monkeypatch.setattr(service, "list_storage_spaces", fake_list_storage_spaces)
    monkeypatch.setattr(service, "_user_storage_space_content_role", lambda *_args, **_kwargs: "Owner")
    owner_access = _portal_access(account, owner, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    manager_access = _portal_access(account, manager, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    private_summary = service.get_storage_space_access_summary(owner, owner_access, "private-data")
    all_summary = service.get_storage_space_access_summary(manager, manager_access, "all-data")
    restricted_summary = service.get_storage_space_access_summary(manager, manager_access, "restricted-data")
    archived_summary = service.get_storage_space_access_summary(manager, manager_access, "archived-data")
    manager_summary = service.get_storage_space_access_summary(manager, manager_access, "restricted-data")

    assert private_summary.mode == "private"
    assert private_summary.effective_member_count == 2
    assert private_summary.owner.email == owner.email
    assert private_summary.can_manage_access is False

    assert all_summary.mode == "all"
    assert all_summary.default_account_member_role == "Viewer"
    assert all_summary.effective_member_count == 2
    assert all_summary.owner is None

    assert restricted_summary.mode == "restricted"
    assert restricted_summary.effective_member_count == 2
    assert [(share.email, share.role) for share in restricted_summary.explicit_shares] == [(member.email, "Editor")]
    assert restricted_summary.public_link_count == 1
    assert restricted_summary.can_create_public_links is True

    assert archived_summary.mode == "restricted"
    assert archived_summary.effective_member_count == 0
    assert archived_summary.can_manage_access is False

    assert manager_summary.can_manage_access is True
    assert manager_summary.owner is None


def test_set_storage_space_share_requires_existing_portal_member(monkeypatch, db_session):
    account = S3Account(name="portal-share-member-required", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-member-required@example.com", hashed_password="x", role="ui_user")
    target = User(email="target-member-required@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, target])
    db_session.commit()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="research-data",
        display_name="Research Data",
        visibility="shared",
    )
    db_session.add(metadata)
    db_session.commit()

    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="research-data",
                name="Research Data",
                role="Owner",
                internal_bucket_name="research-data",
            )
        ],
    )
    owner_access = _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    with pytest.raises(RuntimeError, match="Only Portal users"):
        service.set_storage_space_share(owner, owner_access, target, "research-data", "Viewer")

    assert db_session.query(PortalStorageSpaceGrant).filter_by(storage_space_metadata_id=metadata.id).all() == []
    assert db_session.query(UserS3Account).filter_by(user_id=target.id, account_id=account.id).first() is None


def test_set_storage_space_share_rolls_back_db_grant_when_projection_fails(monkeypatch, db_session):
    account = S3Account(name="portal-share-rollback", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-rollback@example.com", hashed_password="x", role="ui_user")
    target = User(email="target-rollback@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, target])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(user_id=target.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            AccountIAMUser(user_id=target.id, account_id=account.id, iam_user_id="target-iam", iam_username="target-iam"),
        ]
    )
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="research-data",
        display_name="Research Data",
        visibility="shared",
    )
    db_session.add(metadata)
    db_session.commit()

    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="research-data",
                name="Research Data",
                role="Owner",
                internal_bucket_name="research-data",
            )
        ],
    )
    monkeypatch.setattr(service, "_sync_user_group_membership", lambda *_args, **_kwargs: None)

    class FailingIAMService:
        def get_user(self, username):
            return IAMUser(name=username, arn=f"arn:aws:iam:::user/{username}")

        def get_user_inline_policy(self, username, policy_name):  # noqa: ARG002
            return None

        def put_user_inline_policy(self, username, policy_name, policy_document):  # noqa: ARG002
            raise RuntimeError("projection failed")

    monkeypatch.setattr(service, "_get_iam_service", lambda _account: FailingIAMService())
    owner_access = _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    with pytest.raises(RuntimeError, match="projection failed"):
        service.set_storage_space_share(owner, owner_access, target, "research-data", "Viewer")

    assert db_session.query(PortalStorageSpaceGrant).filter_by(storage_space_metadata_id=metadata.id).all() == []


def test_storage_space_share_mutations_resync_bucket_policy(monkeypatch, db_session):
    account = S3Account(name="portal-share-policy-sync", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-policy-sync@example.com", hashed_password="x", role="ui_user")
    target = User(email="target-policy-sync@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, target])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(user_id=target.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            AccountIAMUser(user_id=target.id, account_id=account.id, iam_user_id="target-iam", iam_username="target-iam"),
        ]
    )
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="research-data",
        display_name="Research Data",
        visibility="shared",
        share_scope="restricted",
    )
    db_session.add(metadata)
    db_session.commit()

    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="research-data",
                name="Research Data",
                role="Owner",
                internal_bucket_name="research-data",
            )
        ],
    )
    monkeypatch.setattr(service, "_sync_user_group_membership", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_sync_user_storage_space_projection", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_get_iam_service", lambda _account: object())
    projection_syncs = []
    monkeypatch.setattr(
        service,
        "_sync_storage_space_access_projection",
        lambda account_arg, metadata_arg, **kwargs: projection_syncs.append(
            (account_arg.id, metadata_arg.bucket_name, metadata_arg.id, kwargs.get("extra_user_ids"))
        ),
    )
    owner_access = _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    service.set_storage_space_share(owner, owner_access, target, "research-data", "Viewer")
    service.revoke_storage_space_share(owner, owner_access, target, "research-data")

    assert projection_syncs == [
        (account.id, "research-data", metadata.id, {target.id}),
        (account.id, "research-data", metadata.id, {target.id}),
    ]


def test_public_links_are_scoped_expirable_and_revocable(monkeypatch, db_session):
    account = S3Account(name="portal-public-links", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-public@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner])
    db_session.commit()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="research-data",
            display_name="Research Data",
            visibility="shared",
        )
    )
    db_session.commit()

    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="research-data",
                name="Research Data",
                role="Owner",
                internal_bucket_name="research-data",
            )
        ],
    )
    access = _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    class FakeClient:
        def __init__(self):
            self.head_calls = []

        def head_object(self, **kwargs):
            self.head_calls.append(kwargs)
            return {"ContentLength": 1024}

    fake_client = FakeClient()
    monkeypatch.setattr(service, "_portal_object_client", lambda *_args, **_kwargs: fake_client)

    link = service.create_storage_space_public_link(
        owner,
        access,
        "research-data",
        object_key="/raw-data/report.csv",
        label="Report",
        expires_at=utcnow() + timedelta(days=1),
    )
    links = service.list_storage_space_public_links(owner, access, "research-data")
    revoked = service.revoke_storage_space_public_link(owner, access, "research-data", link.id)

    assert link.object_key == "raw-data/report.csv"
    assert link.object_name == "report.csv"
    assert link.status == "Active"
    assert link.url.startswith("/api/portal/public-links/")
    assert [(item.id, item.status) for item in links] == [(link.id, "Active")]
    assert [(item.id, item.status) for item in revoked] == [(link.id, "Revoked")]
    assert fake_client.head_calls == [{"Bucket": "research-data", "Key": "raw-data/report.csv"}]

    with pytest.raises(RuntimeError, match="expiration must be in the future"):
        service.create_storage_space_public_link(
            owner,
            access,
            "research-data",
            object_key="raw-data/old-report.csv",
            expires_at=utcnow() - timedelta(seconds=1),
        )


def test_public_link_creation_rejects_missing_objects(monkeypatch, db_session):
    account = S3Account(name="portal-public-link-missing-object", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-public-missing@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner])
    db_session.commit()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="research-data",
            display_name="Research Data",
            visibility="shared",
        )
    )
    db_session.commit()

    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="research-data",
                name="Research Data",
                role="Owner",
                internal_bucket_name="research-data",
            )
        ],
    )
    access = _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    class FakeClient:
        def head_object(self, **_kwargs):
            raise ClientError(
                {
                    "Error": {"Code": "NoSuchKey", "Message": "Not found"},
                    "ResponseMetadata": {"HTTPStatusCode": 404},
                },
                "HeadObject",
            )

    monkeypatch.setattr(service, "_portal_object_client", lambda *_args, **_kwargs: FakeClient())

    with pytest.raises(RuntimeError, match="Object 'raw-data/missing.csv' not found"):
        service.create_storage_space_public_link(
            owner,
            access,
            "research-data",
            object_key="raw-data/missing.csv",
            expires_at=utcnow() + timedelta(days=1),
        )

    assert db_session.query(PortalPublicLink).count() == 0


def test_private_storage_space_blocks_new_shares_and_public_links(monkeypatch, db_session):
    account = S3Account(name="portal-private-share", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-private-share@example.com", hashed_password="x", role="ui_user")
    target = User(email="target-private-share@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, target])
    db_session.commit()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="private-data",
        display_name="Private Data",
        owner_user_id=owner.id,
        visibility="private",
    )
    db_session.add(metadata)
    db_session.flush()
    db_session.add(
        PortalStorageSpaceGrant(
            storage_space_metadata_id=metadata.id,
            user_id=target.id,
            role="Viewer",
            created_by_user_id=owner.id,
        )
    )
    db_session.commit()

    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="private-data",
                name="Private Data",
                role="Owner",
                internal_bucket_name="private-data",
                visibility="private",
            )
        ],
    )
    access = _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    assert service.list_storage_space_shares(owner, access, "private-data") == []
    with pytest.raises(RuntimeError, match="Private storage spaces cannot be shared"):
        service.set_storage_space_share(owner, access, target, "private-data", "Viewer")
    with pytest.raises(RuntimeError, match="Private storage spaces cannot be shared"):
        service.create_storage_space_public_link(owner, access, "private-data", object_key="report.csv")


def test_archived_storage_space_suspends_public_link_download(db_session):
    account = S3Account(name="portal-archived-link", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-archived-link@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner])
    db_session.commit()
    db_session.add_all(
        [
            PortalStorageSpaceMetadata(
                account_id=account.id,
                bucket_name="archived-data",
                display_name="Archived Data",
                visibility="shared",
                archived_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            ),
            PortalPublicLink(
                token="archived-token",
                account_id=account.id,
                bucket_name="archived-data",
                object_key="report.csv",
                created_by_user_id=owner.id,
                created_by_email=owner.email,
                created_at=utcnow(),
            ),
        ]
    )
    db_session.commit()

    service = PortalService(db_session)

    with pytest.raises(RuntimeError, match="archived"):
        service.download_public_link("archived-token")


def test_portal_activity_and_transfers_are_filtered_by_visible_storage_spaces(monkeypatch, db_session):
    account = S3Account(name="portal-activity", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="activity@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    db_session.add_all(
        [
            AuditLog(
                user_id=user.id,
                user_email=user.email,
                user_role=user.role,
                scope="portal",
                action="upload_object",
                entity_type="object",
                entity_id="raw-data/report.csv",
                account_id=account.id,
                account_name=account.name,
                status="success",
                metadata_json=json.dumps({"storage_space_id": "research-data", "size_bytes": 42}),
                ip_address="192.0.2.10",
            ),
            AuditLog(
                user_id=user.id,
                user_email=user.email,
                user_role=user.role,
                scope="portal",
                action="download_object",
                entity_type="object",
                entity_id="secret.txt",
                account_id=account.id,
                account_name=account.name,
                status="success",
                metadata_json=json.dumps({"storage_space_id": "hidden-data"}),
            ),
        ]
    )
    db_session.commit()
    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(id="research-data", name="Research Data", role="Owner", internal_bucket_name="research-data")
        ],
    )
    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    activity = service.list_portal_activity(user, access)
    transfers = service.list_portal_transfers(user, access)

    assert [(item.action, item.target, item.storage_space_name, item.ip_address) for item in activity] == [
        ("Uploaded", "report.csv", "Research Data", "192.0.2.10")
    ]
    assert [(item.direction, item.status, item.progress, item.size_bytes) for item in transfers] == [
        ("Upload", "Completed", 100, 42)
    ]
    with pytest.raises(RuntimeError, match="Storage space not found"):
        service.list_portal_activity(user, access, space_id="hidden-data")


def test_portal_user_activity_and_transfers_use_content_access(db_session):
    account = S3Account(name="portal-activity-privacy", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="activity-privacy@example.com", hashed_password="x", role="ui_user")
    hidden_owner = User(email="hidden-activity-owner@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user, hidden_owner])
    db_session.commit()
    db_session.add_all(
        [
            PortalStorageSpaceMetadata(
                account_id=account.id,
                bucket_name="visible-data",
                display_name="Visible Data",
                owner_user_id=user.id,
                visibility="private",
            ),
            PortalStorageSpaceMetadata(
                account_id=account.id,
                bucket_name="hidden-data",
                display_name="Hidden Data",
                owner_user_id=hidden_owner.id,
                visibility="private",
            ),
            AuditLog(
                user_id=user.id,
                user_email=user.email,
                user_role=user.role,
                scope="portal",
                action="upload_object",
                entity_type="object",
                entity_id="visible/report.csv",
                account_id=account.id,
                account_name=account.name,
                status="success",
                metadata_json=json.dumps({"storage_space_id": "visible-data", "size_bytes": 42}),
            ),
            AuditLog(
                user_id=hidden_owner.id,
                user_email=hidden_owner.email,
                user_role=hidden_owner.role,
                scope="portal",
                action="download_object",
                entity_type="object",
                entity_id="hidden/secret.txt",
                account_id=account.id,
                account_name=account.name,
                status="success",
                metadata_json=json.dumps({"storage_space_id": "hidden-data", "size_bytes": 99}),
            ),
        ]
    )
    db_session.commit()
    service = PortalService(db_session)
    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)

    activity = service.list_portal_activity(user, access)
    transfers = service.list_portal_transfers(user, access)

    assert [(item.action, item.storage_space_name, item.target) for item in activity] == [
        ("Uploaded", "Visible Data", "report.csv")
    ]
    assert [(item.direction, item.storage_space_name, item.size_bytes) for item in transfers] == [
        ("Upload", "Visible Data", 42)
    ]
    serialized = "".join(item.model_dump_json() for item in [*activity, *transfers])
    assert "Hidden Data" not in serialized


def test_portal_usage_exposes_quota_and_real_storage_space_breakdown(monkeypatch, db_session):
    account = S3Account(name="portal-usage", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="usage@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    db_session.add_all(
        [
            PortalStorageSpaceMetadata(
                account_id=account.id,
                bucket_name="research-data",
                visibility="shared",
            ),
            PortalStorageSpaceMetadata(
                account_id=account.id,
                bucket_name="archive",
                visibility="shared",
            ),
        ]
    )
    db_session.commit()
    service = PortalService(db_session)
    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    monkeypatch.setattr(service, "_account_limits", lambda _account: (1_000, 100, 12))
    monkeypatch.setattr(service, "_supervision_admin_for_account", lambda _account: object())
    monkeypatch.setattr(
        service,
        "_admin_bucket_list",
        lambda _account, admin=None: [
            {"bucket": "research-data", "usage": {"total_bytes": 700, "total_objects": 70}},
            {"bucket": "archive", "usage": {"total_bytes": 200, "total_objects": 20}},
            {"bucket": "hidden-bucket", "usage": {"total_bytes": 999, "total_objects": 99}},
        ],
    )
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(id="research-data", name="Research Data", role="Owner", internal_bucket_name="research-data"),
            PortalStorageSpaceSummary(id="archive", name="Archive", role="Owner", internal_bucket_name="archive"),
        ],
    )

    usage = service.get_usage(user, access)

    assert usage.used_bytes == 900
    assert usage.used_objects == 90
    assert usage.quota_max_size_bytes == 1_000
    assert usage.max_buckets == 12
    assert usage.quota_max_objects == 100
    assert [(space.id, space.used_bytes, space.object_count) for space in usage.storage_spaces] == [
        ("research-data", 700, 70),
        ("archive", 200, 20),
    ]
    assert usage.other_storage_space is None


def test_portal_user_usage_aggregates_hidden_storage_as_other(monkeypatch, db_session):
    account = S3Account(name="portal-usage-privacy", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="usage-privacy@example.com", hashed_password="x", role="ui_user")
    hidden_owner = User(email="hidden-owner@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user, hidden_owner])
    db_session.commit()
    db_session.add_all(
        [
            PortalStorageSpaceMetadata(
                account_id=account.id,
                bucket_name="research-data",
                display_name="Research Data",
                owner_user_id=user.id,
                visibility="private",
            ),
            PortalStorageSpaceMetadata(
                account_id=account.id,
                bucket_name="hidden-private",
                display_name="Hidden Private",
                owner_user_id=hidden_owner.id,
                visibility="private",
            ),
        ]
    )
    db_session.commit()
    service = PortalService(db_session)
    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)

    monkeypatch.setattr(service, "_account_limits", lambda _account: (2_000, 200, 20))
    monkeypatch.setattr(service, "_supervision_admin_for_account", lambda _account: object())
    monkeypatch.setattr(
        service,
        "_admin_bucket_list",
        lambda _account, admin=None: [
            {"bucket": "research-data", "usage": {"total_bytes": 700, "total_objects": 70}},
            {"bucket": "hidden-private", "usage": {"total_bytes": 200, "total_objects": 20}},
            {"bucket": "unregistered-bucket", "usage": {"total_bytes": 100, "total_objects": 10}},
        ],
    )

    usage = service.get_usage(user, access)

    assert usage.used_bytes == 1_000
    assert usage.used_objects == 100
    assert usage.quota_max_size_bytes == 2_000
    assert usage.max_buckets == 20
    assert [(space.id, space.name, space.used_bytes, space.object_count) for space in usage.storage_spaces] == [
        ("research-data", "Research Data", 700, 70),
    ]
    assert usage.other_storage_space is not None
    assert usage.other_storage_space.id == "__other__"
    assert usage.other_storage_space.name == "Other"
    assert usage.other_storage_space.used_bytes == 300
    assert usage.other_storage_space.object_count == 30
    serialized = usage.model_dump_json()
    assert "hidden-private" not in serialized
    assert "Hidden Private" not in serialized
    assert "unregistered-bucket" not in serialized


def test_portal_user_usage_omits_other_when_all_usage_is_visible(monkeypatch, db_session):
    account = S3Account(name="portal-usage-no-other", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="usage-no-other@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="research-data",
            display_name="Research Data",
            owner_user_id=user.id,
            visibility="private",
        )
    )
    db_session.commit()
    service = PortalService(db_session)
    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)

    monkeypatch.setattr(service, "_account_quota", lambda _account: (1_000, 100))
    monkeypatch.setattr(service, "_supervision_admin_for_account", lambda _account: object())
    monkeypatch.setattr(
        service,
        "_admin_bucket_list",
        lambda _account, admin=None: [
            {"bucket": "research-data", "usage": {"total_bytes": 700, "total_objects": 70}},
        ],
    )

    usage = service.get_usage(user, access)

    assert usage.used_bytes == 700
    assert usage.used_objects == 70
    assert [(space.id, space.used_bytes, space.object_count) for space in usage.storage_spaces] == [
        ("research-data", 700, 70),
    ]
    assert usage.other_storage_space is None


def test_portal_usage_trends_exposes_scoped_account_baselines(monkeypatch, db_session):
    monkeypatch.setattr(portal_router, "load_app_settings", lambda: _usage_history_settings(True))
    monkeypatch.setattr(
        portal_router,
        "utcnow",
        lambda: datetime(2026, 6, 9, 12, 0, 0, tzinfo=timezone.utc),
    )
    endpoint = StorageEndpoint(
        name="portal-trends-endpoint",
        endpoint_url="https://portal-trends.example.test",
        provider="ceph",
        features_config=(
            "features:\n"
            "  metrics:\n"
            "    enabled: true\n"
        ),
    )
    account = S3Account(
        name="portal-trends",
        rgw_account_id="portal-trends",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
        storage_endpoint=endpoint,
    )
    other_account = S3Account(
        name="portal-trends-other",
        rgw_account_id="portal-trends-other",
        rgw_access_key="OTHER-AK",
        rgw_secret_key="OTHER-SK",
        storage_endpoint=endpoint,
    )
    user = User(email="usage-trends@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([endpoint, account, other_account, user])
    db_session.commit()
    db_session.refresh(account)
    db_session.refresh(other_account)

    db_session.add_all(
        [
            QuotaUsageDaily(
                day=date(2026, 5, 10),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                last_used_bytes=100,
                last_used_objects=10,
                bucket_count=1,
                updated_at=datetime(2026, 5, 10, 12, 0, 0, tzinfo=timezone.utc),
            ),
            QuotaUsageDaily(
                day=date(2026, 5, 10),
                storage_endpoint_id=endpoint.id,
                s3_account_id=other_account.id,
                last_used_bytes=999,
                last_used_objects=99,
                bucket_count=9,
                updated_at=datetime(2026, 5, 10, 12, 0, 0, tzinfo=timezone.utc),
            ),
        ]
    )
    db_session.commit()

    payload = portal_router.portal_usage_trends(access=_portal_access(account, user), db=db_session)

    assert payload.storage is not None
    assert payload.storage.window == "month"
    assert payload.storage.used_bytes == 100
    assert payload.objects is not None
    assert payload.objects.used_objects == 10
    assert payload.buckets is not None
    assert payload.buckets.bucket_count == 1


def test_portal_usage_trends_return_empty_when_history_disabled(monkeypatch, db_session):
    monkeypatch.setattr(portal_router, "load_app_settings", lambda: _usage_history_settings(False))
    endpoint = StorageEndpoint(
        name="portal-trends-disabled-endpoint",
        endpoint_url="https://portal-trends-disabled.example.test",
        provider="ceph",
        features_config=(
            "features:\n"
            "  metrics:\n"
            "    enabled: true\n"
        ),
    )
    account = S3Account(
        name="portal-trends-disabled",
        rgw_account_id="portal-trends-disabled",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
        storage_endpoint=endpoint,
    )
    user = User(email="usage-trends-disabled@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([endpoint, account, user])
    db_session.commit()

    payload = portal_router.portal_usage_trends(access=_portal_access(account, user), db=db_session)

    assert payload.model_dump(exclude_none=True) == {}


def test_portal_usage_trends_return_empty_without_baseline(monkeypatch, db_session):
    monkeypatch.setattr(portal_router, "load_app_settings", lambda: _usage_history_settings(True))
    endpoint = StorageEndpoint(
        name="portal-trends-empty-endpoint",
        endpoint_url="https://portal-trends-empty.example.test",
        provider="ceph",
        features_config=(
            "features:\n"
            "  metrics:\n"
            "    enabled: true\n"
        ),
    )
    account = S3Account(
        name="portal-trends-empty",
        rgw_account_id="portal-trends-empty",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
        storage_endpoint=endpoint,
    )
    user = User(email="usage-trends-empty@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([endpoint, account, user])
    db_session.commit()

    payload = portal_router.portal_usage_trends(access=_portal_access(account, user), db=db_session)

    assert payload.model_dump(exclude_none=True) == {}


def test_portal_usage_stats_latest_filters_to_visible_storage_spaces(monkeypatch, db_session):
    monkeypatch.setattr(portal_router, "load_app_settings", lambda: _bucket_usage_settings(True))
    account = S3Account(name="portal-usage-stats", rgw_account_id="portal-usage-stats")
    user = User(email="usage-stats@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    db_session.refresh(account)

    BucketUsageStatsService().upsert_snapshot(
        db_session,
        _bucket_usage_snapshot("visible-space", scope_id=str(account.id), bytes_value=100),
    )
    BucketUsageStatsService().upsert_snapshot(
        db_session,
        _bucket_usage_snapshot("hidden-space", scope_id=str(account.id), bytes_value=900),
    )
    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="visible-space",
                name="Visible",
                role="Viewer",
                internal_bucket_name="visible-space",
            ),
            PortalStorageSpaceSummary(
                id="missing-space",
                name="Missing",
                role="Viewer",
                internal_bucket_name="missing-space",
            ),
        ],
    )

    payload = portal_router.portal_usage_stats_latest(
        access=_portal_access(account, user),
        portal_service=service,
        db=db_session,
    )

    aggregate = payload.aggregate
    assert aggregate.scope_kind == "portal"
    assert aggregate.scope_id == str(account.id)
    assert aggregate.bucket_count == 2
    assert aggregate.buckets_with_snapshot == 1
    assert aggregate.missing_bucket_count == 1
    assert aggregate.total_bytes == 100
    assert next(entry for entry in aggregate.data_type_distribution if entry.key == "documents").bytes == 100


def test_portal_usage_stats_latest_respects_feature_flag(monkeypatch, db_session):
    monkeypatch.setattr(portal_router, "load_app_settings", lambda: _bucket_usage_settings(False))
    account = S3Account(name="portal-usage-stats-disabled", rgw_account_id="portal-usage-stats-disabled")
    user = User(email="usage-stats-disabled@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    with pytest.raises(HTTPException) as excinfo:
        portal_router.portal_usage_stats_latest(
            access=_portal_access(account, user),
            portal_service=PortalService(db_session),
            db=db_session,
        )

    assert excinfo.value.status_code == 403
    assert excinfo.value.detail == "Bucket usage stats feature is disabled"


def test_portal_storage_space_usage_stats_returns_sanitized_snapshot(monkeypatch, db_session):
    monkeypatch.setattr(portal_router, "load_app_settings", lambda: _bucket_usage_settings(True))
    account = S3Account(name="portal-space-stats", rgw_account_id="portal-space-stats")
    user = User(email="space-stats@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    db_session.refresh(account)
    BucketUsageStatsService().upsert_snapshot(
        db_session,
        _bucket_usage_snapshot("space-bucket", scope_id=str(account.id), bytes_value=123),
    )
    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="space-id",
                name="Space",
                role="Viewer",
                internal_bucket_name="space-bucket",
            )
        ],
    )

    payload = portal_router.portal_storage_space_usage_stats(
        "space-id",
        access=_portal_access(account, user),
        portal_service=service,
        db=db_session,
    )

    assert payload.snapshot is not None
    assert payload.snapshot.total_bytes == 123
    assert payload.snapshot.data_type_distribution[0].key == "documents"
    assert set(payload.snapshot.model_dump()) == {
        "scan_mode",
        "version_listing_available",
        "object_version_count",
        "current_version_count",
        "noncurrent_version_count",
        "delete_marker_count",
        "total_bytes",
        "current_bytes",
        "noncurrent_bytes",
        "data_type_distribution",
        "storage_class_distribution",
        "size_distribution",
        "age_distribution",
        "current_vs_noncurrent",
        "calculated_at",
    }


def test_portal_storage_space_usage_stats_returns_empty_without_snapshot(monkeypatch, db_session):
    monkeypatch.setattr(portal_router, "load_app_settings", lambda: _bucket_usage_settings(True))
    account = S3Account(name="portal-space-stats-empty", rgw_account_id="portal-space-stats-empty")
    user = User(email="space-stats-empty@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="space-id",
                name="Space",
                role="Viewer",
                internal_bucket_name="space-bucket",
            )
        ],
    )

    payload = portal_router.portal_storage_space_usage_stats(
        "space-id",
        access=_portal_access(account, user),
        portal_service=service,
        db=db_session,
    )

    assert payload.snapshot is None


@pytest.mark.parametrize(
    ("requested_space_id", "can_browse", "archived", "expected_status"),
    [
        ("forged-id", True, False, 404),
        ("space-id", False, False, 403),
        ("space-id", True, True, 403),
    ],
)
def test_portal_storage_space_usage_stats_rejects_inaccessible_space(
    monkeypatch,
    db_session,
    requested_space_id,
    can_browse,
    archived,
    expected_status,
):
    monkeypatch.setattr(portal_router, "load_app_settings", lambda: _bucket_usage_settings(True))
    account = S3Account(name="portal-space-stats-denied", rgw_account_id="portal-space-stats-denied")
    user = User(email="space-stats-denied@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="space-id",
                name="Space",
                role="Viewer",
                can_browse=can_browse,
                status="Archived" if archived else "Active",
                archived_at=datetime(2026, 6, 1, tzinfo=timezone.utc) if archived else None,
                internal_bucket_name="space-bucket",
            )
        ],
    )

    with pytest.raises(HTTPException) as excinfo:
        portal_router.portal_storage_space_usage_stats(
            requested_space_id,
            access=_portal_access(account, user),
            portal_service=service,
            db=db_session,
        )

    assert excinfo.value.status_code == expected_status


def test_portal_storage_space_usage_stats_respects_feature_flag(monkeypatch, db_session):
    monkeypatch.setattr(portal_router, "load_app_settings", lambda: _bucket_usage_settings(False))
    account = S3Account(name="portal-space-stats-disabled", rgw_account_id="portal-space-stats-disabled")
    user = User(email="space-stats-disabled@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    with pytest.raises(HTTPException) as excinfo:
        portal_router.portal_storage_space_usage_stats(
            "space-id",
            access=_portal_access(account, user),
            portal_service=PortalService(db_session),
            db=db_session,
        )

    assert excinfo.value.status_code == 403
    assert excinfo.value.detail == "Bucket usage stats feature is disabled"


def test_portal_usage_history_trends_exposes_account_history(monkeypatch, db_session):
    monkeypatch.setattr(portal_router, "load_app_settings", lambda: _usage_history_settings(True))
    endpoint = StorageEndpoint(
        name="portal-history-endpoint",
        endpoint_url="https://portal-history.example.test",
        provider="ceph",
    )
    account = S3Account(
        name="portal-history",
        rgw_account_id="portal-history",
        storage_endpoint=endpoint,
    )
    other_account = S3Account(
        name="portal-history-other",
        rgw_account_id="portal-history-other",
        storage_endpoint=endpoint,
    )
    user = User(email="usage-history@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([endpoint, account, other_account, user])
    db_session.commit()
    db_session.refresh(account)
    db_session.refresh(other_account)
    today = utcnow().date()

    db_session.add_all(
        [
            QuotaUsageDaily(
                day=today,
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                last_used_bytes=100,
                last_used_objects=10,
                bucket_count=1,
                    updated_at=datetime.combine(
                        today,
                        datetime.min.time(),
                        tzinfo=timezone.utc,
                    ),
            ),
            QuotaUsageDaily(
                day=today,
                storage_endpoint_id=endpoint.id,
                s3_account_id=other_account.id,
                last_used_bytes=999,
                last_used_objects=99,
                bucket_count=9,
                    updated_at=datetime.combine(
                        today,
                        datetime.min.time(),
                        tzinfo=timezone.utc,
                    ),
            ),
        ]
    )
    db_session.commit()

    payload = portal_router.portal_usage_history_trends(
        window="month",
        access=_portal_access(account, user),
        db=db_session,
    )

    assert payload.available is True
    assert len(payload.points) == 1
    assert payload.points[0].used_bytes == 100
    assert payload.points[0].used_objects == 10
    assert payload.summary.latest_bucket_count == 1


def test_portal_usage_history_trends_return_unavailable_when_disabled(monkeypatch, db_session):
    monkeypatch.setattr(portal_router, "load_app_settings", lambda: _usage_history_settings(False))
    account = S3Account(name="portal-history-disabled", rgw_account_id="portal-history-disabled")
    user = User(email="usage-history-disabled@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    payload = portal_router.portal_usage_history_trends(
        window="month",
        access=_portal_access(account, user),
        db=db_session,
    )

    assert payload.available is False
    assert payload.unavailable_reason == "Usage history is disabled."


def test_portal_alerts_are_derived_from_quota_public_spaces_and_transfer_errors(monkeypatch, db_session):
    account = S3Account(name="portal-alerts", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="alerts@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    db_session.add(
        AuditLog(
            user_id=user.id,
            user_email=user.email,
            user_role=user.role,
            scope="portal",
            action="upload_object",
            entity_type="object",
            entity_id="failed.zip",
            account_id=account.id,
            account_name=account.name,
            status="failed",
            message="network error",
            metadata_json=json.dumps({"storage_space_id": "public-data"}),
        )
    )
    db_session.add(
        PortalPublicLink(
            token="expiring-token",
            account_id=account.id,
            bucket_name="public-data",
            object_key="shared/report.pdf",
            created_by_user_id=user.id,
            created_by_email=user.email,
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
    )
    db_session.commit()
    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(id="public-data", name="Public Data", role="Owner", internal_bucket_name="public-data")
        ],
    )
    monkeypatch.setattr(service, "_account_quota", lambda _account: (100, None))
    monkeypatch.setattr(
        service,
        "get_usage",
        lambda *_args, **_kwargs: PortalUsage(used_bytes=90, used_objects=None, quota_max_size_bytes=100),
    )
    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    alerts = service.list_portal_alerts(user, access)

    assert alerts[0].id == "public-space-public-data"
    assert alerts[0].severity_label == "Critical"
    warning_ids = [alert.id for alert in alerts[1:]]
    assert "quota-near" in warning_ids
    assert any(alert_id.startswith("public-link-") for alert_id in warning_ids)
    assert any(alert_id.startswith("link-expiring-") for alert_id in warning_ids)
    assert any(alert_id.startswith("transfer-failed-audit-") for alert_id in warning_ids)
    assert any("public link" in alert.description for alert in alerts)
    assert any("expires soon" in alert.description for alert in alerts)
    assert any(alert.description == "failed.zip failed recently." for alert in alerts)


def test_portal_alert_deduplication_keeps_highest_severity():
    alerts = PortalService.dedupe_portal_alerts(
        [
            PortalAlert(
                id="endpoint-degraded",
                tone="warning",
                title="Endpoint degraded",
                description="Storage is degraded.",
                severity_label="Warning",
            ),
            PortalAlert(
                id="endpoint-degraded",
                tone="danger",
                title="Endpoint down",
                description="Storage is unavailable.",
                severity_label="Critical",
            ),
        ]
    )

    assert len(alerts) == 1
    assert alerts[0].tone == "danger"
    assert alerts[0].severity_label == "Critical"


def test_portal_endpoint_alerts_report_degraded_endpoint(monkeypatch, db_session):
    endpoint = StorageEndpoint(name="endpoint-alert", endpoint_url="https://s3.example.test")
    account = S3Account(name="portal-health", storage_endpoint=endpoint)
    user = User(email="health@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([endpoint, account, user])
    db_session.commit()

    class FakeGeneral:
        endpoint_status_enabled = True

    class FakeSettings:
        general = FakeGeneral()

    class FakeHealthService:
        def __init__(self, _db):
            pass

        def build_workspace_health_overview(self, endpoint_id):
            assert endpoint_id == endpoint.id
            return {"down_count": 0, "degraded_count": 1}

    monkeypatch.setattr(portal_router, "load_app_settings", lambda: FakeSettings())
    monkeypatch.setattr(portal_router, "HealthCheckService", FakeHealthService)

    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    alerts = portal_router._portal_endpoint_alerts(access, db_session)

    assert [(alert.id, alert.tone, alert.severity_label) for alert in alerts] == [
        ("endpoint-degraded", "warning", "Warning")
    ]


def test_portal_alerts_are_empty_for_isolated_tenant_and_no_signals(monkeypatch, db_session):
    account = S3Account(name="portal-alert-empty", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    other_account = S3Account(name="portal-alert-other", rgw_access_key="ROOT-AK2", rgw_secret_key="ROOT-SK2")
    user = User(email="empty-alerts@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, other_account, user])
    db_session.commit()
    db_session.add(
        PortalPublicLink(
            token="other-token",
            account_id=other_account.id,
            bucket_name="research-data",
            object_key="shared/report.pdf",
            created_by_user_id=user.id,
            created_by_email=user.email,
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
    )
    db_session.commit()
    service = PortalService(db_session)
    monkeypatch.setattr(service, "list_storage_spaces", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        service,
        "get_usage",
        lambda *_args, **_kwargs: PortalUsage(used_bytes=None, used_objects=None, quota_max_size_bytes=None),
    )
    monkeypatch.setattr(service, "list_portal_transfers", lambda *_args, **_kwargs: [])
    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    assert service.list_portal_alerts(user, access) == []


def test_download_storage_space_object_streams_visible_object(monkeypatch, db_session):
    account = S3Account(name="portal-object-download", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-object-download@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="bucket-research-data",
            display_name="Research Data",
            visibility="shared",
        )
    )
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_user_storage_space_content_role", lambda *_args, **_kwargs: "Editor")
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="research-data",
                name="Research Data",
                role="Editor",
                internal_bucket_name="bucket-research-data",
            )
        ],
    )

    class FakeBody:
        def iter_chunks(self, chunk_size):  # noqa: ARG002
            return iter([b"abc", b"def"])

    class FakeClient:
        def __init__(self):
            self.calls = []

        def get_object(self, **kwargs):
            self.calls.append(kwargs)
            return {"Body": FakeBody(), "ContentType": "text/plain"}

    fake_client = FakeClient()
    monkeypatch.setattr(service, "_portal_object_client", lambda *_args, **_kwargs: fake_client)

    stream, content_type, filename = service.download_storage_space_object(
        user,
        access,
        "research-data",
        "/raw-data/readme.txt",
    )

    assert fake_client.calls == [{"Bucket": "bucket-research-data", "Key": "raw-data/readme.txt"}]
    assert list(stream) == [b"abc", b"def"]
    assert content_type == "text/plain"
    assert filename == "readme.txt"


def test_portal_object_access_rejects_hidden_storage_space(monkeypatch, db_session):
    account = S3Account(name="portal-object-hidden", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-object-hidden@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
    monkeypatch.setattr(service, "list_storage_spaces", lambda *_args, **_kwargs: [])

    with pytest.raises(RuntimeError, match="Storage space not found"):
        service.get_storage_space_object_detail(user, access, "hidden-space", "raw-data/file.txt")


def test_portal_object_download_route_audits_scope_portal(db_session):
    account = S3Account(name="portal-object-download-route", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-object-download-route@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)

    class FakeService:
        def download_storage_space_object(self, user_obj, access_obj, space_id, key):
            assert user_obj == user
            assert access_obj == access
            assert space_id == "research-data"
            assert key == "raw-data/readme.txt"
            return iter([b"hello"]), "text/plain", "readme.txt"

    class FakeAuditService:
        def __init__(self):
            self.actions = []

        def record_action(self, **kwargs):
            self.actions.append(kwargs)

    audit_service = FakeAuditService()

    response = portal_router.portal_download_storage_space_object(
        "research-data",
        key="raw-data/readme.txt",
        access=access,
        audit_service=audit_service,
        service=FakeService(),
    )

    assert response.media_type == "text/plain"
    assert response.headers["content-disposition"].startswith('attachment; filename="readme.txt"')
    assert audit_service.actions[0]["scope"] == "portal"
    assert audit_service.actions[0]["action"] == "download_object"
    assert audit_service.actions[0]["metadata"] == {"storage_space_id": "research-data"}


def test_portal_object_restore_route_audits_recovery_source(db_session):
    account = S3Account(name="portal-object-restore-route")
    user = User(email="portal-object-restore-route@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)

    class FakeService:
        def restore_storage_space_object_version(
            self,
            user_obj,
            access_obj,
            space_id,
            key,
            *,
            version_id,
        ):
            assert user_obj == user
            assert access_obj == access
            assert space_id == "research-data"
            assert key == "raw-data/readme.txt"
            assert version_id == "v2"
            return PortalStorageObjectRestoreResponse(
                key=key,
                restored_from_version_id=version_id,
            )

    class FakeAuditService:
        def __init__(self):
            self.actions = []

        def record_action(self, **kwargs):
            self.actions.append(kwargs)

    audit_service = FakeAuditService()
    response = portal_router.portal_restore_storage_space_object(
        "research-data",
        payload=PortalStorageObjectRestoreRequest(
            key="raw-data/readme.txt",
            version_id="v2",
        ),
        access=access,
        audit_service=audit_service,
        service=FakeService(),
    )

    assert response.restored_from_version_id == "v2"
    assert audit_service.actions[0]["scope"] == "portal"
    assert audit_service.actions[0]["action"] == "restore_object_version"
    assert audit_service.actions[0]["metadata"] == {
        "storage_space_id": "research-data",
        "restored_from_version_id": "v2",
    }


def test_create_access_key_rejects_when_management_disabled(monkeypatch, db_session):
    account = S3Account(name="portal-account-key-disabled", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-key-disabled@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    service = PortalService(db_session)
    monkeypatch.setattr(service, "_effective_portal_settings", lambda acc: PortalSettings(allow_portal_user_access_key_create=False))
    monkeypatch.setattr(service, "_ensure_portal_user", lambda *args, **kwargs: pytest.fail("portal user should not be provisioned"))

    with pytest.raises(PortalAccessKeyManagementDisabled):
        service.create_access_key(user, _portal_access(account, user))


def test_access_key_mutations_reject_portal_key(monkeypatch, db_session):
    account = S3Account(name="portal-account-key-protected", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-key-protected@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    service = PortalService(db_session)
    link = AccountIAMUser(
        user_id=user.id,
        account_id=account.id,
        iam_user_id="iam-uid",
        iam_username="portal-iam",
        active_access_key="AK-PORTAL",
        active_secret_key="SK-PORTAL",
    )
    fake_iam_user = IAMUser(name="portal-iam", arn="arn:aws:iam:::user/portal-iam")

    monkeypatch.setattr(service, "_effective_portal_settings", lambda acc: PortalSettings(allow_portal_user_access_key_create=True))
    monkeypatch.setattr(service, "_get_iam_service", lambda acc: object())
    monkeypatch.setattr(service, "_ensure_portal_user", lambda *args, **kwargs: (link, fake_iam_user, False))
    monkeypatch.setattr(service, "_sync_user_group_membership", lambda *args, **kwargs: None)

    access = _portal_access(account, user)
    with pytest.raises(PortalAccessKeyProtected, match="Cannot update"):
        service.update_access_key_status(user, access, "AK-PORTAL", True)
    with pytest.raises(PortalAccessKeyProtected, match="Cannot delete"):
        service.delete_access_key(user, access, "AK-PORTAL")


def test_create_access_key_rejects_when_limit_reached(monkeypatch, db_session):
    account = S3Account(name="portal-account-key-limit", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-key-limit@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=AccountRole.PORTAL_USER.value,
        capabilities=AccountCapabilities(
            can_manage_buckets=False,
            can_manage_portal_users=False,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )

    service = PortalService(db_session)
    link = AccountIAMUser(user_id=user.id, account_id=account.id, iam_user_id="iam-uid", iam_username="portal-iam")
    fake_iam_user = IAMUser(name="portal-iam", arn="arn:aws:iam:::user/portal-iam")

    class _FakeIAMService:
        def __init__(self):
            self.create_calls = 0

        def create_access_key(self, iam_username):  # noqa: ARG002
            self.create_calls += 1
            return IAMAccessKey(
                access_key_id="AK-NEW",
                status="Active",
                created_at="2026-01-03T00:00:00Z",
                secret_access_key="SK-NEW",
            )

    iam_service = _FakeIAMService()
    monkeypatch.setattr(service, "_get_iam_service", lambda acc: iam_service)
    monkeypatch.setattr(service, "_ensure_portal_user", lambda *args, **kwargs: (link, fake_iam_user, False))
    monkeypatch.setattr(service, "_effective_portal_settings", lambda acc: PortalSettings(max_portal_user_access_keys=2))
    monkeypatch.setattr(service, "_sync_user_group_membership", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        service,
        "_list_access_keys",
        lambda link_obj, iam_obj, include_portal=False: [
            PortalAccessKey(access_key_id="AK-1", is_portal=False),
            PortalAccessKey(access_key_id="AK-2", is_portal=False),
        ],
    )

    with pytest.raises(PortalAccessKeyLimitExceeded) as exc:
        service.create_access_key(user, access)

    assert "Maximum IAM user keys reached" in str(exc.value)
    assert iam_service.create_calls == 0


def test_create_access_key_allows_when_below_limit(monkeypatch, db_session):
    account = S3Account(name="portal-account-key-limit-ok", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-key-limit-ok@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=AccountRole.PORTAL_USER.value,
        capabilities=AccountCapabilities(
            can_manage_buckets=False,
            can_manage_portal_users=False,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )

    service = PortalService(db_session)
    link = AccountIAMUser(user_id=user.id, account_id=account.id, iam_user_id="iam-uid", iam_username="portal-iam")
    fake_iam_user = IAMUser(name="portal-iam", arn="arn:aws:iam:::user/portal-iam")

    class _FakeIAMService:
        def __init__(self):
            self.create_calls = 0

        def create_access_key(self, iam_username):  # noqa: ARG002
            self.create_calls += 1
            return IAMAccessKey(
                access_key_id="AK-NEW",
                status="Active",
                created_at="2026-01-03T00:00:00Z",
                secret_access_key="SK-NEW",
            )

    iam_service = _FakeIAMService()
    monkeypatch.setattr(service, "_get_iam_service", lambda acc: iam_service)
    monkeypatch.setattr(service, "_ensure_portal_user", lambda *args, **kwargs: (link, fake_iam_user, False))
    monkeypatch.setattr(service, "_effective_portal_settings", lambda acc: PortalSettings(max_portal_user_access_keys=2))
    monkeypatch.setattr(service, "_sync_user_group_membership", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        service,
        "_list_access_keys",
        lambda link_obj, iam_obj, include_portal=False: [PortalAccessKey(access_key_id="AK-1", is_portal=False)],
    )

    created = service.create_access_key(user, access)

    assert created.access_key_id == "AK-NEW"
    assert created.secret_access_key == "SK-NEW"
    assert iam_service.create_calls == 1


@pytest.mark.parametrize(
    ("permission", "expected_actions", "blocked_actions"),
    [
        ("read_only", {"s3:GetBucketLocation", "s3:ListBucket", "s3:GetObject"}, {"s3:PutObject", "s3:DeleteObject"}),
        ("read_write", {"s3:PutObject", "s3:DeleteObject"}, {"s3:*"}),
    ],
)
def test_create_external_access_key_scopes_policy_to_storage_space(
    monkeypatch,
    db_session,
    permission,
    expected_actions,
    blocked_actions,
):
    account = S3Account(name=f"portal-account-ext-{permission}", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email=f"portal-owner-{permission}@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name=f"research-{permission}",
        display_name="Research Data",
        owner_user_id=user.id,
    )
    db_session.add(metadata)
    db_session.commit()
    db_session.add(
        PortalExternalAccessCredential(
            account_id=account.id,
            storage_space_metadata_id=metadata.id,
            bucket_name=metadata.bucket_name,
            created_by_user_id=user.id,
            external_email="existing-partner@example.org",
            permission="read_only",
            iam_user_id=f"existing-uid-{permission}",
            iam_username=f"existing-user-{permission}",
            access_key_id=f"AK-EXISTING-{permission}",
            status="Active",
        )
    )
    db_session.commit()

    class _FakeIAMService:
        def __init__(self):
            self.policies = {}
            self.created_users = []

        def get_user(self, iam_username):  # noqa: ARG002
            return None

        def create_user(self, name, create_key=False, allow_existing=False):  # noqa: ARG002
            self.created_users.append(name)
            return IAMUser(name=name, user_id=f"uid-{name}"), None

        def put_user_inline_policy(self, user_name, policy_name, policy_document):
            self.policies[(user_name, policy_name)] = policy_document

        def create_access_key(self, user_name):
            return IAMAccessKey(
                access_key_id=f"AK-{permission}",
                secret_access_key=f"SK-{permission}",
                status="Active",
            )

        def delete_access_key(self, user_name, access_key_id):  # noqa: ARG002
            pytest.fail("cleanup should not run for successful creation")

        def delete_user_inline_policy(self, user_name, policy_name):  # noqa: ARG002
            pytest.fail("cleanup should not run for successful creation")

        def delete_user(self, user_name):  # noqa: ARG002
            pytest.fail("cleanup should not run for successful creation")

    iam_service = _FakeIAMService()
    synced = []
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_get_iam_service", lambda acc: iam_service)
    monkeypatch.setattr(service, "_effective_portal_settings", lambda acc: PortalSettings(max_portal_user_access_keys=1))
    monkeypatch.setattr(
        service,
        "_sync_storage_space_access_projection",
        lambda _account, meta, **kwargs: synced.append((meta.bucket_name, meta.id, kwargs.get("sync_participants"))),
    )

    created = service.create_access_key(
        user,
        _portal_access(account, user),
        PortalAccessKeyCreate(
            target_type="external",
            storage_space_id=metadata.bucket_name,
            external_email="partner@example.org",
            permission=permission,
        ),
    )

    row = db_session.query(PortalExternalAccessCredential).filter_by(access_key_id=f"AK-{permission}").one()
    assert created.target_type == "external"
    assert created.secret_access_key == f"SK-{permission}"
    assert created.external_email == "partner@example.org"
    assert created.storage_space_id == metadata.bucket_name
    assert created.bucket_name == metadata.bucket_name
    assert created.permission == permission
    assert row.external_email == "partner@example.org"
    assert not hasattr(row, "secret_access_key")
    assert synced == [(metadata.bucket_name, metadata.id, False)]
    policy = iam_service.policies[(row.iam_username, "portal-external-storage-space")]
    statements = policy["Statement"]
    actions = set(statements[0]["Action"])
    resources = set(statements[0]["Resource"])
    assert expected_actions.issubset(actions)
    assert actions.isdisjoint(blocked_actions)
    assert resources == {f"arn:aws:s3:::{metadata.bucket_name}", f"arn:aws:s3:::{metadata.bucket_name}/*"}


def test_create_external_access_key_requires_content_owner(monkeypatch, db_session):
    account = S3Account(name="portal-account-ext-denied", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="portal-owner-ext-denied@example.com", hashed_password="x", role="ui_user")
    viewer = User(email="portal-viewer-ext-denied@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, viewer])
    db_session.commit()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="shared-viewer",
        display_name="Shared Viewer",
        visibility="shared",
        share_scope="restricted",
    )
    db_session.add(metadata)
    db_session.commit()
    db_session.add(
        PortalStorageSpaceGrant(
            storage_space_metadata_id=metadata.id,
            user_id=viewer.id,
            role="Viewer",
            created_by_user_id=owner.id,
        )
    )
    db_session.commit()

    service = PortalService(db_session)
    monkeypatch.setattr(service, "_effective_portal_settings", lambda acc: PortalSettings(max_portal_user_access_keys=4))
    monkeypatch.setattr(service, "_get_iam_service", lambda acc: pytest.fail("IAM should not be reached when owner check fails"))

    with pytest.raises(RuntimeError, match="Full content access required"):
        service.create_access_key(
            viewer,
            _portal_access(account, viewer),
            PortalAccessKeyCreate(
                target_type="external",
                storage_space_id=metadata.bucket_name,
                external_email="partner@example.org",
                permission="read_only",
            ),
        )


def test_external_access_key_status_and_delete_resync_policy(monkeypatch, db_session):
    account = S3Account(name="portal-account-ext-lifecycle", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-owner-ext-lifecycle@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="external-lifecycle",
        display_name="External Lifecycle",
        owner_user_id=user.id,
    )
    db_session.add(metadata)
    db_session.commit()
    credential = PortalExternalAccessCredential(
        account_id=account.id,
        storage_space_metadata_id=metadata.id,
        bucket_name=metadata.bucket_name,
        created_by_user_id=user.id,
        external_email="partner@example.org",
        permission="read_only",
        iam_user_id="iam-ext",
        iam_username="portal-ext-lifecycle",
        access_key_id="AK-EXT-LIFE",
        status="Active",
    )
    db_session.add(credential)
    db_session.commit()

    class _FakeIAMService:
        def __init__(self):
            self.calls = []

        def update_access_key_status(self, user_name, access_key_id, status_value):
            self.calls.append(("update", user_name, access_key_id, status_value))

        def delete_access_key(self, user_name, access_key_id):
            self.calls.append(("delete_key", user_name, access_key_id))

        def delete_user_inline_policy(self, user_name, policy_name):
            self.calls.append(("delete_policy", user_name, policy_name))

        def delete_user(self, user_name):
            self.calls.append(("delete_user", user_name))

    iam_service = _FakeIAMService()
    synced = []
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_get_iam_service", lambda acc: iam_service)
    monkeypatch.setattr(service, "_effective_portal_settings", lambda acc: PortalSettings(max_portal_user_access_keys=4))
    monkeypatch.setattr(
        service,
        "_sync_storage_space_access_projection",
        lambda _account, meta, **kwargs: synced.append((meta.bucket_name, kwargs.get("sync_participants"))),
    )

    updated = service.update_access_key_status(user, _portal_access(account, user), "AK-EXT-LIFE", False)
    assert updated.target_type == "external"
    assert updated.is_active is False
    assert iam_service.calls[0] == ("update", "portal-ext-lifecycle", "AK-EXT-LIFE", "Inactive")
    assert synced == [(metadata.bucket_name, False)]

    deleted = service.delete_access_key(user, _portal_access(account, user), "AK-EXT-LIFE")
    db_session.refresh(credential)

    assert deleted is not None
    assert deleted.target_type == "external"
    assert credential.revoked_at is not None
    assert credential.status == "Inactive"
    assert ("delete_key", "portal-ext-lifecycle", "AK-EXT-LIFE") in iam_service.calls
    assert ("delete_policy", "portal-ext-lifecycle", "portal-external-storage-space") in iam_service.calls
    assert ("delete_user", "portal-ext-lifecycle") in iam_service.calls
    assert synced == [(metadata.bucket_name, False), (metadata.bucket_name, False)]


def test_bucket_policy_principals_include_active_external_credentials(db_session):
    account = S3Account(
        name="portal-account-ext-policy",
        rgw_account_id="RGW1",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    user = User(email="portal-owner-ext-policy@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="external-policy",
        owner_user_id=user.id,
    )
    db_session.add(metadata)
    db_session.commit()
    active = PortalExternalAccessCredential(
        account_id=account.id,
        storage_space_metadata_id=metadata.id,
        bucket_name=metadata.bucket_name,
        created_by_user_id=user.id,
        external_email="active@example.org",
        permission="read_only",
        iam_user_id="iam-active",
        iam_username="portal-ext-active",
        access_key_id="AK-ACTIVE",
        status="Active",
    )
    inactive = PortalExternalAccessCredential(
        account_id=account.id,
        storage_space_metadata_id=metadata.id,
        bucket_name=metadata.bucket_name,
        created_by_user_id=user.id,
        external_email="inactive@example.org",
        permission="read_only",
        iam_user_id="iam-inactive",
        iam_username="portal-ext-inactive",
        access_key_id="AK-INACTIVE",
        status="Inactive",
    )
    db_session.add_all([active, inactive])
    db_session.commit()

    principals = PortalService(db_session)._portal_policy_principals_for_space(account, metadata)

    assert "arn:aws:iam::RGW1:user/portal-ext-active" in principals
    assert "arn:aws:iam:::user/portal-ext-active" in principals
    assert not any("portal-ext-inactive" in principal for principal in principals)


def test_list_external_access_key_exposes_bucket_without_secret(db_session):
    account = S3Account(name="portal-account-ext-list", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-owner-ext-list@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="external-list-bucket",
        display_name="External List Space",
        owner_user_id=user.id,
    )
    db_session.add(metadata)
    db_session.commit()
    credential = PortalExternalAccessCredential(
        account_id=account.id,
        storage_space_metadata_id=metadata.id,
        bucket_name=metadata.bucket_name,
        created_by_user_id=user.id,
        external_email="partner@example.org",
        permission="read_only",
        iam_user_id="iam-ext-list",
        iam_username="portal-ext-list",
        access_key_id="AK-EXT-LIST",
        status="Active",
    )
    db_session.add(credential)
    db_session.commit()

    keys = PortalService(db_session).list_access_keys(user, _portal_access(account, user))

    external = next(key for key in keys if key.access_key_id == "AK-EXT-LIST")
    assert external.target_type == "external"
    assert external.storage_space_name == "External List Space"
    assert external.bucket_name == metadata.bucket_name
    assert external.secret_access_key is None


def test_portal_access_key_routes_record_audit(db_session):
    account = S3Account(name="portal-account-key-routes", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-key-routes@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    access = _portal_access(account, user)

    class FakeService:
        def create_access_key(self, user_obj, access_obj, payload=None):  # noqa: ARG002
            assert user_obj == user
            assert access_obj == access
            return PortalAccessKey(access_key_id="AK-NEW", secret_access_key="SK-NEW", is_portal=False)

        def update_access_key_status(self, user_obj, access_obj, access_key_id, active):
            assert user_obj == user
            assert access_obj == access
            assert access_key_id == "AK-NEW"
            assert active is False
            return PortalAccessKey(access_key_id="AK-NEW", status="Inactive", is_active=False, is_portal=False)

        def delete_access_key(self, user_obj, access_obj, access_key_id):
            assert user_obj == user
            assert access_obj == access
            assert access_key_id == "AK-NEW"
            return None

    class FakeAuditService:
        def __init__(self):
            self.actions = []

        def record_action(self, **kwargs):
            self.actions.append(kwargs)

    audit_service = FakeAuditService()
    service = FakeService()

    created = portal_router.create_portal_access_key(access=access, audit_service=audit_service, service=service)
    updated = portal_router.update_portal_access_key_status(
        "AK-NEW",
        PortalAccessKeyStatusChange(active=False),
        access=access,
        audit_service=audit_service,
        service=service,
    )
    deleted = portal_router.delete_portal_access_key("AK-NEW", access=access, audit_service=audit_service, service=service)

    assert created.access_key_id == "AK-NEW"
    assert created.secret_access_key == "SK-NEW"
    assert updated.is_active is False
    assert deleted.status_code == 204
    assert [entry["action"] for entry in audit_service.actions] == [
        "create_portal_access_key",
        "update_portal_access_key_status",
        "delete_portal_access_key",
    ]
    assert all(entry["scope"] == "portal" for entry in audit_service.actions)
    assert all(entry["entity_type"] == "portal_access_key" for entry in audit_service.actions)
    assert audit_service.actions[0]["metadata"] == {"access_key_id": "AK-NEW"}
    assert audit_service.actions[1]["metadata"] == {"access_key_id": "AK-NEW", "active": False}
    assert audit_service.actions[2]["metadata"] == {"access_key_id": "AK-NEW"}


def test_portal_access_key_route_audits_external_metadata_without_secret(db_session):
    account = S3Account(name="portal-account-key-route-external", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-key-route-external@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    access = _portal_access(account, user)
    payload = PortalAccessKeyCreate(
        target_type="external",
        storage_space_id="research-data",
        external_email="partner@example.org",
        permission="read_write",
    )

    class FakeService:
        def create_access_key(self, user_obj, access_obj, payload_obj):
            assert user_obj == user
            assert access_obj == access
            assert payload_obj == payload
            return PortalAccessKey(
                access_key_id="AK-EXT",
                secret_access_key="SK-EXT",
                target_type="external",
                external_email="partner@example.org",
                storage_space_id="research-data",
                storage_space_name="Research Data",
                permission="read_write",
            )

    class FakeAuditService:
        def __init__(self):
            self.actions = []

        def record_action(self, **kwargs):
            self.actions.append(kwargs)

    audit_service = FakeAuditService()

    created = portal_router.create_portal_access_key(
        payload=payload,
        access=access,
        audit_service=audit_service,
        service=FakeService(),
    )

    assert created.secret_access_key == "SK-EXT"
    assert audit_service.actions[0]["metadata"] == {
        "access_key_id": "AK-EXT",
        "target_type": "external",
        "storage_space_id": "research-data",
        "permission": "read_write",
        "external_email": "partner@example.org",
    }
    assert "SK-EXT" not in json.dumps(audit_service.actions[0]["metadata"])


def test_portal_access_key_routes_translate_disabled_management(db_session):
    account = S3Account(name="portal-account-key-route-disabled", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-key-route-disabled@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    class FakeService:
        def create_access_key(self, user_obj, access_obj, payload=None):  # noqa: ARG002
            raise PortalAccessKeyManagementDisabled("Portal access-key management is disabled for this account.")

    class FakeAuditService:
        def record_action(self, **kwargs):  # noqa: ANN003
            pytest.fail("disabled access-key creation should not be audited")

    with pytest.raises(HTTPException) as exc:
        portal_router.create_portal_access_key(
            access=_portal_access(account, user),
            audit_service=FakeAuditService(),
            service=FakeService(),
        )

    assert exc.value.status_code == 403


def test_portal_router_no_longer_exposes_legacy_backend_surfaces():
    route_keys = {
        (method, route.path)
        for route in portal_router.router.routes
        for method in getattr(route, "methods", set())
    }

    removed_routes = {
        ("GET", "/portal/buckets"),
        ("POST", "/portal/bootstrap"),
        ("GET", "/portal/buckets/{bucket_name}/users"),
        ("GET", "/portal/buckets/{bucket_name}/stats"),
        ("POST", "/portal/buckets"),
        ("DELETE", "/portal/buckets/{bucket_name}"),
        ("POST", "/portal/access-keys/portal/rotate"),
        ("GET", "/portal/account-settings"),
        ("PUT", "/portal/account-settings"),
        ("GET", "/portal/iam-compliance"),
        ("POST", "/portal/iam-compliance/apply"),
        ("GET", "/portal/users"),
        ("POST", "/portal/users"),
        ("GET", "/portal/users/{user_id}/buckets"),
        ("POST", "/portal/users/{user_id}/buckets"),
        ("DELETE", "/portal/users/{user_id}/buckets/{bucket}"),
        ("PUT", "/portal/users/{user_id}"),
        ("DELETE", "/portal/users/{user_id}"),
    }

    assert removed_routes.isdisjoint(route_keys)
    expected_routes = {
        ("GET", "/portal/access-keys"),
        ("POST", "/portal/access-keys"),
        ("PUT", "/portal/access-keys/{access_key_id}/status"),
        ("DELETE", "/portal/access-keys/{access_key_id}"),
    }
    assert expected_routes.issubset(route_keys)
