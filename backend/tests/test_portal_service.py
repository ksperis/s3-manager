# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.db import (
    AuditLog,
    AccountIAMUser,
    AccountRole,
    PortalPublicLink,
    PortalStorageSpaceMetadata,
    QuotaUsageDaily,
    S3Account,
    StorageEndpoint,
    User,
    UserS3Account,
)
from app.models.app_settings import AppSettings, PortalSettings, PortalSettingsOverride
from app.models.bucket import Bucket
from app.models.iam import AccessKey as IAMAccessKey, IAMUser
from app.models.portal import (
    PortalAccessKey,
    PortalAccessKeyStatusChange,
    PortalAlert,
    PortalIAMUser,
    PortalState,
    PortalStorageSpace,
    PortalStorageSpaceShare,
    PortalStorageSpaceSummary,
    PortalUsage,
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


def test_portal_bucket_creation_updates_user_policy(monkeypatch, db_session):
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
        lambda name, enabled=True, access_key=None, secret_key=None, **kwargs: versioning_calls.append((name, enabled)),
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
    assert created_buckets == [("user-bucket", "AK-PORTAL", "SK-PORTAL")]
    assert versioning_calls == [("user-bucket", True)]
    assert len(lifecycle_calls) == 1
    assert len(cors_calls) == 1
    cors_rules = cors_calls[0][1]["rules"]
    assert isinstance(cors_rules, list) and len(cors_rules) == 1
    assert "Authorization" in (cors_rules[0].get("AllowedHeaders") or [])
    assert policy_calls == {
        "iam_service": iam_service,
        "iam_username": "portal-iam",
        "bucket_name": "user-bucket",
    }


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
    assert created_buckets == [("user-bucket", "AK-PORTAL", "SK-PORTAL")]
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


def test_portal_user_group_policy_adds_create_bucket_without_delete_bucket(db_session):
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
    assert "s3:CreateBucket" in actions
    assert "s3:DeleteBucket" not in actions


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
    assert state.buckets == []
    assert state.total_buckets == 0
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
        buckets=[],
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


def test_get_state_scopes_buckets_for_portal_manager(monkeypatch, db_session):
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
    monkeypatch.setattr(
        service,
        "list_existing_user_bucket_access",
        lambda target, scoped_account, role: ["bucket-a"],  # noqa: ARG005
    )
    monkeypatch.setattr(
        s3_client,
        "list_buckets",
        lambda **kwargs: [  # noqa: ARG005
            {"name": "bucket-a", "creation_date": "2026-03-01T00:00:00Z"},
            {"name": "bucket-b", "creation_date": "2026-03-02T00:00:00Z"},
        ],
    )

    state = service.get_state(user, access)

    assert [bucket.name for bucket in state.buckets] == ["bucket-a"]
    assert state.total_buckets == 1
    assert state.can_manage_buckets is True


def test_get_state_scopes_buckets_for_portal_user(monkeypatch, db_session):
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
        lambda target, scoped_account, role: ["bucket-user"],  # noqa: ARG005
    )
    monkeypatch.setattr(
        s3_client,
        "list_buckets",
        lambda **kwargs: [  # noqa: ARG005
            {"name": "bucket-user", "creation_date": "2026-03-01T00:00:00Z"},
            {"name": "bucket-other", "creation_date": "2026-03-02T00:00:00Z"},
        ],
    )

    state = service.get_state(user, access)

    assert [bucket.name for bucket in state.buckets] == ["bucket-user"]
    assert state.total_buckets == 1
    assert state.can_manage_buckets is False


def test_get_state_returns_no_buckets_when_scope_is_empty(monkeypatch, db_session):
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
    monkeypatch.setattr(
        s3_client,
        "list_buckets",
        lambda **kwargs: [  # noqa: ARG005
            {"name": "fallback-bucket", "creation_date": "2026-03-01T00:00:00Z"},
        ],
    )

    state = service.get_state(user, access)

    assert state.buckets == []
    assert state.total_buckets == 0


def test_list_storage_spaces_maps_visible_buckets_to_workspace_summary(monkeypatch, db_session):
    account = S3Account(name="portal-storage-spaces", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-spaces@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "get_state",
        lambda *_args, **_kwargs: PortalState(
            account_id=account.id,
            iam_user=PortalIAMUser(),
            access_keys=[],
            buckets=[
                Bucket(
                    name="research-data",
                    creation_date="2026-03-01T00:00:00Z",
                    used_bytes=2048,
                    object_count=12,
                ),
                Bucket(name="archive", creation_date="2026-03-02T00:00:00Z"),
            ],
            account_role=AccountRole.PORTAL_MANAGER.value,
            can_manage_buckets=True,
        ),
    )

    spaces = service.list_storage_spaces(user, access, search="research")

    assert len(spaces) == 1
    assert spaces[0].id == "research-data"
    assert spaces[0].name == "Research Data"
    assert spaces[0].role == "Owner"
    assert spaces[0].status == "Active"
    assert spaces[0].internal_bucket_name == "research-data"
    assert spaces[0].used_bytes == 2048
    assert spaces[0].object_count == 12


