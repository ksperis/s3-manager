# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

import pytest

from app.db import (
    ManagerAccountRole, PortalAccountRole,
    S3Account,
    S3User,
    StorageEndpoint,
    UiGroup,
    UiGroupS3User,
    User,
    UserRole,
    UserS3Account,
    UserS3User,
    UserUiGroup,
)
from app.models.app_settings import AppSettings
from app.services import app_settings_service
from app.services.manager_ceph_management_access_service import ManagerCephManagementAccessService
from app.services.s3_execution_context import S3ExecutionContext


def _endpoint(*, name: str = "ceph-manager", admin_enabled: bool = True) -> StorageEndpoint:
    return StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider="ceph",
        admin_access_key="ADMIN-AK",
        admin_secret_key="ADMIN-SK",
        features_config=f"features:\n  admin:\n    enabled: {'true' if admin_enabled else 'false'}\n",
    )


def _user(db_session, email: str) -> User:
    user = User(email=email, hashed_password="x", is_active=True, role=UserRole.UI_USER.value)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_quota_policy_revalidates_direct_manager_access_after_revocation(db_session, monkeypatch):
    monkeypatch.setattr(app_settings_service, "load_app_settings", lambda: AppSettings())
    user = _user(db_session, "quota-direct@example.test")
    endpoint = _endpoint(name="quota-direct")
    account = S3Account(
        name="quota-direct-account",
        rgw_account_id="quota-direct-rgw",
        rgw_user_uid="quota-direct-rgw-admin",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
        storage_endpoint=endpoint,
        allow_bucket_quota_management=True,
    )
    db_session.add_all([endpoint, account])
    db_session.flush()
    link = UserS3Account(
        user_id=user.id,
        account_id=account.id,
        manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
        portal_role=None,
    )
    db_session.add(link)
    db_session.commit()
    context = S3ExecutionContext.from_account(account)
    policy = ManagerCephManagementAccessService(db_session)

    assert policy.evaluate("bucket_quota", surface="manager", actor=user, account=context).allowed is True

    db_session.delete(link)
    db_session.commit()
    decision = policy.evaluate("bucket_quota", surface="manager", actor=user, account=context)
    assert decision.allowed is False
    assert decision.reason == "Not authorized for this Manager context"


def test_key_policy_accepts_group_access_and_revalidates_revocation(db_session, monkeypatch):
    monkeypatch.setattr(app_settings_service, "load_app_settings", lambda: AppSettings())
    user = _user(db_session, "keys-group@example.test")
    endpoint = _endpoint(name="keys-group")
    s3_user = S3User(
        name="keys-group-user",
        rgw_user_uid="keys-group-uid",
        rgw_access_key="TECH-AK",
        rgw_secret_key="TECH-SK",
        storage_endpoint=endpoint,
        allow_access_key_management=True,
    )
    group = UiGroup(name="Keys group")
    db_session.add_all([endpoint, s3_user, group])
    db_session.flush()
    membership = UserUiGroup(user_id=user.id, group_id=group.id)
    db_session.add_all(
        [
            membership,
            UiGroupS3User(group_id=group.id, s3_user_id=s3_user.id),
        ]
    )
    db_session.commit()
    context = S3ExecutionContext.from_s3_user(s3_user)
    policy = ManagerCephManagementAccessService(db_session)

    assert policy.evaluate("rgw_access_keys", surface="manager", actor=user, account=context).allowed is True

    db_session.delete(membership)
    db_session.commit()
    assert policy.evaluate("rgw_access_keys", surface="manager", actor=user, account=context).allowed is False


@pytest.mark.parametrize(
    ("operation", "setting_name"),
    [
        ("bucket_quota", "bucket_quota_management_enabled"),
        ("rgw_access_keys", "manager_ceph_s3_user_keys_enabled"),
    ],
)
def test_policy_applies_global_kill_switches(db_session, monkeypatch, operation, setting_name):
    settings = AppSettings()
    setattr(settings.general, setting_name, False)
    monkeypatch.setattr(app_settings_service, "load_app_settings", lambda: settings)
    user = _user(db_session, f"{operation}@example.test")
    decision = ManagerCephManagementAccessService(db_session).evaluate(
        operation,
        surface="manager",
        actor=user,
        account=None,
    )
    assert decision.allowed is False
    assert "disabled" in decision.reason


@pytest.mark.parametrize("operation", ["bucket_quota", "rgw_access_keys"])
@pytest.mark.parametrize(
    ("endpoint_field", "endpoint_value"),
        [
            ("provider", "other"),
            ("features_config", "features:\n  admin:\n    enabled: false\n"),
            ("admin_access_key", None),
            ("admin_secret_key", None),
    ],
)
def test_policy_rejects_each_missing_ceph_admin_capability(
    db_session,
    monkeypatch,
    operation,
    endpoint_field,
    endpoint_value,
):
    monkeypatch.setattr(app_settings_service, "load_app_settings", lambda: AppSettings())
    user = _user(db_session, f"no-admin-{operation}@example.test")
    endpoint = _endpoint(name=f"no-admin-{operation}", admin_enabled=False)
    endpoint.features_config = "features:\n  admin:\n    enabled: true\n"
    setattr(endpoint, endpoint_field, endpoint_value)
    s3_user = S3User(
        name=f"no-admin-{operation}",
        rgw_user_uid=f"no-admin-{operation}",
        rgw_access_key="AK",
        rgw_secret_key="SK",
        storage_endpoint=endpoint,
        allow_bucket_quota_management=True,
        allow_access_key_management=True,
    )
    db_session.add_all([endpoint, s3_user])
    db_session.flush()
    db_session.add(UserS3User(user_id=user.id, s3_user_id=s3_user.id))
    db_session.commit()
    decision = ManagerCephManagementAccessService(db_session).evaluate(
        operation,
        surface="manager",
        actor=user,
        account=S3ExecutionContext.from_s3_user(s3_user),
    )
    assert decision.allowed is False
    assert decision.reason == "Ceph Admin API is not available for this context"


@pytest.mark.parametrize(
    ("operation", "context_kind"),
    [
        ("bucket_quota", "connection"),
        ("bucket_quota", "session"),
        ("bucket_quota", "portal_account"),
        ("bucket_quota", "ceph_admin"),
        ("rgw_access_keys", "account"),
        ("rgw_access_keys", "connection"),
        ("rgw_access_keys", "session"),
        ("rgw_access_keys", "ceph_admin"),
    ],
)
def test_policy_rejects_non_eligible_manager_contexts(
    db_session,
    monkeypatch,
    operation,
    context_kind,
):
    monkeypatch.setattr(app_settings_service, "load_app_settings", lambda: AppSettings())
    user = _user(db_session, f"{operation}-{context_kind}@example.test")
    context = S3ExecutionContext(
        context_id=f"{context_kind}-1",
        context_kind=context_kind,
        name="ineligible",
        access_key="AK",
        secret_key="SK",
    )

    decision = ManagerCephManagementAccessService(db_session).evaluate(
        operation,
        surface="manager",
        actor=user,
        account=context,
    )

    assert decision.allowed is False
    assert "not available for this context" in decision.reason
