# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import importlib.util as import_util
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

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
    PortalPublicLink,
    PortalStorageSpaceGrant,
    PortalStorageSpaceMetadata,
    Project,
    ProjectIAMUser,
    ProjectS3Account,
    QuotaUsageDaily,
    S3Account,
    StorageEndpoint,
    UiGroup,
    UiGroupProject,
    User,
    UserProject,
    UserUiGroup,
    UserS3Account,
)
from app.models.app_settings import AppSettings, PortalSettings, PortalSettingsOverride
from app.models.bucket import Bucket
from app.models.bucket_usage_stats import BucketUsageStatsDistributionEntry, BucketUsageStatsSnapshot
from app.models.iam import AccessKey as IAMAccessKey, IAMGroup, IAMUser
from app.models.portal import (
    PortalAccessKey,
    PortalAccessKeyStatusChange,
    PortalAlert,
    PortalIAMUser,
    PortalState,
    PortalStorageSpace,
    PortalStorageSpaceInitialShare,
    PortalStorageSpaceShare,
    PortalStorageSpaceSummary,
    PortalUsage,
    PortalUsageStorageSpace,
)
from app.routers.dependencies import AccountAccess, AccountCapabilities
from app.routers import portal as portal_router
from app.services import s3_client
from app.services.portal_service import (
    PortalAccessKeyLimitExceeded,
    PortalAccessKeyManagementDisabled,
    PortalAccessKeyProtected,
    PortalService,
)
from app.services.projects_service import ProjectsService
from app.services.bucket_usage_stats_service import BucketUsageStatsService
from app.services.traffic_service import TrafficWindow
from app.utils.time import utcnow


def _portal_access(
    account,
    user,
    role=AccountRole.PORTAL_USER.value,
    can_manage_buckets=False,
    portal_settings_override: PortalSettingsOverride | None = None,
):
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
        portal_settings_override=portal_settings_override,
    )


def _portal_project(db_session, account, *, display_name: str | None = None) -> Project:
    project = Project(name=f"Project {account.name}", description="Portal test project")
    db_session.add(project)
    db_session.flush()
    db_session.add(
        ProjectS3Account(
            project_id=project.id,
            account_id=account.id,
            display_name=display_name or account.name,
        )
    )
    db_session.flush()
    return project


def _project_user(project: Project, user: User, role: str) -> UserProject:
    return UserProject(project_id=project.id, user_id=user.id, account_role=role)


def _project_group(project: Project, group: UiGroup, role: str) -> UiGroupProject:
    return UiGroupProject(project_id=project.id, group_id=group.id, account_role=role)


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


def test_project_iam_users_migration_creates_project_zonegroup_scope(monkeypatch):
    migration_path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0067_project_iam_users.py"
    spec = import_util.spec_from_file_location("migration_0067_project_iam_users", migration_path)
    assert spec is not None and spec.loader is not None
    migration = import_util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite:///:memory:")

    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(migration, "op", operations)

        migration.upgrade()
        inspector = sa.inspect(connection)
        assert "project_iam_users" in inspector.get_table_names()
        columns = {column["name"] for column in inspector.get_columns("project_iam_users")}
        assert {
            "id",
            "user_id",
            "project_id",
            "zonegroup_key",
            "zonegroup_name",
            "authority_account_id",
            "iam_user_id",
            "iam_username",
            "created_at",
            "updated_at",
        } <= columns
        unique_columns = {
            tuple(constraint["column_names"])
            for constraint in inspector.get_unique_constraints("project_iam_users")
        }
        assert ("user_id", "project_id", "zonegroup_key") in unique_columns
        assert "portal_settings_override" not in columns

        migration.downgrade()
        assert "project_iam_users" not in sa.inspect(connection).get_table_names()


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

    policy_calls: dict = {}

    def fake_ensure_policy(iam_svc, iam_username, bucket_name, **kwargs):
        policy_calls["iam_service"] = iam_svc
        policy_calls["iam_username"] = iam_username
        policy_calls["bucket_name"] = bucket_name

    monkeypatch.setattr(service, "_ensure_user_bucket_policy", fake_ensure_policy)

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
    assert len(cors_calls) == 1
    assert cors_calls[0][1]["access_key"] == "ROOT-AK"
    assert cors_calls[0][1]["secret_key"] == "ROOT-SK"
    cors_rules = cors_calls[0][1]["rules"]
    assert isinstance(cors_rules, list) and len(cors_rules) == 1
    assert "Authorization" in (cors_rules[0].get("AllowedHeaders") or [])
    assert policy_calls == {}


def test_ensure_user_bucket_policy_appends_resources(db_session):
    service = PortalService(db_session)

    class FakeIAMService:
        def __init__(self):
            self.policies = {}

        def get_user_inline_policy(self, username, policy_name):
            return self.policies.get((username, policy_name))

        def put_user_inline_policy(self, username, policy_name, policy_document):
            self.policies[(username, policy_name)] = policy_document

    iam = FakeIAMService()
    service._ensure_user_bucket_policy(iam, "portal-iam", "bucket-one")
    service._ensure_user_bucket_policy(iam, "portal-iam", "bucket-two")
    service._ensure_user_bucket_policy(iam, "portal-iam", "bucket-one")

    policy = iam.policies.get(("portal-iam", service._bucket_access_policy_name))
    assert policy is not None
    statements = policy.get("Statement") or []
    bucket_statement = next(
        stmt for stmt in statements if isinstance(stmt, dict) and stmt.get("Sid") == service._bucket_access_sid
    )
    resources = bucket_statement.get("Resource") or []

    assert bucket_statement.get("Action") == service._bucket_access_actions()
    assert f"arn:aws:s3:::bucket-one" in resources
    assert f"arn:aws:s3:::bucket-one/*" in resources
    assert f"arn:aws:s3:::bucket-two" in resources
    assert f"arn:aws:s3:::bucket-two/*" in resources
    assert len([r for r in resources if r == "arn:aws:s3:::bucket-one"]) == 1
    assert len([r for r in resources if r == "arn:aws:s3:::bucket-one/*"]) == 1
    assert policy.get("Version") == "2012-10-17"


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
    monkeypatch.setattr(service, "_ensure_user_bucket_policy", lambda *args, **kwargs: None)

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


def test_portal_user_group_policy_does_not_grant_direct_bucket_creation(db_session):
    service = PortalService(db_session)
    portal_settings = PortalSettings()
    portal_settings.allow_portal_user_bucket_create = True
    portal_settings.iam_group_user_policy.actions = ["s3:ListAllMyBuckets", "sts:GetSessionToken"]
    portal_settings.iam_group_user_policy.advanced_policy = None

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


def test_portal_manager_group_policy_filters_create_bucket_from_advanced_policy(db_session):
    service = PortalService(db_session)
    portal_settings = PortalSettings()
    portal_settings.iam_group_manager_policy.advanced_policy = {
        "Statement": [
            {
                "Effect": "Allow",
                "Action": ["s3:ListAllMyBuckets", "s3:CreateBucket"],
                "Resource": "*",
            }
        ]
    }

    policy = service._resolve_group_policy(portal_settings, "manager")

    assert isinstance(policy, dict)
    statements = policy.get("Statement") or []
    assert isinstance(statements, list) and statements
    actions = statements[0].get("Action") or []
    assert actions == ["s3:ListAllMyBuckets"]


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
            portal_settings=PortalSettings(allow_portal_user_bucket_create=False),
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


def test_get_state_exposes_portal_bucket_quota_limit(monkeypatch, db_session):
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

    class FakeQuotaAdmin:
        def get_account(self, account_id, allow_not_found=False, allow_not_implemented=False):
            assert account_id == "tenant-a"
            assert allow_not_found is True
            assert allow_not_implemented is True
            return {
                "quota": {"enabled": True, "max_size": 2048, "max_objects": 12},
                "limits": {"max_buckets": "4"},
            }

    monkeypatch.setattr(service, "_quota_admin_for_account", lambda acc: FakeQuotaAdmin())
    monkeypatch.setattr(service, "_get_iam_service", lambda *_args, **_kwargs: pytest.fail("IAM should not initialize without a portal link"))

    state = service.get_state(user, access)

    assert state.quota_max_size_bytes == 2048
    assert state.quota_max_objects == 12
    assert state.max_buckets == 4


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


def test_get_state_hides_portal_key_for_portal_user_even_when_setting_enabled(monkeypatch, db_session):
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

    class _FakeIAMService:
        def get_user(self, iam_username):
            return IAMUser(name=iam_username, arn=f"arn:aws:iam:::user/{iam_username}")

        def list_access_keys(self, iam_username):  # noqa: ARG002
            return [
                PortalAccessKey(access_key_id="AK-PORTAL", status="Active", created_at="2026-01-01T00:00:00Z"),
                PortalAccessKey(access_key_id="AK-USER", status="Active", created_at="2026-01-02T00:00:00Z"),
            ]

        def get_user_inline_policy(self, iam_username, policy_name):  # noqa: ARG002
            return None

    monkeypatch.setattr(service, "_effective_portal_settings", lambda acc: PortalSettings(allow_portal_key=True))
    monkeypatch.setattr(service, "_get_iam_service", lambda acc: _FakeIAMService())
    monkeypatch.setattr(service, "_account_quota", lambda acc: (None, None))
    monkeypatch.setattr(s3_client, "list_buckets", lambda **kwargs: [])

    state = service.get_state(user, access)

    assert state.iam_provisioned is True
    assert [key.access_key_id for key in state.access_keys] == ["AK-USER"]
    assert all(not key.is_portal for key in state.access_keys)