def test_storage_space_metadata_filters_sorting_and_archive(monkeypatch, db_session):
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
                space_type="Dataset",
                project_key="GEN-2026",
            ),
            PortalStorageSpaceMetadata(
                account_id=account.id,
                bucket_name="old-data",
                display_name="Old Data",
                archived_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            ),
        ]
    )
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)
    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "get_state",
        lambda *_args, **_kwargs: PortalState(
            account_id=account.id,
            iam_user=PortalIAMUser(),
            access_keys=[],
            buckets=[
                Bucket(name="research-data", creation_date="2026-03-01T00:00:00Z", used_bytes=2048, object_count=12),
                Bucket(name="old-data", creation_date="2026-01-01T00:00:00Z", used_bytes=4096, object_count=2),
            ],
            account_role=AccountRole.PORTAL_MANAGER.value,
            can_manage_buckets=True,
        ),
    )

    spaces = service.list_storage_spaces(user, access, search="gen", sort="-used_bytes")
    archived = service.list_storage_spaces(user, access, include_archived=True, status="Archived")

    assert [(space.id, space.name, space.description, space.owner_label, space.space_type) for space in spaces] == [
        ("research-data", "Genome Project", "Primary sequencing dataset", "Lab Team", "Dataset")
    ]
    assert [(space.id, space.status) for space in archived] == [("old-data", "Archived")]


def test_get_storage_space_keeps_bucket_scope_and_returns_none_when_hidden(monkeypatch, db_session):
    account = S3Account(name="portal-storage-space-scope", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-storage-space-scope@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "get_state",
        lambda *_args, **_kwargs: PortalState(
            account_id=account.id,
            iam_user=PortalIAMUser(),
            access_keys=[],
            buckets=[Bucket(name="allowed-bucket", creation_date="2026-03-01T00:00:00Z")],
            account_role=AccountRole.PORTAL_USER.value,
            can_manage_buckets=False,
        ),
    )

    def fake_stats(_user, _access, bucket_name):
        assert bucket_name == "allowed-bucket"
        return Bucket(name=bucket_name, used_bytes=4096, object_count=24)

    monkeypatch.setattr(service, "get_bucket_stats", fake_stats)

    visible = service.get_storage_space(user, access, "allowed-bucket")
    hidden = service.get_storage_space(user, access, "hidden-bucket")

    assert visible is not None
    assert visible.id == "allowed-bucket"
    assert visible.name == "Allowed Bucket"
    assert visible.role == "Editor"
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
    assert metadata.origin == "portal_generic"
    assert metadata.name_editable is True
    assert storage_space.id == bucket_name


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
    assert policy_calls == [("portal-iam", "existing-bucket")]
    metadata = (
        db_session.query(PortalStorageSpaceMetadata)
        .filter_by(account_id=account.id, bucket_name="existing-bucket")
        .one()
    )
    assert metadata.display_name == "existing-bucket"
    assert metadata.description == "Imported bucket"
    assert metadata.origin == "imported"
    assert metadata.name_editable is False


@pytest.mark.parametrize("origin", ["legacy", "imported"])
def test_update_storage_space_locked_names_reject_rename_but_accept_description(origin, monkeypatch, db_session):
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


