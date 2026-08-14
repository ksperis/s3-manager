# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.db import S3Account, StorageEndpoint, StorageProvider, User, UserRole
from app.models.admin_automation import (
    AdminAutomationApplyRequest,
    S3AccountApply,
    S3AccountMatch,
    S3AccountSpec,
)
from app.services.admin_automation_service import AdminAutomationService
from tests.s3_account_factory import make_s3_account


class _Audit:
    def __init__(self) -> None:
        self.actions: list[dict] = []

    def record_action(self, **kwargs) -> None:
        self.actions.append(kwargs)


def _actor(db_session) -> User:
    actor = User(
        email="s3-account-automation@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )
    db_session.add(actor)
    db_session.commit()
    db_session.refresh(actor)
    return actor


def _endpoint(db_session) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="S3 account automation endpoint",
        endpoint_url="https://s3-account-automation.example.com",
        provider=StorageProvider.CEPH.value,
        is_default=True,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def _account(db_session, *, name: str = "Existing automation account") -> S3Account:
    account = make_s3_account(
        db_session,
        name=name,
        rgw_account_id="RGW-AUTOMATION-EXISTING",
        rgw_access_key="EXISTING-ACCESS-KEY",
        rgw_secret_key="existing-secret-key",
        rgw_user_uid="existing-root-user",
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def test_automation_creates_s3_account_through_dedicated_handler(
    db_session,
    monkeypatch,
):
    actor = _actor(db_session)
    endpoint = _endpoint(db_session)
    service = AdminAutomationService(db_session)
    captured = {}

    def create_account(payload):
        captured["payload"] = payload
        return SimpleNamespace(
            id=41,
            name=payload.name,
            quota_max_size_gb=payload.quota_max_size_gb,
            quota_max_objects=payload.quota_max_objects,
        )

    monkeypatch.setattr(
        service.s3_account_handler.accounts,
        "create_account_with_manager",
        create_account,
    )

    result = service.apply(
        AdminAutomationApplyRequest(
            s3_accounts=[
                S3AccountApply(
                    match=S3AccountMatch(name="Created automation account"),
                    spec=S3AccountSpec(
                        storage_endpoint_id=endpoint.id,
                        quota_max_size_gb=2,
                        quota_max_objects=100,
                    ),
                )
            ]
        ),
        current_user=actor,
        audit_service=_Audit(),
    )

    assert result.success is True
    assert result.results[0].action == "created"
    assert result.results[0].id == "41"
    assert captured["payload"].name == "Created automation account"
    assert captured["payload"].storage_endpoint_id == endpoint.id


def test_automation_registers_db_account_and_applies_quota_through_public_service(
    db_session,
    monkeypatch,
):
    actor = _actor(db_session)
    endpoint = _endpoint(db_session)
    service = AdminAutomationService(db_session)
    quota_updates = []
    monkeypatch.setattr(
        service.s3_account_handler.accounts,
        "update_account",
        lambda account_id, payload: quota_updates.append((account_id, payload)),
    )

    result = service.apply(
        AdminAutomationApplyRequest(
            s3_accounts=[
                S3AccountApply(
                    action="register",
                    match=S3AccountMatch(rgw_account_id="RGW-AUTOMATION-REGISTERED"),
                    spec=S3AccountSpec(
                        name="Registered automation account",
                        root_user_uid="registered-root-user",
                        rgw_access_key="REGISTERED-ACCESS-KEY",
                        rgw_secret_key="registered-secret-key",
                        quota_max_size_gb=4,
                        quota_max_objects=200,
                        storage_endpoint_id=endpoint.id,
                    ),
                )
            ]
        ),
        current_user=actor,
        audit_service=_Audit(),
    )

    account = (
        db_session.query(S3Account)
        .filter(S3Account.rgw_account_id == "RGW-AUTOMATION-REGISTERED")
        .one()
    )
    assert result.success is True
    assert result.results[0].id == str(account.id)
    assert len(quota_updates) == 1
    assert quota_updates[0][0] == account.id
    assert quota_updates[0][1].quota_max_size_gb == 4
    assert quota_updates[0][1].quota_max_objects == 200


def test_automation_updates_credentials_without_empty_account_update(
    db_session,
    monkeypatch,
):
    actor = _actor(db_session)
    account = _account(db_session)
    service = AdminAutomationService(db_session)
    monkeypatch.setattr(
        service.s3_account_handler.accounts,
        "update_account",
        lambda *_args, **_kwargs: pytest.fail("empty account update must be skipped"),
    )
    audit = _Audit()

    result = service.apply(
        AdminAutomationApplyRequest(
            s3_accounts=[
                S3AccountApply(
                    match=S3AccountMatch(id=account.id),
                    spec=S3AccountSpec(
                        rgw_access_key="REPLACEMENT-ACCESS-KEY",
                        rgw_secret_key="replacement-secret-key",
                    ),
                )
            ]
        ),
        current_user=actor,
        audit_service=audit,
    )

    db_session.refresh(account)
    assert result.success is True
    assert account.rgw_access_key == "REPLACEMENT-ACCESS-KEY"
    assert account.rgw_secret_key == "replacement-secret-key"
    assert audit.actions[0]["metadata"]["credential_fields_updated"] == [
        "rgw_access_key",
        "rgw_secret_key",
    ]


def test_automation_skips_unchanged_secret_and_uses_public_quota_reader(
    db_session,
    monkeypatch,
):
    actor = _actor(db_session)
    account = _account(db_session)
    service = AdminAutomationService(db_session)
    quota_reads = []

    def get_account_quota(current):
        quota_reads.append(current.id)
        return 1.0, 10

    monkeypatch.setattr(
        service.s3_account_handler.accounts,
        "get_account_quota",
        get_account_quota,
    )

    unchanged = service.apply(
        AdminAutomationApplyRequest(
            s3_accounts=[
                S3AccountApply(
                    match=S3AccountMatch(id=account.id),
                    spec=S3AccountSpec(rgw_secret_key="existing-secret-key"),
                )
            ]
        ),
        current_user=actor,
        audit_service=_Audit(),
    )
    quota_diff = service.apply(
        AdminAutomationApplyRequest(
            dry_run=True,
            s3_accounts=[
                S3AccountApply(
                    match=S3AccountMatch(id=account.id),
                    spec=S3AccountSpec(
                        quota_max_size_gb=2,
                        quota_max_objects=20,
                    ),
                )
            ],
        ),
        current_user=actor,
        audit_service=_Audit(),
    )

    assert unchanged.results[0].action == "skipped"
    assert quota_reads == [account.id]
    assert quota_diff.results[0].diff == {
        "quota_max_size_gb": {"from": 1.0, "to": 2.0},
        "quota_max_objects": {"from": 10, "to": 20},
    }


@pytest.mark.parametrize(
    "factory",
    [
        lambda: S3AccountMatch(id=1, name="Ambiguous account"),
        lambda: S3AccountSpec(
            storage_endpoint_id=1,
            storage_endpoint_name="Ambiguous endpoint",
        ),
    ],
)
def test_s3_account_contract_rejects_ambiguous_references(factory):
    with pytest.raises(ValidationError):
        factory()
