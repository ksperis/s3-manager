# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.db import AccountIAMUser, AccountRole, S3Account, User
from app.models.app_settings import PortalSettings
from app.models.bucket import Bucket
from app.models.portal import PortalAccessKey, PortalIAMUser, PortalState, PortalStorageSpaceSummary
from app.routers.dependencies import AccountAccess, AccountCapabilities
from app.routers import portal as portal_router
from app.services import s3_client
from app.services.portal_service import PortalAccessKeyLimitExceeded, PortalService
from app.models.iam import AccessKey as IAMAccessKey, IAMUser


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


def test_list_storage_space_objects_maps_common_prefixes_and_objects(monkeypatch, db_session):
    account = S3Account(name="portal-object-list", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-object-list@example.com", hashed_password="x", role="ui_user")
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

    class FakeClient:
        def __init__(self):
            self.calls = []

        def list_objects_v2(self, **kwargs):
            self.calls.append(kwargs)
            return {
                "Contents": [
                    {"Key": "raw-data/2024/03/", "Size": 0},
                    {
                        "Key": "raw-data/2024/03/sample_001.fastq.gz",
                        "Size": 2048,
                        "LastModified": datetime(2026, 5, 27, 8, 15, tzinfo=timezone.utc),
                    },
                ],
                "CommonPrefixes": [{"Prefix": "raw-data/2024/03/01-fastq/"}],
                "IsTruncated": True,
                "NextContinuationToken": "next-token",
            }

    fake_client = FakeClient()
    monkeypatch.setattr(service, "_portal_object_client", lambda *_args, **_kwargs: fake_client)

    listing = service.list_storage_space_objects(
        user,
        access,
        "research-data",
        prefix="/raw-data/2024/03/",
        continuation_token="token",
        max_keys=2000,
    )

    assert fake_client.calls == [
        {
            "Bucket": "bucket-research-data",
            "Prefix": "raw-data/2024/03/",
            "Delimiter": "/",
            "MaxKeys": 1000,
            "ContinuationToken": "token",
        }
    ]
    assert listing.prefix == "raw-data/2024/03/"
    assert listing.prefixes == ["raw-data/2024/03/01-fastq/"]
    assert listing.is_truncated is True
    assert listing.next_continuation_token == "next-token"
    assert len(listing.objects) == 1
    assert listing.objects[0].key == "raw-data/2024/03/sample_001.fastq.gz"
    assert listing.objects[0].name == "sample_001.fastq.gz"
    assert listing.objects[0].size == 2048


def test_upload_storage_space_object_allows_editor_and_rejects_viewer(monkeypatch, db_session):
    account = S3Account(name="portal-object-upload", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-object-upload@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()

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

    class FakeClient:
        def __init__(self):
            self.uploads = []

        def upload_fileobj(self, stream, bucket_name, key, ExtraArgs=None):
            self.uploads.append(
                {
                    "body": stream.read(),
                    "bucket": bucket_name,
                    "key": key,
                    "extra_args": ExtraArgs,
                }
            )

    fake_client = FakeClient()
    monkeypatch.setattr(service, "_portal_object_client", lambda *_args, **_kwargs: fake_client)

    editor_access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)
    uploaded_key = service.upload_storage_space_object(
        user,
        editor_access,
        "research-data",
        "/raw-data/report.csv",
        b"sample",
        content_type="text/csv",
    )

    assert uploaded_key == "raw-data/report.csv"
    assert fake_client.uploads == [
        {
            "body": b"sample",
            "bucket": "bucket-research-data",
            "key": "raw-data/report.csv",
            "extra_args": {"ContentType": "text/csv"},
        }
    ]

    viewer_access = _portal_access(account, user, role=AccountRole.PORTAL_NONE.value, can_manage_buckets=False)
    with pytest.raises(RuntimeError, match="Upload not allowed"):
        service.upload_storage_space_object(user, viewer_access, "research-data", "raw-data/denied.csv", b"sample")


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
        service.list_storage_space_objects(user, access, "hidden-space")


def test_portal_object_upload_route_audits_scope_portal(db_session):
    account = S3Account(name="portal-object-upload-route", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-object-upload-route@example.com", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.commit()
    access = _portal_access(account, user, role=AccountRole.PORTAL_USER.value, can_manage_buckets=False)

    class FakeUpload:
        filename = "report.csv"
        content_type = "text/csv"

        async def read(self):
            return b"sample"

    class FakeService:
        def upload_storage_space_object(self, user_obj, access_obj, space_id, key, file_obj, content_type=None):
            assert user_obj == user
            assert access_obj == access
            assert space_id == "research-data"
            assert key == "raw-data/report.csv"
            assert file_obj == b"sample"
            assert content_type == "text/csv"
            return key

    class FakeAuditService:
        def __init__(self):
            self.actions = []

        def record_action(self, **kwargs):
            self.actions.append(kwargs)

    audit_service = FakeAuditService()

    response = asyncio.run(
        portal_router.portal_upload_storage_space_object(
            "research-data",
            file=FakeUpload(),
            prefix="raw-data",
            key=None,
            access=access,
            audit_service=audit_service,
            service=FakeService(),
        )
    )

    assert response.key == "raw-data/report.csv"
    assert audit_service.actions[0]["scope"] == "portal"
    assert audit_service.actions[0]["action"] == "upload_object"
    assert audit_service.actions[0]["metadata"] == {
        "storage_space_id": "research-data",
        "content_type": "text/csv",
        "size_bytes": 6,
    }


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


def test_create_portal_access_key_allows_portal_user_when_option_enabled(db_session):
    account = S3Account(name="portal-account-user-create-key", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-create-key@example.com", hashed_password="x", role="ui_user")
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

    class _FakeService:
        def __init__(self):
            self.create_access_key_calls = 0

        def get_effective_portal_settings(self, account):  # noqa: ARG002
            return PortalSettings(allow_portal_user_access_key_create=True)

        def create_access_key(self, user_obj, access_obj):  # noqa: ARG002
            self.create_access_key_calls += 1
            return PortalAccessKey(
                access_key_id="AK-NEW",
                status="Active",
                created_at="2026-01-03T00:00:00Z",
                is_active=True,
                is_portal=False,
                deletable=True,
                secret_access_key="SK-NEW",
            )

    class _FakeAuditService:
        def __init__(self):
            self.actions = []

        def record_action(self, **kwargs):
            self.actions.append(kwargs)

    service = _FakeService()
    audit_service = _FakeAuditService()

    created = portal_router.create_portal_access_key(access=access, audit_service=audit_service, service=service)

    assert created.access_key_id == "AK-NEW"
    assert service.create_access_key_calls == 1
    assert len(audit_service.actions) == 1
    assert audit_service.actions[0]["action"] == "create_access_key"
    assert audit_service.actions[0]["metadata"]["access_key_id"] == "AK-NEW"


def test_create_portal_access_key_returns_409_when_limit_reached(db_session):
    account = S3Account(name="portal-account-user-create-key-limit", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-create-key-limit@example.com", hashed_password="x", role="ui_user")
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

    class _FakeService:
        def get_effective_portal_settings(self, account):  # noqa: ARG002
            return PortalSettings(allow_portal_user_access_key_create=True)

        def create_access_key(self, user_obj, access_obj):  # noqa: ARG002
            raise PortalAccessKeyLimitExceeded("Maximum IAM user keys reached (2). Delete a key before creating a new one.")

    class _FakeAuditService:
        def record_action(self, **kwargs):  # noqa: ARG002
            raise AssertionError("Audit should not be called when key creation is rejected")

    service = _FakeService()
    audit_service = _FakeAuditService()

    with pytest.raises(HTTPException) as exc:
        portal_router.create_portal_access_key(access=access, audit_service=audit_service, service=service)

    assert exc.value.status_code == 409
    assert "Maximum IAM user keys reached" in str(exc.value.detail)


def test_delete_portal_access_key_allows_portal_user_when_option_enabled(db_session):
    account = S3Account(name="portal-account-user-delete-key", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-delete-key@example.com", hashed_password="x", role="ui_user")
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

    class _FakeService:
        def __init__(self):
            self.delete_access_key_calls = 0

        def get_effective_portal_settings(self, account):  # noqa: ARG002
            return PortalSettings(allow_portal_user_access_key_create=True)

        def delete_access_key(self, user_obj, access_obj, access_key_id):  # noqa: ARG002
            if access_key_id != "AK-DEL":
                raise AssertionError("Unexpected key id")
            self.delete_access_key_calls += 1

    class _FakeAuditService:
        def __init__(self):
            self.actions = []

        def record_action(self, **kwargs):
            self.actions.append(kwargs)

    service = _FakeService()
    audit_service = _FakeAuditService()

    portal_router.delete_portal_access_key(access_key_id="AK-DEL", access=access, audit_service=audit_service, service=service)

    assert service.delete_access_key_calls == 1
    assert len(audit_service.actions) == 1
    assert audit_service.actions[0]["action"] == "delete_access_key"
    assert audit_service.actions[0]["metadata"]["access_key_id"] == "AK-DEL"


def test_delete_portal_access_key_rejects_portal_user_when_option_disabled(db_session):
    account = S3Account(name="portal-account-user-delete-denied", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-delete-denied@example.com", hashed_password="x", role="ui_user")
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

    class _FakeService:
        def __init__(self):
            self.delete_access_key_calls = 0

        def get_effective_portal_settings(self, account):  # noqa: ARG002
            return PortalSettings(allow_portal_user_access_key_create=False)

        def delete_access_key(self, user_obj, access_obj, access_key_id):  # noqa: ARG002
            self.delete_access_key_calls += 1

    class _FakeAuditService:
        def record_action(self, **kwargs):  # noqa: ARG002
            raise AssertionError("Audit should not be called when deletion is forbidden")

    service = _FakeService()
    audit_service = _FakeAuditService()

    with pytest.raises(HTTPException) as exc:
        portal_router.delete_portal_access_key(access_key_id="AK-DEL", access=access, audit_service=audit_service, service=service)

    assert exc.value.status_code == 403
    assert service.delete_access_key_calls == 0


def test_delete_portal_bucket_allows_portal_user_when_option_enabled(db_session):
    account = S3Account(name="portal-account-user-delete-bucket", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-delete-bucket@example.com", hashed_password="x", role="ui_user")
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

    class _FakeService:
        def __init__(self):
            self.delete_bucket_calls = []

        def get_effective_portal_settings(self, account):  # noqa: ARG002
            return PortalSettings(allow_portal_user_bucket_create=True)

        def list_existing_user_bucket_access(self, user_obj, account_obj, account_role):  # noqa: ARG002
            if account_role != AccountRole.PORTAL_USER.value:
                raise AssertionError("Unexpected role")
            return ["bucket-a"]

        def delete_bucket(self, user_obj, access_obj, bucket_name, force=False, use_root=False):  # noqa: ARG002
            self.delete_bucket_calls.append((bucket_name, force, use_root))

    class _FakeAuditService:
        def __init__(self):
            self.actions = []

        def record_action(self, **kwargs):
            self.actions.append(kwargs)

    service = _FakeService()
    audit_service = _FakeAuditService()

    result = portal_router.delete_portal_bucket(
        bucket_name="bucket-a",
        force=False,
        access=access,
        audit_service=audit_service,
        service=service,
    )

    assert result["message"] == "Bucket 'bucket-a' deleted"
    assert service.delete_bucket_calls == [("bucket-a", False, True)]
    assert len(audit_service.actions) == 1
    assert audit_service.actions[0]["action"] == "delete_bucket"
    assert audit_service.actions[0]["metadata"]["force"] is False


def test_delete_portal_bucket_rejects_portal_user_when_option_disabled(db_session):
    account = S3Account(name="portal-account-user-delete-bucket-denied", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-delete-bucket-denied@example.com", hashed_password="x", role="ui_user")
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

    class _FakeService:
        def __init__(self):
            self.delete_bucket_calls = 0

        def get_effective_portal_settings(self, account):  # noqa: ARG002
            return PortalSettings(allow_portal_user_bucket_create=False)

        def list_existing_user_bucket_access(self, user_obj, account_obj, account_role):  # noqa: ARG002
            return ["bucket-a"]

        def delete_bucket(self, user_obj, access_obj, bucket_name, force=False, use_root=False):  # noqa: ARG002
            self.delete_bucket_calls += 1

    class _FakeAuditService:
        def record_action(self, **kwargs):  # noqa: ARG002
            raise AssertionError("Audit should not be called when deletion is forbidden")

    service = _FakeService()
    audit_service = _FakeAuditService()

    with pytest.raises(HTTPException) as exc:
        portal_router.delete_portal_bucket(
            bucket_name="bucket-a",
            force=False,
            access=access,
            audit_service=audit_service,
            service=service,
        )

    assert exc.value.status_code == 403
    assert service.delete_bucket_calls == 0


def test_delete_portal_bucket_rejects_portal_user_when_bucket_not_granted(db_session):
    account = S3Account(name="portal-account-user-delete-bucket-no-access", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    user = User(email="portal-user-delete-bucket-no-access@example.com", hashed_password="x", role="ui_user")
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

    class _FakeService:
        def __init__(self):
            self.delete_bucket_calls = 0

        def get_effective_portal_settings(self, account):  # noqa: ARG002
            return PortalSettings(allow_portal_user_bucket_create=True)

        def list_existing_user_bucket_access(self, user_obj, account_obj, account_role):  # noqa: ARG002
            return ["bucket-x"]

        def delete_bucket(self, user_obj, access_obj, bucket_name, force=False, use_root=False):  # noqa: ARG002
            self.delete_bucket_calls += 1

    class _FakeAuditService:
        def record_action(self, **kwargs):  # noqa: ARG002
            raise AssertionError("Audit should not be called when deletion is forbidden")

    service = _FakeService()
    audit_service = _FakeAuditService()

    with pytest.raises(HTTPException) as exc:
        portal_router.delete_portal_bucket(
            bucket_name="bucket-a",
            force=False,
            access=access,
            audit_service=audit_service,
            service=service,
        )

    assert exc.value.status_code == 403
    assert service.delete_bucket_calls == 0