def test_access_keys_state_hides_portal_key_and_exposes_policy(monkeypatch, db_session):
    account = S3Account(name="portal-account-keys-state", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-keys-state@example.com", hashed_password="x", role="ui_user")
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
            owner_user_id=user.id,
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
    assert state.can_create_storage_spaces is True


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
    portal_settings = PortalSettings(allow_portal_user_bucket_create=False)
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: portal_settings)

    state = service.get_state(user, access)

    assert state.can_manage_buckets is False
    assert state.can_create_storage_spaces is False


def test_get_state_uses_project_portal_settings_override(db_session):
    account = S3Account(name="portal-project-user-create-disabled", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-project-user-create-disabled@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(
        account,
        user,
        role=AccountRole.PORTAL_USER.value,
        can_manage_buckets=False,
        portal_settings_override=PortalSettingsOverride(allow_portal_user_bucket_create=False),
    )
    service = PortalService(db_session)

    state = service.get_state(user, access)

    assert state.can_manage_buckets is False
    assert state.can_create_storage_spaces is False


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
    assert [key.access_key_id for key in state.access_keys] == ["AK-USER"]


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
            owner_user_id=user.id,
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
    assert spaces[0].role == "Owner"
    assert spaces[0].status == "Shared"
    assert spaces[0].internal_bucket_name == "research-data"
    assert spaces[0].used_bytes is None
    assert spaces[0].object_count is None


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
                owner_label="Lab Team",
                owner_user_id=user.id,
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
        ("research-data", "Genome Project", "Primary sequencing dataset", "Lab Team", "shared")
    ]
    assert [(space.id, space.status) for space in archived] == [("old-data", "Archived")]


def _global_replication_endpoint(name: str, zonegroup: str = "zg-global") -> StorageEndpoint:
    return StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider="ceph",
        ceph_zonegroup_name=zonegroup,
        ceph_zonegroup_global_replication_configured=True,
        features_config="features:\n  iam:\n    enabled: true\n",
    )


def test_project_storage_spaces_include_global_replicas_as_read_only(db_session):
    endpoint_a = _global_replication_endpoint("portal-global-z1")
    endpoint_b = _global_replication_endpoint("portal-global-z2")
    account_a = S3Account(name="portal-global-a", rgw_account_id="portal-global-a", storage_endpoint=endpoint_a)
    account_b = S3Account(name="portal-global-b", rgw_account_id="portal-global-b", storage_endpoint=endpoint_b)
    user = User(email="portal-global@example.com", hashed_password="x", role="ui_user")
    project = Project(name="Portal Global Replication", description=None)
    db_session.add_all([endpoint_a, endpoint_b, account_a, account_b, user, project])
    db_session.flush()
    db_session.add_all(
        [
            ProjectS3Account(project_id=project.id, account_id=account_a.id, display_name="Paris", sort_order=0),
            ProjectS3Account(project_id=project.id, account_id=account_b.id, display_name="Lyon", sort_order=1),
            UserProject(project_id=project.id, user_id=user.id, account_role=AccountRole.PORTAL_MANAGER.value),
            PortalStorageSpaceMetadata(
                account_id=account_a.id,
                bucket_name="research-data",
                display_name="Research Data",
                owner_user_id=user.id,
                visibility="shared",
            ),
        ]
    )
    db_session.commit()

    projects_service = ProjectsService(db_session)
    project_access = projects_service.resolve_portal_project_access(user, project.id)
    service = PortalService(db_session)

    spaces = service.list_project_storage_spaces(
        user,
        [
            (projects_service.account_access_for_project(project_access, link.account_id), link.display_name)
            for link in project_access.account_links
        ],
    )

    assert sorted(
        ((space.id, space.project_account_label, space.role, space.content_role) for space in spaces),
        key=lambda item: item[1],
    ) == [
        (f"a{account_b.id}:research-data", "Lyon", "Viewer", "Viewer"),
        (f"a{account_a.id}:research-data", "Paris", "Owner", "Owner"),
    ]
    replica = next(space for space in spaces if space.account_id == account_b.id)
    assert replica.can_browse is True
    assert replica.description == "Read-only replica of Research Data from Paris."
    assert replica.internal_bucket_name == "research-data"
    assert replica.used_bytes is None


def test_project_global_replica_access_summary_is_read_only(db_session):
    endpoint_a = _global_replication_endpoint("portal-global-summary-z1")
    endpoint_b = _global_replication_endpoint("portal-global-summary-z2")
    account_a = S3Account(name="portal-global-summary-a", rgw_account_id="portal-global-summary-a", storage_endpoint=endpoint_a)
    account_b = S3Account(name="portal-global-summary-b", rgw_account_id="portal-global-summary-b", storage_endpoint=endpoint_b)
    user = User(email="portal-global-summary@example.com", hashed_password="x", role="ui_user")
    project = Project(name="Portal Global Summary", description=None)
    db_session.add_all([endpoint_a, endpoint_b, account_a, account_b, user, project])
    db_session.flush()
    db_session.add_all(
        [
            ProjectS3Account(project_id=project.id, account_id=account_a.id, display_name="Paris", sort_order=0),
            ProjectS3Account(project_id=project.id, account_id=account_b.id, display_name="Lyon", sort_order=1),
            UserProject(project_id=project.id, user_id=user.id, account_role=AccountRole.PORTAL_MANAGER.value),
            PortalStorageSpaceMetadata(
                account_id=account_a.id,
                bucket_name="research-data",
                display_name="Research Data",
                owner_user_id=user.id,
                visibility="shared",
            ),
        ]
    )
    db_session.commit()

    summary = portal_router.portal_project_storage_space_access_summary(
        project.id,
        f"a{account_b.id}:research-data",
        user=user,
        db=db_session,
        service=PortalService(db_session),
    )

    assert summary.mode == "restricted"
    assert summary.owner.user_id == user.id
    assert summary.owner.role == "Owner"
    assert summary.can_manage_access is False
    assert summary.can_create_public_links is False
    assert summary.public_link_count == 0
    assert summary.explicit_shares == []


def test_portal_project_browser_context_resolves_global_replica_account(monkeypatch, db_session):
    from fastapi import Request
    from app.routers.dependencies_internal import portal_access as portal_access_deps

    endpoint_a = _global_replication_endpoint("portal-browser-global-z1")
    endpoint_b = _global_replication_endpoint("portal-browser-global-z2")
    account_a = S3Account(name="portal-browser-global-a", rgw_account_id="portal-browser-global-a", storage_endpoint=endpoint_a)
    account_b = S3Account(name="portal-browser-global-b", rgw_account_id="portal-browser-global-b", storage_endpoint=endpoint_b)
    user = User(email="portal-browser-global@example.com", hashed_password="x", role="ui_user")
    project = Project(name="Portal Browser Global", description=None)
    db_session.add_all([endpoint_a, endpoint_b, account_a, account_b, user, project])
    db_session.flush()
    db_session.add_all(
        [
            ProjectS3Account(project_id=project.id, account_id=account_a.id, display_name="Paris", sort_order=0),
            ProjectS3Account(project_id=project.id, account_id=account_b.id, display_name="Lyon", sort_order=1),
            UserProject(project_id=project.id, user_id=user.id, account_role=AccountRole.PORTAL_MANAGER.value),
            PortalStorageSpaceMetadata(
                account_id=account_a.id,
                bucket_name="research-data",
                display_name="Research Data",
                owner_user_id=user.id,
                visibility="shared",
            ),
        ]
    )
    db_session.commit()
    app_settings = AppSettings()
    app_settings.general.portal_enabled = True
    app_settings.general.browser_portal_enabled = True
    monkeypatch.setattr(portal_access_deps, "load_app_settings", lambda: app_settings)
    monkeypatch.setattr(portal_access_deps, "_validate_portal_account_surface", lambda _account: None)
    monkeypatch.setattr(PortalService, "get_portal_credentials", lambda *_args, **_kwargs: ("AK", "SK"))
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/browser/buckets/research-data/objects",
            "headers": [],
            "query_string": f"portal_project_account_id={account_b.id}".encode(),
            "server": ("testserver", 80),
            "scheme": "http",
        }
    )

    scoped_account = portal_access_deps._resolve_portal_project_browser_context(
        db_session,
        user,
        project.id,
        request=request,
    )

    assert scoped_account.id == account_b.id
    assert scoped_account._portal_allowed_buckets == {"research-data"}
    assert scoped_account._portal_readonly_buckets == {"research-data"}


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
        ("private-data", "Owner", "Private", "private")
    ]
    assert owner_spaces[0].can_browse is True
    assert owner_spaces[0].content_role == "Owner"
    assert other_spaces == []
    assert [(space.id, space.role, space.status) for space in manager_spaces] == [
        ("private-data", "Owner", "Private")
    ]
    assert manager_spaces[0].can_browse is False
    assert manager_spaces[0].content_role is None


def test_portal_manager_content_access_excludes_private_spaces_owned_by_others(monkeypatch, db_session):
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
                owner_user_id=owner.id,
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

    policy = iam.policies[("manager-iam", service._bucket_access_policy_name)]
    assert service._extract_storage_space_access(policy) == {
        "manager-private": "Owner",
    }