def test_portal_named_bucket_account_override_requires_global_policy(monkeypatch, db_session):
    account = S3Account(name="portal-storage-override", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    db_session.add(account)
    db_session.commit()

    base = PortalSettings()
    service = PortalService(db_session)
    monkeypatch.setattr(service, "_portal_settings", lambda: base)

    with pytest.raises(RuntimeError, match="Override non autorise"):
        service.update_portal_manager_override(
            account,
            PortalSettingsOverride(allow_portal_named_bucket_create=True),
        )

    base.override_policy.allow_portal_named_bucket_create = True
    updated = service.update_portal_manager_override(
        account,
        PortalSettingsOverride(allow_portal_named_bucket_create=True),
    )
    assert updated.effective.allow_portal_named_bucket_create is True

    service.update_admin_portal_settings_override(
        account,
        PortalSettingsOverride(allow_portal_named_bucket_create=False),
    )
    with pytest.raises(RuntimeError, match="Override verrouille"):
        service.update_portal_manager_override(
            account,
            PortalSettingsOverride(allow_portal_named_bucket_create=True),
        )
    assert service.get_effective_portal_settings(account).allow_portal_named_bucket_create is False


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

    service = PortalService(db_session)
    role_map = {"bucket-research-data": "Viewer"}
    monkeypatch.setattr(
        service,
        "list_storage_spaces",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceSummary(
                id="research-data",
                name="Research Data",
                role=role_map["bucket-research-data"],
                internal_bucket_name="bucket-research-data",
            )
        ],
    )
    monkeypatch.setattr(service, "list_existing_user_storage_space_access", lambda *_args, **_kwargs: role_map)

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
    granted_shares = []
    monkeypatch.setattr(service, "_get_iam_service", lambda _account: object())
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
    monkeypatch.setattr(
        service,
        "_set_user_storage_space_policy",
        lambda _iam_service, iam_username, bucket_name, role: granted_shares.append((iam_username, bucket_name, role)),
    )
    monkeypatch.setattr(
        service,
        "list_storage_space_shares",
        lambda *_args, **_kwargs: [
            PortalStorageSpaceShare(
                id=f"research-data:{target.id}",
                storage_space_id="research-data",
                storage_space_name="Research Data",
                user_id=target.id,
                email=target.email,
                role="Viewer",
                direction="by_me",
                activity_label="Active",
            )
        ],
    )
    access = _portal_access(account, actor, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)

    def assert_file_capabilities(role, *, can_write: bool, can_share: bool):
        role_map["bucket-research-data"] = role

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
    assert granted_shares == [(f"iam-{target.id}", "bucket-research-data", "Viewer")]
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
    monkeypatch.setattr(service, "list_existing_user_storage_space_access", lambda *_args, **_kwargs: {"bucket-research-data": "Editor"})

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

    service._set_user_storage_space_policy(iam, "portal-iam", "research-data", "Owner")
    policy = iam.policies[("portal-iam", service._bucket_access_policy_name)]
    access = service._extract_storage_space_access(policy)

    assert access == {"research-data": "Owner"}
    owner_statement = next(stmt for stmt in policy["Statement"] if stmt["Sid"] == "PortalStorageSpaceOwner")
    assert owner_statement["Action"] == ["s3:*"]


def test_list_storage_space_shares_uses_iam_roles(monkeypatch, db_session):
    account = S3Account(name="portal-share-list", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner@example.com", hashed_password="x", role="ui_user")
    viewer = User(email="viewer@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner, viewer])
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(user_id=owner.id, account_id=account.id, account_role=AccountRole.PORTAL_MANAGER.value),
            UserS3Account(user_id=viewer.id, account_id=account.id, account_role=AccountRole.PORTAL_USER.value),
            AccountIAMUser(user_id=owner.id, account_id=account.id, iam_user_id="owner-iam", iam_username="owner-iam"),
            AccountIAMUser(user_id=viewer.id, account_id=account.id, iam_user_id="viewer-iam", iam_username="viewer-iam"),
        ]
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

    class FakeIAMService:
        def get_user_inline_policy(self, username, policy_name):  # noqa: ARG002
            if username == "viewer-iam":
                return {
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Sid": service._storage_space_share_sid("Viewer"),
                            "Effect": "Allow",
                            "Action": service._storage_space_role_actions("Viewer"),
                            "Resource": service._bucket_arns("research-data"),
                        }
                    ],
                }
            return None

    monkeypatch.setattr(service, "_get_iam_service", lambda _account: FakeIAMService())
    access = _portal_access(account, owner, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    shares = service.list_storage_space_shares(owner, access, "research-data")

    assert [(share.email, share.role, share.direction) for share in shares] == [
        ("viewer@example.com", "Viewer", "by_me"),
        ("owner@example.com", "Owner", "with_me"),
    ]


def test_public_links_are_scoped_expirable_and_revocable(monkeypatch, db_session):
    account = S3Account(name="portal-public-links", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    owner = User(email="owner-public@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner])
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


def test_portal_usage_exposes_quota_and_real_storage_space_breakdown(monkeypatch, db_session):
    account = S3Account(name="portal-usage", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="usage@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    service = PortalService(db_session)
    access = _portal_access(account, user, role=AccountRole.PORTAL_MANAGER.value, can_manage_buckets=True)

    monkeypatch.setattr(service, "_account_quota", lambda _account: (1_000, 100))
    monkeypatch.setattr(service, "_account_usage_summary", lambda _account: (900, 90))

    def fake_account_usage(_account, usage_map=None):
        if usage_map is not None:
            usage_map["research-data"] = (700, 70)
            usage_map["archive"] = (200, 20)
        return 900, 90, 2

    monkeypatch.setattr(service, "_account_usage", fake_account_usage)
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