def test_portal_manager_cannot_read_private_storage_space_content_owned_by_others(monkeypatch, db_session):
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
    monkeypatch.setattr(
        service,
        "_portal_object_client",
        lambda *_args, **_kwargs: pytest.fail("S3 client should not be opened without content access"),
    )
    access = _portal_access(account, manager, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    with pytest.raises(RuntimeError, match="content access not allowed"):
        service.get_storage_space_object_detail(manager, access, "private-data", "file.txt")
    with pytest.raises(RuntimeError, match="content access not allowed"):
        service.download_storage_space_object(manager, access, "private-data", "file.txt")
    with pytest.raises(RuntimeError, match="content access not allowed"):
        service.delete_storage_space_object(manager, access, "private-data", "file.txt")


def test_portal_browser_allowed_buckets_use_content_access(monkeypatch, db_session):
    from fastapi import Request
    from app.routers.dependencies_internal import portal_access as portal_access_deps

    endpoint = StorageEndpoint(
        name="portal-browser-content-endpoint",
        endpoint_url="https://portal-browser-content.example.test",
        provider="ceph",
        features_config="features:\n  iam:\n    enabled: true\n",
    )
    account = S3Account(name="portal-browser-content", rgw_account_id="tenant-browser", storage_endpoint=endpoint)
    user = User(email="portal-browser-content@example.com", hashed_password="x", role="ui_user")
    project = Project(name="Portal Browser Content", description=None)
    db_session.add_all([endpoint, account, user, project])
    db_session.commit()
    db_session.add_all(
        [
            ProjectS3Account(project_id=project.id, account_id=account.id, display_name="Default", sort_order=0),
            UserProject(user_id=user.id, project_id=project.id, account_role=AccountRole.PORTAL_MANAGER.value),
        ]
    )
    db_session.commit()
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
                role="Owner",
                content_role=None,
                can_browse=False,
                internal_bucket_name="owner-private",
            ),
            PortalStorageSpaceSummary(
                id="shared-data",
                name="Shared Data",
                role="Owner",
                content_role="Owner",
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
    project = _portal_project(db_session, account)
    db_session.add_all(
        [
            _project_user(project, manager, AccountRole.PORTAL_MANAGER.value),
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
    assert "arn:aws:iam:::user/manager-iam" not in allowed_principals
    assert "arn:aws:iam::rgw-policy-account:user/manager-iam" not in allowed_principals
    assert "arn:aws:iam::rgw-policy-account:root" in allowed_principals

    metadata.archived_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    archived_policy = service._storage_space_bucket_policy(account, "research-data", metadata, private_policy)
    assert archived_policy is not None
    assert [stmt["Sid"] for stmt in archived_policy["Statement"]] == ["ExternalRule", service._storage_space_archived_sid]
    archived_principals = _storage_space_policy_principals(archived_policy["Statement"][1])
    assert "arn:aws:iam::rgw-policy-account:root" in archived_principals

    metadata.archived_at = None
    metadata.visibility = "shared"
    restored_policy = service._storage_space_bucket_policy(account, "research-data", metadata, archived_policy)
    assert restored_policy is not None
    assert [stmt["Sid"] for stmt in restored_policy["Statement"]] == ["ExternalRule", service._storage_space_access_sid]
    restored_principals = _storage_space_policy_principals(restored_policy["Statement"][1])
    assert "arn:aws:iam:::user/owner-iam" in restored_principals
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
    project = _portal_project(db_session, account)
    db_session.add_all(
        [
            _project_user(project, direct, AccountRole.PORTAL_USER.value),
            _project_user(project, manager, AccountRole.PORTAL_MANAGER.value),
            _project_user(project, inactive, AccountRole.PORTAL_USER.value),
            _project_group(project, group, AccountRole.PORTAL_USER.value),
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
        owner_user_id=owner.id,
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
    for username in ("owner-iam", "direct-iam", "grouped-iam", "manager-iam"):
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
    project = _portal_project(db_session, account)
    db_session.add_all(
        [
            _project_user(project, viewer, AccountRole.PORTAL_USER.value),
            _project_user(project, editor, AccountRole.PORTAL_USER.value),
            _project_user(project, delegated_owner, AccountRole.PORTAL_MANAGER.value),
            _project_user(project, member_without_grant, AccountRole.PORTAL_USER.value),
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
        owner_user_id=owner.id,
        visibility="shared",
        share_scope="restricted",
    )
    db_session.add(metadata)
    db_session.flush()
    db_session.add_all(
        [
            PortalStorageSpaceGrant(storage_space_metadata_id=metadata.id, user_id=viewer.id, role="Viewer"),
            PortalStorageSpaceGrant(storage_space_metadata_id=metadata.id, user_id=editor.id, role="Editor"),
            PortalStorageSpaceGrant(storage_space_metadata_id=metadata.id, user_id=delegated_owner.id, role="Owner"),
        ]
    )
    db_session.commit()

    service = PortalService(db_session)
    policy = service._storage_space_bucket_policy(account, "restricted-data", metadata, None)
    assert policy is not None
    statement = _storage_space_policy_statement(policy, service._storage_space_access_sid)
    principals = _storage_space_policy_principals(statement)
    for username in ("owner-iam", "viewer-iam", "editor-iam", "delegated-owner-iam"):
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
        owner_user_id=owner.id,
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
            owner_user_id=user.id,
            visibility="shared",
        )
    )
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
    assert visible.role == "Owner"
    assert visible.status == "Shared"
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
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: PortalSettings())
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
    assert metadata.owner_label == user.email
    assert metadata.visibility == "private"
    assert metadata.origin == "portal_generic"
    assert metadata.name_editable is True
    assert storage_space.id == bucket_name


def test_portal_user_can_create_storage_space_when_setting_is_enabled(monkeypatch, db_session):
    account = S3Account(name="portal-storage-user-create", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-user-create@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
    portal_settings = PortalSettings(allow_portal_user_bucket_create=True)
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


def test_portal_user_storage_space_creation_uses_project_override(monkeypatch, db_session):
    account = S3Account(name="portal-storage-project-create", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-project-create@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(
        account,
        user,
        role=AccountRole.PORTAL_USER.value,
        can_manage_buckets=False,
        portal_settings_override=PortalSettingsOverride(allow_portal_user_bucket_create=True),
    )
    service = PortalService(db_session)
    base_settings = PortalSettings(allow_portal_user_bucket_create=False)
    created_buckets = []
    monkeypatch.setattr(service, "_portal_settings", lambda: base_settings)
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
    _bucket_name, applied_settings = created_buckets[0]
    assert applied_settings.allow_portal_user_bucket_create is True


def test_portal_user_cannot_create_shared_storage_space(monkeypatch, db_session):
    account = S3Account(name="portal-storage-user-shared-denied", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-user-shared-denied@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
    portal_settings = PortalSettings(allow_portal_user_bucket_create=True)
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
    portal_settings = PortalSettings(allow_portal_user_bucket_create=False)
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: portal_settings)

    with pytest.raises(RuntimeError, match="Storage Space creation not allowed"):
        service.create_storage_space(user, access, name="Research Data")


def test_portal_manager_creates_private_and_shared_without_user_create_setting(monkeypatch, db_session):
    account = S3Account(name="portal-storage-manager-create", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-manager-create@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    portal_settings = PortalSettings(allow_portal_user_bucket_create=False)
    created_buckets: list[str] = []
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: portal_settings)
    monkeypatch.setattr(service, "_unique_uuid_storage_space_bucket_name", lambda existing: f"bucket-{len(existing) + 1}")
    monkeypatch.setattr(
        service,
        "create_bucket",
        lambda _user, _access, bucket_name, **_kwargs: created_buckets.append(bucket_name),
    )
    monkeypatch.setattr(service, "_sync_storage_space_participant_projections", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_sync_storage_space_bucket_policy", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        service,
        "get_bucket_stats",
        lambda _user, _access, bucket_name: Bucket(name=bucket_name),
    )

    private_space = service.create_storage_space(user, access, name="Private Space", visibility="private")
    shared_space = service.create_storage_space(user, access, name="Shared Space", visibility="shared")

    assert created_buckets == ["bucket-1", "bucket-2"]
    assert private_space.visibility == "private"
    assert shared_space.visibility == "shared"


def test_create_restricted_storage_space_persists_initial_shares_atomically(monkeypatch, db_session):
    account = S3Account(name="portal-storage-initial-shares", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-initial@example.com", hashed_password="x", role="ui_user")
    viewer = User(email="viewer-initial@example.com", hashed_password="x", role="ui_user")
    editor = User(email="editor-initial@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, viewer, editor])
    db_session.commit()
    project = _portal_project(db_session, account)
    db_session.add_all(
        [
            _project_user(project, viewer, AccountRole.PORTAL_USER.value),
            _project_user(project, editor, AccountRole.PORTAL_MANAGER.value),
        ]
    )
    db_session.commit()

    access = _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: PortalSettings())
    monkeypatch.setattr(service, "list_storage_spaces", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(service, "_unique_uuid_storage_space_bucket_name", lambda _existing: "restricted-bucket")
    monkeypatch.setattr(service, "create_bucket", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_sync_storage_space_participant_projections", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_sync_storage_space_bucket_policy", lambda *_args, **_kwargs: None)
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
        (lambda owner, viewer, outsider: [PortalStorageSpaceInitialShare(user_id=owner.id, role="Viewer")], "owner already"),
        (lambda owner, viewer, outsider: [
            PortalStorageSpaceInitialShare(user_id=viewer.id, role="Viewer"),
            PortalStorageSpaceInitialShare(user_id=viewer.id, role="Editor"),
        ], "Duplicate"),
        (lambda owner, viewer, outsider: [PortalStorageSpaceInitialShare(user_id=outsider.id, role="Viewer")], "not allowed"),
    ],
)
def test_create_restricted_storage_space_rejects_invalid_initial_shares_before_bucket(monkeypatch, db_session, shares, message):
    account = S3Account(name=f"portal-storage-invalid-initial-{message}", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email=f"owner-invalid-{message}@example.com", hashed_password="x", role="ui_user")
    viewer = User(email=f"viewer-invalid-{message}@example.com", hashed_password="x", role="ui_user")
    outsider = User(email=f"outsider-invalid-{message}@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, viewer, outsider])
    db_session.commit()
    project = _portal_project(db_session, account)
    db_session.add(_project_user(project, viewer, AccountRole.PORTAL_USER.value))
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
    project = _portal_project(db_session, account)
    db_session.add(_project_user(project, viewer, AccountRole.PORTAL_USER.value))
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
        "_sync_storage_space_participant_projections",
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
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: PortalSettings())
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
    policy_calls = []
    monkeypatch.setattr(s3_client, "list_buckets", lambda **_kwargs: [{"name": "existing-bucket"}])
    monkeypatch.setattr(service, "_get_iam_service", lambda _account: object())
    monkeypatch.setattr(service, "_effective_portal_settings", lambda _account: PortalSettings())
    monkeypatch.setattr(service, "_ensure_portal_user", lambda *_args, **_kwargs: (link, IAMUser(name="portal-iam"), False))
    monkeypatch.setattr(service, "_sync_user_group_membership", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_ensure_policy_and_key", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        service,
        "_ensure_user_bucket_policy",
        lambda _iam_service, iam_username, bucket_name, **_kwargs: policy_calls.append((iam_username, bucket_name)),
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
    assert policy_calls == []
    metadata = (
        db_session.query(PortalStorageSpaceMetadata)
        .filter_by(account_id=account.id, bucket_name="existing-bucket")
        .one()
    )
    assert metadata.display_name == "existing-bucket"
    assert metadata.description == "Imported bucket"
    assert metadata.owner_user_id == user.id
    assert metadata.owner_label == user.email
    assert metadata.visibility == "private"
    assert metadata.origin == "imported"
    assert metadata.name_editable is False


def test_import_restricted_storage_space_persists_initial_shares(monkeypatch, db_session):
    account = S3Account(name="portal-storage-import-restricted", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-import-restricted@example.com", hashed_password="x", role="ui_user")
    viewer = User(email="viewer-import-restricted@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, viewer])
    db_session.commit()
    project = _portal_project(db_session, account)
    db_session.add(_project_user(project, viewer, AccountRole.PORTAL_USER.value))
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
    monkeypatch.setattr(service, "_sync_storage_space_participant_projections", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_sync_storage_space_bucket_policy", lambda *_args, **_kwargs: None)
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
        origin=origin,
        name_editable=False,
    )
    db_session.add(metadata)
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_resolve_storage_space_bucket_name", lambda *_args, **_kwargs: f"{origin}-bucket")
    monkeypatch.setattr(service, "_require_storage_space_owner", lambda *_args, **_kwargs: None)
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
        origin="portal_generic",
        name_editable=True,
    )
    db_session.add(metadata)
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_resolve_storage_space_bucket_name", lambda *_args, **_kwargs: "uuid-bucket")
    monkeypatch.setattr(service, "_require_storage_space_owner", lambda *_args, **_kwargs: None)
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
        owner_user_id=owner.id,
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

    access = _portal_access(account, owner)
    service = PortalService(db_session)
    sync_archived_values = []
    monkeypatch.setattr(service, "_resolve_storage_space_bucket_name", lambda *_args, **_kwargs: "restore-data")
    monkeypatch.setattr(service, "list_existing_user_storage_space_access", lambda *_args, **_kwargs: {"restore-data": "Owner"})
    monkeypatch.setattr(
        service,
        "_sync_storage_space_bucket_policy",
        lambda _account, _bucket_name, metadata_arg: sync_archived_values.append(metadata_arg.archived_at),
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


def test_project_portal_settings_override_applies_only_to_project_context(monkeypatch, db_session):
    account = S3Account(
        name="portal-storage-override",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    project = Project(
        name="Project portal overrides",
        description=None,
        portal_settings_override=json.dumps(
            {
                "admin": {"allow_portal_user_bucket_create": False},
                "portal_manager": {
                    "allow_portal_named_bucket_create": True,
                    "allow_portal_user_access_key_create": False,
                    "bucket_defaults": {"enable_cors": False},
                },
            }
        ),
    )
    db_session.add_all([account, project])
    db_session.commit()

    base = PortalSettings()
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_portal_settings", lambda: base)

    effective = service.get_effective_portal_settings(account)
    assert effective.allow_portal_user_bucket_create is True
    assert effective.allow_portal_named_bucket_create is False
    assert effective.allow_portal_user_access_key_create is True
    assert effective.bucket_defaults.enable_cors is True

    project_settings = service.get_portal_project_settings(project).model_dump(exclude_unset=True)
    assert project_settings["admin_override"]["allow_portal_user_bucket_create"] is False
    assert project_settings["effective"]["allow_portal_user_bucket_create"] is False
    assert "portal_manager_override" not in project_settings
    assert "override_policy" not in project_settings

    project_access = _portal_access(
        account,
        User(email="project-override-user@example.test", hashed_password="x", role="ui_user"),
        portal_settings_override=PortalSettingsOverride.model_validate(project_settings["admin_override"]),
    )
    project_effective = service._effective_portal_settings_for_access(project_access)
    assert project_effective.allow_portal_user_bucket_create is False

    service.update_admin_project_portal_settings_override(
        project,
        PortalSettingsOverride(
            allow_portal_user_bucket_create=True,
            bucket_defaults={"enable_cors": False},
        ),
    )
    db_session.refresh(project)
    stored = json.loads(project.portal_settings_override)
    assert stored == {"admin": {"allow_portal_user_bucket_create": True, "bucket_defaults": {"enable_cors": False}}}
    assert service.get_effective_portal_settings(account).bucket_defaults.enable_cors is True
    assert service.get_portal_project_settings(project).effective.bucket_defaults.enable_cors is False


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


def test_portal_iam_service_uses_zonegroup_primary_endpoint(monkeypatch, db_session):
    features_config = "features:\n  iam:\n    enabled: true\n"
    primary = StorageEndpoint(
        name="s3-z1",
        endpoint_url="https://s3-z1.example.test",
        provider="ceph",
        region="zonegroup-region",
        verify_tls=False,
        ceph_zonegroup_name="zg-lab",
        features_config=features_config,
    )
    secondary = StorageEndpoint(
        name="s3-z2",
        endpoint_url="https://s3-z2.example.test",
        provider="ceph",
        region="zonegroup-region",
        verify_tls=True,
        ceph_zonegroup_name="zg-lab",
        features_config=features_config,
    )
    db_session.add_all([primary, secondary])
    db_session.flush()
    account = S3Account(
        name="portal-zonegroup-account",
        rgw_account_id="RGW-ZONEGROUP",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
        storage_endpoint_id=secondary.id,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    captured = {}
    fake_iam_service = object()

    def fake_get_iam_service(access_key, secret_key, **kwargs):
        captured["access_key"] = access_key
        captured["secret_key"] = secret_key
        captured["kwargs"] = kwargs
        return fake_iam_service

    monkeypatch.setattr("app.services.portal.iam.get_iam_service", fake_get_iam_service)

    service = PortalService(db_session)

    assert service._get_iam_service(account) is fake_iam_service
    assert captured == {
        "access_key": "ROOT-AK",
        "secret_key": "ROOT-SK",
        "kwargs": {
            "endpoint": "https://s3-z1.example.test",
            "region": "zonegroup-region",
            "verify_tls": False,
        },
    }
    assert service._s3_client_kwargs(account)["endpoint"] == "https://s3-z2.example.test"


def test_storage_space_role_matrix_for_files_shares_and_portal_settings(monkeypatch, db_session):
    account = S3Account(name="portal-role-matrix", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    actor = User(email="matrix-actor@example.com", hashed_password="x", role="ui_user")
    target = User(email="matrix-target@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, actor, target])
    db_session.commit()
    project = _portal_project(db_session, account)
    db_session.add_all(
        [
            _project_user(project, target, AccountRole.PORTAL_USER.value),
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

        if can_share:
            share = service.set_storage_space_share(actor, access, target, "research-data", "Viewer")
            assert share.email == target.email
        else:
            with pytest.raises(RuntimeError, match="Owner role required"):
                service.set_storage_space_share(actor, access, target, "research-data", "Viewer")

    assert_file_capabilities("Viewer", can_write=False, can_share=False)
    assert_file_capabilities("Editor", can_write=True, can_share=False)
    assert_file_capabilities("Owner", can_write=True, can_share=True)
    target_grant = (
        db_session.query(PortalStorageSpaceGrant)
        .filter_by(storage_space_metadata_id=metadata.id, user_id=target.id)
        .one()
    )
    assert target_grant.role == "Viewer"
    target_policy = iam_service.policies[(f"iam-{target.id}", service._bucket_access_policy_name)]
    assert service._extract_storage_space_access(target_policy) == {"bucket-research-data": "Viewer"}
    assert ("GET", "/portal/settings") not in {
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
            owner_user_id=user.id,
            visibility="shared",
        )
    )
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
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

    service._set_user_storage_space_policy(iam, "portal-iam", "research-data", "Viewer")
    policy = iam.policies[("portal-iam", service._bucket_access_policy_name)]
    access = service._extract_storage_space_access(policy)

    assert access == {"research-data": "Viewer"}
    viewer_statement = next(stmt for stmt in policy["Statement"] if stmt["Sid"] == "PortalStorageSpaceViewer")
    assert viewer_statement["Action"] == ["s3:GetBucketLocation", "s3:ListBucket", "s3:GetObject"]

    service._set_user_storage_space_policy(iam, "portal-iam", "research-data", "Editor")
    policy = iam.policies[("portal-iam", service._bucket_access_policy_name)]
    access = service._extract_storage_space_access(policy)

    assert access == {"research-data": "Editor"}
    assert not any(stmt["Sid"] == "PortalStorageSpaceViewer" for stmt in policy["Statement"])
    editor_statement = next(stmt for stmt in policy["Statement"] if stmt["Sid"] == "PortalStorageSpaceEditor")
    assert "s3:PutObject" in editor_statement["Action"]
    assert "s3:DeleteObject" in editor_statement["Action"]
    assert "s3:AbortMultipartUpload" in editor_statement["Action"]
    assert "s3:ListBucketMultipartUploads" in editor_statement["Action"]
    assert "s3:ListMultipartUploadParts" in editor_statement["Action"]

    service._set_user_storage_space_policy(iam, "portal-iam", "research-data", "Owner")
    policy = iam.policies[("portal-iam", service._bucket_access_policy_name)]
    access = service._extract_storage_space_access(policy)

    assert access == {"research-data": "Owner"}
    owner_statement = next(stmt for stmt in policy["Statement"] if stmt["Sid"] == "PortalStorageSpaceOwner")
    assert owner_statement["Action"] == service._storage_space_policy_actions()
    assert "s3:*" not in owner_statement["Action"]


def test_iam_compliance_detects_and_repairs_broad_storage_space_owner_policy(monkeypatch, db_session):
    account = S3Account(name="portal-owner-compliance", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-compliance@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner])
    db_session.commit()
    project = _portal_project(db_session, account)
    db_session.add_all(
        [
            _project_user(project, owner, AccountRole.PORTAL_USER.value),
            AccountIAMUser(
                user_id=owner.id,
                account_id=account.id,
                iam_user_id="owner-iam-id",
                iam_username="owner-iam",
            ),
            PortalStorageSpaceMetadata(
                account_id=account.id,
                bucket_name="research-data",
                display_name="Research Data",
                owner_user_id=owner.id,
                visibility="private",
            ),
        ]
    )
    db_session.commit()

    service = PortalService(db_session)

    class FakeIAMService:
        def __init__(self):
            self.policies = {
                ("owner-iam", service._bucket_access_policy_name): {
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Sid": service._storage_space_share_sid("Owner"),
                            "Effect": "Allow",
                            "Action": ["s3:*"],
                            "Resource": service._bucket_arns("research-data"),
                        }
                    ],
                }
            }
            self.group_policies = {
                (service._manager_group_name, service._manager_group_policy_name): service._resolve_group_policy(
                    PortalSettings(), "manager"
                ),
                (service._user_group_name, service._inline_policy_name): service._resolve_group_policy(
                    PortalSettings(), "user"
                ),
            }

        def list_groups(self):
            return [IAMGroup(name=service._manager_group_name), IAMGroup(name=service._user_group_name)]

        def list_group_policies(self, group_name):  # noqa: ARG002
            return []

        def get_group_inline_policy(self, group_name, policy_name):
            return self.group_policies.get((group_name, policy_name))

        def list_groups_for_user(self, iam_username):  # noqa: ARG002
            return [IAMGroup(name=service._user_group_name)]

        def get_user_inline_policy(self, username, policy_name):
            return self.policies.get((username, policy_name))

        def put_user_inline_policy(self, username, policy_name, policy_document):
            self.policies[(username, policy_name)] = policy_document

        def delete_user_inline_policy(self, username, policy_name):
            self.policies.pop((username, policy_name), None)

    iam = FakeIAMService()
    monkeypatch.setattr(service, "_get_iam_service", lambda acc: iam)
    monkeypatch.setattr(service, "_effective_portal_settings", lambda acc: PortalSettings())

    report = service.check_iam_compliance(account)

    assert report.ok is False
    assert any("Actions IAM divergentes" in issue.message for issue in report.issues)

    monkeypatch.setattr(service, "_ensure_portal_groups", lambda *args, **kwargs: None)
    monkeypatch.setattr(service, "_sync_user_group_membership", lambda *args, **kwargs: None)
    monkeypatch.setattr(service, "_sync_account_storage_space_bucket_policies", lambda *args, **kwargs: None)

    repaired = service.apply_iam_compliance(account)
    policy = iam.policies[("owner-iam", service._bucket_access_policy_name)]
    owner_statement = next(
        stmt for stmt in policy["Statement"] if stmt["Sid"] == service._storage_space_share_sid("Owner")
    )

    assert repaired.ok is True
    assert owner_statement["Action"] == service._storage_space_policy_actions()
    assert "s3:*" not in owner_statement["Action"]


def test_list_storage_space_shares_uses_db_grants(monkeypatch, db_session):
    account = S3Account(name="portal-share-list", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner@example.com", hashed_password="x", role="ui_user")
    viewer = User(email="viewer@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, viewer])
    db_session.commit()
    project = _portal_project(db_session, account)
    db_session.add_all(
        [
            _project_user(project, owner, AccountRole.PORTAL_MANAGER.value),
            _project_user(project, viewer, AccountRole.PORTAL_USER.value),
        ]
    )
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="research-data",
        display_name="Research Data",
        owner_user_id=owner.id,
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
    project = _portal_project(db_session, account)
    db_session.add_all(
        [
            _project_user(project, member, AccountRole.PORTAL_USER.value),
            _project_user(project, manager, AccountRole.PORTAL_MANAGER.value),
        ]
    )
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="team-data",
        display_name="Team Data",
        owner_user_id=owner.id,
        visibility="shared",
        share_scope="account",
        account_member_role="Editor",
    )
    db_session.add(metadata)
    db_session.commit()

    service = PortalService(db_session)

    assert service.list_existing_user_storage_space_content_access(
        member,
        account,
        AccountRole.PORTAL_USER.value,
    ) == {"team-data": "Editor"}
    assert service.list_existing_user_storage_space_content_access(
        manager,
        account,
        AccountRole.PORTAL_MANAGER.value,
    ) == {"team-data": "Editor"}

    db_session.add(
        PortalStorageSpaceGrant(
            storage_space_metadata_id=metadata.id,
            user_id=member.id,
            role="Owner",
            created_by_user_id=owner.id,
        )
    )
    db_session.commit()

    assert service.list_existing_user_storage_space_content_access(
        member,
        account,
        AccountRole.PORTAL_USER.value,
    ) == {"team-data": "Owner"}


def test_storage_space_share_candidates_use_effective_portal_members(monkeypatch, db_session):
    account = S3Account(name="portal-share-candidates", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-candidates@example.com", hashed_password="x", role="ui_user")
    direct = User(email="direct-candidates@example.com", hashed_password="x", role="ui_user")
    grouped = User(email="grouped-candidates@example.com", hashed_password="x", role="ui_user")
    outsider = User(email="outsider-candidates@example.com", hashed_password="x", role="ui_user")
    group = UiGroup(name="Portal group")
    db_session.add_all([account, owner, direct, grouped, outsider, group])
    db_session.commit()
    project = _portal_project(db_session, account)
    db_session.add_all(
        [
            _project_user(project, owner, AccountRole.PORTAL_MANAGER.value),
            _project_user(project, direct, AccountRole.PORTAL_USER.value),
            _project_group(project, group, AccountRole.PORTAL_MANAGER.value),
            UserUiGroup(user_id=grouped.id, group_id=group.id),
        ]
    )
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="research-data",
        display_name="Research Data",
        owner_user_id=owner.id,
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
        ("grouped-candidates@example.com", "portal_manager", "group", False),
    ]
    assert all(candidate.email != outsider.email for candidate in candidates)


def test_storage_space_access_summary_reflects_modes_counts_and_manager_access(monkeypatch, db_session):
    account = S3Account(name="portal-access-summary", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-access-summary@example.com", display_name="Owner Summary", hashed_password="x", role="ui_user")
    member = User(email="member-access-summary@example.com", hashed_password="x", role="ui_user")
    manager = User(email="manager-access-summary@example.com", hashed_password="x", role="ui_user")
    outsider = User(email="outsider-access-summary@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, member, manager, outsider])
    db_session.commit()
    project = _portal_project(db_session, account)
    db_session.add_all(
        [
            _project_user(project, member, AccountRole.PORTAL_USER.value),
            _project_user(project, manager, AccountRole.PORTAL_MANAGER.value),
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
        owner_user_id=owner.id,
        visibility="shared",
        share_scope="account",
        account_member_role="Viewer",
    )
    restricted_metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="restricted-data",
        display_name="Restricted Data",
        owner_user_id=owner.id,
        visibility="shared",
        share_scope="restricted",
    )
    archived_metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="archived-data",
        display_name="Archived Data",
        owner_user_id=owner.id,
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
                role="Owner",
                content_role="Owner",
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
    all_summary = service.get_storage_space_access_summary(owner, owner_access, "all-data")
    restricted_summary = service.get_storage_space_access_summary(owner, owner_access, "restricted-data")
    archived_summary = service.get_storage_space_access_summary(owner, owner_access, "archived-data")
    manager_summary = service.get_storage_space_access_summary(manager, manager_access, "restricted-data")

    assert private_summary.mode == "private"
    assert private_summary.effective_member_count == 1
    assert private_summary.owner.email == owner.email
    assert private_summary.can_manage_access is True

    assert all_summary.mode == "all"
    assert all_summary.default_account_member_role == "Viewer"
    assert all_summary.effective_member_count == 3

    assert restricted_summary.mode == "restricted"
    assert restricted_summary.effective_member_count == 2
    assert [(share.email, share.role) for share in restricted_summary.explicit_shares] == [(member.email, "Editor")]
    assert restricted_summary.public_link_count == 1
    assert restricted_summary.can_create_public_links is True

    assert archived_summary.mode == "restricted"
    assert archived_summary.effective_member_count == 0
    assert archived_summary.can_manage_access is False

    assert manager_summary.can_manage_access is True
    assert manager_summary.owner.email == owner.email


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
        owner_user_id=owner.id,
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

    with pytest.raises(RuntimeError, match="not allowed for this Portal account"):
        service.set_storage_space_share(owner, owner_access, target, "research-data", "Viewer")

    assert db_session.query(PortalStorageSpaceGrant).filter_by(storage_space_metadata_id=metadata.id).all() == []
    assert db_session.query(UserS3Account).filter_by(user_id=target.id, account_id=account.id).first() is None


def test_set_storage_space_share_rolls_back_db_grant_when_projection_fails(monkeypatch, db_session):
    account = S3Account(name="portal-share-rollback", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-rollback@example.com", hashed_password="x", role="ui_user")
    target = User(email="target-rollback@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, target])
    db_session.commit()
    project = _portal_project(db_session, account)
    db_session.add_all(
        [
            _project_user(project, target, AccountRole.PORTAL_USER.value),
            AccountIAMUser(user_id=target.id, account_id=account.id, iam_user_id="target-iam", iam_username="target-iam"),
        ]
    )
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="research-data",
        display_name="Research Data",
        owner_user_id=owner.id,
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
    project = _portal_project(db_session, account)
    db_session.add_all(
        [
            _project_user(project, target, AccountRole.PORTAL_USER.value),
            AccountIAMUser(user_id=target.id, account_id=account.id, iam_user_id="target-iam", iam_username="target-iam"),
        ]
    )
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="research-data",
        display_name="Research Data",
        owner_user_id=owner.id,
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
    bucket_policy_syncs = []
    monkeypatch.setattr(
        service,
        "_sync_storage_space_bucket_policy",
        lambda account_arg, bucket_name, metadata_arg: bucket_policy_syncs.append(
            (account_arg.id, bucket_name, metadata_arg.id)
        ),
    )
    owner_access = _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    service.set_storage_space_share(owner, owner_access, target, "research-data", "Viewer")
    service.revoke_storage_space_share(owner, owner_access, target, "research-data")

    assert bucket_policy_syncs == [
        (account.id, "research-data", metadata.id),
        (account.id, "research-data", metadata.id),
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
            owner_user_id=owner.id,
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
            owner_user_id=owner.id,
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
                owner_user_id=owner.id,
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
                owner_user_id=user.id,
                visibility="shared",
            ),
            PortalStorageSpaceMetadata(
                account_id=account.id,
                bucket_name="archive",
                owner_user_id=user.id,
                visibility="shared",
            ),
        ]
    )
    db_session.commit()
    service = PortalService(db_session)
    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    monkeypatch.setattr(service, "_account_quota", lambda _account: (1_000, 100))
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

    monkeypatch.setattr(service, "_account_quota", lambda _account: (2_000, 200))
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


def test_portal_project_usage_exposes_account_breakdown(monkeypatch, db_session):
    endpoint = StorageEndpoint(
        name="portal-project-usage-endpoint",
        endpoint_url="https://portal-project-usage.example.test",
        provider="ceph",
        ceph_zonegroup_name="zg-eu",
        features_config=(
            "features:\n"
            "  iam:\n"
            "    enabled: true\n"
            "  metrics:\n"
            "    enabled: true\n"
        ),
    )
    account_a = S3Account(
        name="portal-project-usage-a",
        rgw_account_id="tenant-a",
        rgw_access_key="ROOT-AK-A",
        rgw_secret_key="ROOT-SK-A",
        storage_endpoint=endpoint,
    )
    account_b = S3Account(
        name="portal-project-usage-b",
        rgw_account_id="tenant-b",
        rgw_access_key="ROOT-AK-B",
        rgw_secret_key="ROOT-SK-B",
        storage_endpoint=endpoint,
    )
    user = User(email="project-usage@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([endpoint, account_a, account_b, user])
    db_session.commit()
    project = _portal_project(db_session, account_a, display_name="Paris")
    db_session.add_all(
        [
            ProjectS3Account(project_id=project.id, account_id=account_b.id, display_name="Lyon", sort_order=1),
            _project_user(project, user, AccountRole.PORTAL_USER.value),
        ]
    )
    db_session.commit()

    service = PortalService(db_session)

    def fake_get_usage(_user, access):
        if access.account.id == account_a.id:
            return PortalUsage(
                used_bytes=900,
                used_objects=90,
                quota_max_size_bytes=1000,
                quota_max_objects=100,
                storage_spaces=[
                    PortalUsageStorageSpace(id="space-a", name="Space A", used_bytes=450, object_count=45),
                ],
            )
        return PortalUsage(
            used_bytes=120,
            used_objects=12,
            quota_max_size_bytes=1000,
            quota_max_objects=100,
            storage_spaces=[
                PortalUsageStorageSpace(id="space-b", name="Space B", used_bytes=120, object_count=12),
            ],
        )

    monkeypatch.setattr(service, "get_usage", fake_get_usage)

    payload = portal_router.portal_project_usage(
        project_id=project.id,
        user=user,
        db=db_session,
        service=service,
    )

    assert payload.used_bytes == 1020
    assert payload.used_objects == 102
    assert [(item.display_name, item.used_bytes, item.quota_max_size_bytes) for item in payload.accounts] == [
        ("Paris", 900, 1000),
        ("Lyon", 120, 1000),
    ]
    assert payload.accounts[0].storage_endpoint_zonegroup == "zg-eu"
    assert [(space.id, space.project_account_label, space.used_bytes) for space in payload.storage_spaces] == [
        (f"a{account_a.id}:space-a", "Paris", 450),
        (f"a{account_b.id}:space-b", "Lyon", 120),
    ]


def test_portal_project_account_usage_trends_are_filtered_by_project(monkeypatch, db_session):
    monkeypatch.setattr(portal_router, "load_app_settings", lambda: _usage_history_settings(True))
    endpoint = StorageEndpoint(
        name="portal-project-history-endpoint",
        endpoint_url="https://portal-project-history.example.test",
        provider="ceph",
        ceph_zonegroup_name="zg-eu",
        features_config=(
            "features:\n"
            "  iam:\n"
            "    enabled: true\n"
        ),
    )
    account_a = S3Account(name="portal-project-history-a", rgw_account_id="tenant-a", storage_endpoint=endpoint)
    account_b = S3Account(name="portal-project-history-b", rgw_account_id="tenant-b", storage_endpoint=endpoint)
    other_account = S3Account(name="portal-project-history-other", rgw_account_id="tenant-other", storage_endpoint=endpoint)
    user = User(email="project-history@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([endpoint, account_a, account_b, other_account, user])
    db_session.commit()
    project = _portal_project(db_session, account_a, display_name="Paris")
    db_session.add_all(
        [
            ProjectS3Account(project_id=project.id, account_id=account_b.id, display_name="Lyon", sort_order=1),
            _project_user(project, user, AccountRole.PORTAL_USER.value),
        ]
    )
    today = utcnow().date()
    db_session.add_all(
        [
            QuotaUsageDaily(
                day=today,
                storage_endpoint_id=endpoint.id,
                s3_account_id=account_a.id,
                last_used_bytes=900,
                last_used_objects=90,
                bucket_count=2,
                updated_at=datetime.combine(today, datetime.min.time()),
            ),
            QuotaUsageDaily(
                day=today,
                storage_endpoint_id=endpoint.id,
                s3_account_id=account_b.id,
                last_used_bytes=120,
                last_used_objects=12,
                bucket_count=1,
                updated_at=datetime.combine(today, datetime.min.time()),
            ),
            QuotaUsageDaily(
                day=today,
                storage_endpoint_id=endpoint.id,
                s3_account_id=other_account.id,
                last_used_bytes=999,
                last_used_objects=99,
                bucket_count=9,
                updated_at=datetime.combine(today, datetime.min.time()),
            ),
        ]
    )
    db_session.commit()

    payload = portal_router.portal_project_account_usage_trends(
        project_id=project.id,
        window="month",
        user=user,
        db=db_session,
    )

    assert payload.available is True
    assert [(item.display_name, item.trend.summary.latest_used_bytes) for item in payload.accounts] == [
        ("Paris", 900),
        ("Lyon", 120),
    ]
    assert payload.accounts[0].trend.summary.latest_bucket_count == 2
    assert payload.accounts[1].trend.summary.latest_used_objects == 12


def test_portal_usage_trends_exposes_scoped_account_baselines(monkeypatch, db_session):
    monkeypatch.setattr(portal_router, "load_app_settings", lambda: _usage_history_settings(True))
    monkeypatch.setattr(portal_router, "utcnow", lambda: datetime(2026, 6, 9, 12, 0, 0))
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
                updated_at=datetime(2026, 5, 10, 12, 0, 0),
            ),
            QuotaUsageDaily(
                day=date(2026, 5, 10),
                storage_endpoint_id=endpoint.id,
                s3_account_id=other_account.id,
                last_used_bytes=999,
                last_used_objects=99,
                bucket_count=9,
                updated_at=datetime(2026, 5, 10, 12, 0, 0),
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
                updated_at=datetime.combine(today, datetime.min.time()),
            ),
            QuotaUsageDaily(
                day=today,
                storage_endpoint_id=endpoint.id,
                s3_account_id=other_account.id,
                last_used_bytes=999,
                last_used_objects=99,
                bucket_count=9,
                updated_at=datetime.combine(today, datetime.min.time()),
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
            expires_at=(datetime.now(timezone.utc) + timedelta(days=1)).replace(tzinfo=None),
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
            expires_at=(datetime.now(timezone.utc) + timedelta(days=1)).replace(tzinfo=None),
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
            owner_user_id=user.id,
            visibility="shared",
        )
    )
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
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


class _ProjectIAMFakeService:
    def __init__(self):
        self.users: dict[str, IAMUser] = {}
        self.keys: dict[str, list[IAMAccessKey]] = {}
        self.user_policies: dict[tuple[str, str], dict] = {}
        self.group_users: dict[str, set[str]] = {}
        self.key_counter = 0
        self.status_updates: list[tuple[str, str, str]] = []
        self.deleted_policies: list[tuple[str, str]] = []

    def get_user(self, username):
        return self.users.get(username)

    def create_user(self, username, *, create_key=False, allow_existing=False):  # noqa: ARG002
        user = self.users.setdefault(username, IAMUser(name=username, arn=f"arn:aws:iam:::user/{username}", user_id=f"id-{username}"))
        created_key = self.create_access_key(username) if create_key else None
        return user, created_key

    def list_access_keys(self, username):
        return list(self.keys.get(username, []))

    def create_access_key(self, username):
        self.key_counter += 1
        key = IAMAccessKey(
            access_key_id=f"AK-PROJECT-{self.key_counter}",
            secret_access_key=f"SK-PROJECT-{self.key_counter}",
            status="Active",
            created_at=f"2026-06-{self.key_counter:02d}T00:00:00Z",
        )
        self.keys.setdefault(username, []).append(key)
        return key

    def update_access_key_status(self, username, access_key_id, status):
        self.status_updates.append((username, access_key_id, status))
        for key in self.keys.get(username, []):
            if key.access_key_id == access_key_id:
                key.status = status

    def delete_access_key(self, username, access_key_id):
        self.keys[username] = [key for key in self.keys.get(username, []) if key.access_key_id != access_key_id]

    def list_groups(self):
        return [IAMGroup(name=name) for name in self.group_users]

    def create_group(self, group_name):
        self.group_users.setdefault(group_name, set())
        return IAMGroup(name=group_name)

    def list_group_policies(self, group_name):  # noqa: ARG002
        return []

    def detach_group_policy(self, group_name, policy_arn):  # noqa: ARG002
        return None

    def put_group_inline_policy(self, group_name, policy_name, policy_document):  # noqa: ARG002
        return None

    def delete_group_inline_policy(self, group_name, policy_name):  # noqa: ARG002
        return None

    def list_group_users(self, group_name):
        return [IAMUser(name=username) for username in sorted(self.group_users.get(group_name, set()))]

    def add_user_to_group(self, group_name, username):
        self.group_users.setdefault(group_name, set()).add(username)

    def remove_user_from_group(self, group_name, username):
        self.group_users.setdefault(group_name, set()).discard(username)

    def get_user_inline_policy(self, username, policy_name):
        return self.user_policies.get((username, policy_name))

    def put_user_inline_policy(self, username, policy_name, policy_document):
        self.user_policies[(username, policy_name)] = policy_document

    def delete_user_inline_policy(self, username, policy_name):
        self.deleted_policies.append((username, policy_name))
        self.user_policies.pop((username, policy_name), None)


def _project_iam_endpoint(name: str, zonegroup: str | None) -> StorageEndpoint:
    return StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider="ceph",
        ceph_zonegroup_name=zonegroup,
        features_config="features:\n  iam:\n    enabled: true\n",
    )


def test_project_access_keys_state_groups_accounts_by_zonegroup(monkeypatch, db_session):
    endpoint_a = _project_iam_endpoint("zg-state-a", "zg-main")
    endpoint_b = _project_iam_endpoint("zg-state-b", "ZG-Main")
    endpoint_without_zonegroup = _project_iam_endpoint("zg-state-missing", None)
    account_a = S3Account(
        name="portal-project-zg-a",
        rgw_account_id="rgw-zg-a",
        rgw_access_key="ROOT-AK-A",
        rgw_secret_key="ROOT-SK-A",
        storage_endpoint=endpoint_a,
    )
    account_b = S3Account(
        name="portal-project-zg-b",
        rgw_account_id="rgw-zg-b",
        rgw_access_key="ROOT-AK-B",
        rgw_secret_key="ROOT-SK-B",
        storage_endpoint=endpoint_b,
    )
    account_missing = S3Account(
        name="portal-project-zg-missing",
        rgw_account_id="rgw-zg-missing",
        rgw_access_key="ROOT-AK-C",
        rgw_secret_key="ROOT-SK-C",
        storage_endpoint=endpoint_without_zonegroup,
    )
    user = User(email="portal-project-zg@example.com", hashed_password="x", role="ui_user")
    project = Project(name="Project ZG", description="zonegroup test")
    db_session.add_all([endpoint_a, endpoint_b, endpoint_without_zonegroup, account_a, account_b, account_missing, user, project])
    db_session.flush()
    db_session.add_all(
        [
            ProjectS3Account(project_id=project.id, account_id=account_a.id, display_name="Paris", sort_order=0),
            ProjectS3Account(project_id=project.id, account_id=account_b.id, display_name="Lyon", sort_order=1),
            ProjectS3Account(project_id=project.id, account_id=account_missing.id, display_name="Missing", sort_order=2),
            UserProject(project_id=project.id, user_id=user.id, account_role=AccountRole.PORTAL_USER.value),
        ]
    )
    db_session.commit()

    service = PortalService(db_session)
    monkeypatch.setattr(service, "_get_iam_service", lambda _account: pytest.fail("IAM should not initialize without a project IAM link"))
    access = ProjectsService(db_session).resolve_portal_project_access(user, project.id)

    state = service.get_project_access_keys_state(user, access)

    assert len(state.scopes) == 2
    zone_scope = next(scope for scope in state.scopes if scope.zonegroup == "zg-main")
    assert zone_scope.can_manage_access_keys is True
    assert zone_scope.max_access_keys >= 1
    assert {account.account_id for account in zone_scope.accounts} == {account_a.id, account_b.id}
    unavailable_scope = next(scope for scope in state.scopes if scope.unavailable_reason)
    assert unavailable_scope.label == "Missing"
    assert unavailable_scope.can_manage_access_keys is False
    assert "zonegroup" in unavailable_scope.unavailable_reason.lower()


def test_project_access_key_creation_uses_one_iam_user_per_zonegroup(monkeypatch, db_session):
    endpoint_a = _project_iam_endpoint("zg-create-a", "zg-main")
    endpoint_b = _project_iam_endpoint("zg-create-b", "zg-main")
    account_a = S3Account(
        name="portal-project-create-a",
        rgw_account_id="rgw-create-a",
        rgw_access_key="ROOT-AK-A",
        rgw_secret_key="ROOT-SK-A",
        storage_endpoint=endpoint_a,
    )
    account_b = S3Account(
        name="portal-project-create-b",
        rgw_account_id="rgw-create-b",
        rgw_access_key="ROOT-AK-B",
        rgw_secret_key="ROOT-SK-B",
        storage_endpoint=endpoint_b,
    )
    user = User(email="portal-project-create@example.com", hashed_password="x", role="ui_user")
    project = Project(name="Project Create", description="create test")
    db_session.add_all([endpoint_a, endpoint_b, account_a, account_b, user, project])
    db_session.flush()
    db_session.add_all(
        [
            ProjectS3Account(project_id=project.id, account_id=account_a.id, display_name="Paris", sort_order=0),
            ProjectS3Account(project_id=project.id, account_id=account_b.id, display_name="Lyon", sort_order=1),
            UserProject(project_id=project.id, user_id=user.id, account_role=AccountRole.PORTAL_USER.value),
            PortalStorageSpaceMetadata(
                account_id=account_a.id,
                bucket_name="owned-space",
                owner_user_id=user.id,
                visibility="private",
            ),
        ]
    )
    db_session.flush()
    shared = PortalStorageSpaceMetadata(
        account_id=account_b.id,
        bucket_name="shared-space",
        owner_user_id=None,
        visibility="shared",
        share_scope="restricted",
    )
    db_session.add(shared)
    db_session.flush()
    db_session.add(PortalStorageSpaceGrant(storage_space_metadata_id=shared.id, user_id=user.id, role="Viewer"))
    db_session.commit()

    fake_iam = _ProjectIAMFakeService()
    synced_accounts: list[int] = []
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_get_iam_service", lambda _account: fake_iam)
    monkeypatch.setattr(service, "_sync_account_storage_space_bucket_policies", lambda account: synced_accounts.append(account.id))
    access = ProjectsService(db_session).resolve_portal_project_access(user, project.id)
    scope_id = service.get_project_access_keys_state(user, access).scopes[0].scope_id

    created = service.create_project_access_key(user, access, scope_id)

    link = db_session.query(ProjectIAMUser).filter_by(user_id=user.id, project_id=project.id).one()
    assert link.authority_account_id == account_a.id
    assert link.iam_username in fake_iam.users
    assert created.access_key_id == "AK-PROJECT-1"
    assert created.secret_access_key == "SK-PROJECT-1"
    assert len(fake_iam.keys[link.iam_username]) == 1
    assert set(synced_accounts) == {account_a.id, account_b.id}
    policy = fake_iam.user_policies[(link.iam_username, service._bucket_access_policy_name)]
    policy_json = json.dumps(policy)
    assert "owned-space" in policy_json
    assert "shared-space" in policy_json
    assert "portal-user" in fake_iam.group_users
    assert link.iam_username in fake_iam.group_users["portal-user"]

    monkeypatch.setattr(
        service,
        "_project_portal_settings",
        lambda _access, _authority: PortalSettings(allow_portal_user_access_key_create=False, max_portal_user_access_keys=2),
    )
    disabled_state = service.get_project_access_keys_state(user, access).scopes[0]
    assert disabled_state.can_manage_access_keys is False
    assert [key.access_key_id for key in disabled_state.access_keys] == ["AK-PROJECT-1"]


def test_project_iam_principals_are_included_in_bucket_policy_without_dropping_external_statements(db_session):
    endpoint_a = _project_iam_endpoint("zg-policy-a", "zg-main")
    endpoint_b = _project_iam_endpoint("zg-policy-b", "zg-main")
    authority = S3Account(
        name="portal-project-policy-authority",
        rgw_account_id="rgw-authority",
        rgw_access_key="ROOT-AK-A",
        rgw_secret_key="ROOT-SK-A",
        storage_endpoint=endpoint_a,
    )
    bucket_account = S3Account(
        name="portal-project-policy-bucket",
        rgw_account_id="rgw-bucket",
        rgw_access_key="ROOT-AK-B",
        rgw_secret_key="ROOT-SK-B",
        storage_endpoint=endpoint_b,
    )
    owner = User(email="portal-project-policy-owner@example.com", hashed_password="x", role="ui_user")
    viewer = User(email="portal-project-policy-viewer@example.com", hashed_password="x", role="ui_user")
    project = Project(name="Project Policy", description="policy test")
    db_session.add_all([endpoint_a, endpoint_b, authority, bucket_account, owner, viewer, project])
    db_session.flush()
    db_session.add_all(
        [
            ProjectS3Account(project_id=project.id, account_id=authority.id, display_name="Authority", sort_order=0),
            ProjectS3Account(project_id=project.id, account_id=bucket_account.id, display_name="Bucket", sort_order=1),
            UserProject(project_id=project.id, user_id=viewer.id, account_role=AccountRole.PORTAL_USER.value),
            ProjectIAMUser(
                user_id=viewer.id,
                project_id=project.id,
                zonegroup_key="zg-main",
                zonegroup_name="zg-main",
                authority_account_id=authority.id,
                iam_user_id="project-viewer-iam-id",
                iam_username="project-viewer-iam",
            ),
        ]
    )
    metadata = PortalStorageSpaceMetadata(
        account_id=bucket_account.id,
        bucket_name="policy-space",
        owner_user_id=owner.id,
        visibility="shared",
        share_scope="restricted",
    )
    db_session.add(metadata)
    db_session.flush()
    db_session.add(PortalStorageSpaceGrant(storage_space_metadata_id=metadata.id, user_id=viewer.id, role="Viewer"))
    db_session.commit()

    service = PortalService(db_session)
    existing_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "ExternalStatement",
                "Effect": "Allow",
                "Principal": "*",
                "Action": "s3:GetBucketLocation",
                "Resource": "arn:aws:s3:::policy-space",
            }
        ],
    }

    policy = service._storage_space_bucket_policy(bucket_account, "policy-space", metadata, existing_policy)

    assert policy is not None
    assert _storage_space_policy_statement(policy, "ExternalStatement")["Effect"] == "Allow"
    statement = _storage_space_policy_statement(policy, service._storage_space_access_sid)
    principals = _storage_space_policy_principals(statement)
    assert "arn:aws:iam:::user/project-viewer-iam" in principals
    assert "arn:aws:iam::rgw-authority:user/project-viewer-iam" in principals
    assert "arn:aws:iam::rgw-bucket:user/project-viewer-iam" in principals


def test_project_iam_projection_revokes_keys_when_user_loses_project_access(monkeypatch, db_session):
    endpoint = _project_iam_endpoint("zg-revoke", "zg-main")
    account = S3Account(
        name="portal-project-revoke",
        rgw_account_id="rgw-revoke",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
        storage_endpoint=endpoint,
    )
    user = User(email="portal-project-revoke@example.com", hashed_password="x", role="ui_user")
    project = Project(name="Project Revoke", description="revoke test")
    db_session.add_all([endpoint, account, user, project])
    db_session.flush()
    db_session.add_all(
        [
            ProjectS3Account(project_id=project.id, account_id=account.id, display_name="Default", sort_order=0),
            ProjectIAMUser(
                user_id=user.id,
                project_id=project.id,
                zonegroup_key="zg-main",
                zonegroup_name="zg-main",
                authority_account_id=account.id,
                iam_user_id="project-revoke-iam-id",
                iam_username="project-revoke-iam",
            ),
        ]
    )
    db_session.commit()

    fake_iam = _ProjectIAMFakeService()
    fake_iam.users["project-revoke-iam"] = IAMUser(name="project-revoke-iam")
    fake_iam.keys["project-revoke-iam"] = [IAMAccessKey(access_key_id="AK-REVOKE", status="Active")]
    fake_iam.user_policies[("project-revoke-iam", PortalService(db_session)._bucket_access_policy_name)] = {"Statement": []}
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_get_iam_service", lambda _account: fake_iam)

    link = db_session.query(ProjectIAMUser).one()
    service._sync_project_iam_link_projection(link)

    assert ("project-revoke-iam", "AK-REVOKE", "Inactive") in fake_iam.status_updates
    assert ("project-revoke-iam", service._bucket_access_policy_name) in fake_iam.deleted_policies
    assert "project-revoke-iam" not in fake_iam.group_users.get(service._manager_group_name, set())
    assert "project-revoke-iam" not in fake_iam.group_users.get(service._user_group_name, set())


def test_portal_project_access_key_routes_record_project_scope_audit(db_session):
    endpoint = _project_iam_endpoint("zg-route", "zg-main")
    account = S3Account(
        name="portal-project-route",
        rgw_account_id="rgw-route",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
        storage_endpoint=endpoint,
    )
    user = User(email="portal-project-route@example.com", hashed_password="x", role="ui_user")
    project = Project(name="Project Route", description="route test")
    db_session.add_all([endpoint, account, user, project])
    db_session.flush()
    db_session.add_all(
        [
            ProjectS3Account(project_id=project.id, account_id=account.id, display_name="Default", sort_order=0),
            UserProject(project_id=project.id, user_id=user.id, account_role=AccountRole.PORTAL_USER.value),
        ]
    )
    db_session.commit()

    class FakeService:
        def _resolve_project_access_key_scope(self, access_obj, scope_id):
            assert access_obj.project.id == project.id
            assert scope_id == "zg-scope"
            return SimpleNamespace(
                scope_id="zg-scope",
                zonegroup_name="zg-main",
                authority_account=account,
            )

        def create_project_access_key(self, user_obj, access_obj, scope_id):
            assert user_obj == user
            assert access_obj.project.id == project.id
            assert scope_id == "zg-scope"
            return PortalAccessKey(access_key_id="AK-PROJECT", secret_access_key="SK-PROJECT", is_portal=False)

        def update_project_access_key_status(self, user_obj, access_obj, scope_id, access_key_id, active):
            assert user_obj == user
            assert access_obj.project.id == project.id
            assert scope_id == "zg-scope"
            assert access_key_id == "AK-PROJECT"
            assert active is False
            return PortalAccessKey(access_key_id="AK-PROJECT", status="Inactive", is_active=False, is_portal=False)

        def delete_project_access_key(self, user_obj, access_obj, scope_id, access_key_id):
            assert user_obj == user
            assert access_obj.project.id == project.id
            assert scope_id == "zg-scope"
            assert access_key_id == "AK-PROJECT"

    class FakeAuditService:
        def __init__(self):
            self.actions = []

        def record_action(self, **kwargs):
            self.actions.append(kwargs)

    audit_service = FakeAuditService()
    service = FakeService()

    created = portal_router.create_portal_project_access_key(
        project.id,
        "zg-scope",
        user=user,
        db=db_session,
        audit_service=audit_service,
        service=service,
    )
    updated = portal_router.update_portal_project_access_key_status(
        project.id,
        "zg-scope",
        "AK-PROJECT",
        PortalAccessKeyStatusChange(active=False),
        user=user,
        db=db_session,
        audit_service=audit_service,
        service=service,
    )
    deleted = portal_router.delete_portal_project_access_key(
        project.id,
        "zg-scope",
        "AK-PROJECT",
        user=user,
        db=db_session,
        audit_service=audit_service,
        service=service,
    )

    assert created.secret_access_key == "SK-PROJECT"
    assert updated.is_active is False
    assert deleted.status_code == 204
    assert [entry["entity_type"] for entry in audit_service.actions] == [
        "portal_project_access_key",
        "portal_project_access_key",
        "portal_project_access_key",
    ]
    assert audit_service.actions[0]["metadata"] == {
        "access_key_id": "AK-PROJECT",
        "project_id": project.id,
        "scope_id": "zg-scope",
        "zonegroup": "zg-main",
        "authority_account_id": account.id,
    }
    assert "secret_access_key" not in audit_service.actions[0]["metadata"]


def test_portal_access_key_routes_record_audit(db_session):
    account = S3Account(name="portal-account-key-routes", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-key-routes@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    access = _portal_access(account, user)

    class FakeService:
        def create_access_key(self, user_obj, access_obj):
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


def test_portal_access_key_routes_translate_disabled_management(db_session):
    account = S3Account(name="portal-account-key-route-disabled", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-key-route-disabled@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    class FakeService:
        def create_access_key(self, user_obj, access_obj):  # noqa: ARG002
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
        ("GET", "/portal/settings"),
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
