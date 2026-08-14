# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.db import (
    S3User,
    StorageEndpoint,
    StorageProvider,
    User,
    UserRole,
    UserS3User,
)
from app.models.admin_automation import (
    AdminAutomationApplyRequest,
    S3UserApply,
    S3UserMatch,
    S3UserSpec,
)
from app.services.admin_automation_service import AdminAutomationService


class _Audit:
    def __init__(self) -> None:
        self.actions: list[dict] = []

    def record_action(self, **kwargs) -> None:
        self.actions.append(kwargs)


def _ui_user(db_session, *, email: str) -> User:
    user = User(
        email=email,
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _actor(db_session) -> User:
    actor = _ui_user(db_session, email="s3-user-automation@example.com")
    actor.role = UserRole.UI_SUPERADMIN.value
    db_session.add(actor)
    db_session.commit()
    db_session.refresh(actor)
    return actor


def _endpoint(db_session) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="S3 user automation endpoint",
        endpoint_url="https://s3-user-automation.example.com",
        provider=StorageProvider.CEPH.value,
        is_default=True,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def _s3_user(db_session, *, endpoint_id: int) -> S3User:
    s3_user = S3User(
        name="Existing automation S3 user",
        rgw_user_uid="existing-automation-s3-user",
        email="existing-s3-user@example.com",
        rgw_access_key="EXISTING-S3-ACCESS-KEY",
        rgw_secret_key="existing-s3-secret-key",
        storage_endpoint_id=endpoint_id,
    )
    db_session.add(s3_user)
    db_session.commit()
    db_session.refresh(s3_user)
    return s3_user


def test_automation_create_applies_user_links_through_public_update(
    db_session,
    monkeypatch,
):
    actor = _actor(db_session)
    endpoint = _endpoint(db_session)
    first_user = _ui_user(db_session, email="first-s3-link@example.com")
    second_user = _ui_user(db_session, email="second-s3-link@example.com")
    service = AdminAutomationService(db_session)
    created = SimpleNamespace(
        id=51,
        name="Created automation S3 user",
        rgw_user_uid="created-automation-s3-user",
    )
    updates = []
    monkeypatch.setattr(
        service.s3_user_handler.users,
        "create_user",
        lambda _payload: created,
    )
    monkeypatch.setattr(
        service.s3_user_handler.users,
        "update_user",
        lambda user_id, payload: updates.append((user_id, payload)) or created,
    )

    result = service.apply(
        AdminAutomationApplyRequest(
            s3_users=[
                S3UserApply(
                    match=S3UserMatch(uid="created-automation-s3-user"),
                    spec=S3UserSpec(
                        name="Created automation S3 user",
                        storage_endpoint_id=endpoint.id,
                        user_ids=[second_user.id, first_user.id, second_user.id],
                    ),
                )
            ]
        ),
        current_user=actor,
        audit_service=_Audit(),
    )

    assert result.success is True
    assert result.results[0].id == "51"
    assert updates[0][0] == 51
    assert [link.user_id for link in updates[0][1].user_links] == sorted(
        [first_user.id, second_user.id]
    )


def test_automation_registers_db_user_and_uses_public_update_for_links_and_quota(
    db_session,
    monkeypatch,
):
    actor = _actor(db_session)
    endpoint = _endpoint(db_session)
    linked_user = _ui_user(db_session, email="registered-s3-link@example.com")
    service = AdminAutomationService(db_session)
    updates = []
    monkeypatch.setattr(
        service.s3_user_handler.users,
        "update_user",
        lambda user_id, payload: updates.append((user_id, payload)),
    )

    result = service.apply(
        AdminAutomationApplyRequest(
            s3_users=[
                S3UserApply(
                    action="register",
                    match=S3UserMatch(uid="registered-automation-s3-user"),
                    spec=S3UserSpec(
                        name="Registered automation S3 user",
                        rgw_access_key="REGISTERED-S3-ACCESS-KEY",
                        rgw_secret_key="registered-s3-secret-key",
                        quota_max_size_gb=3,
                        quota_max_objects=300,
                        storage_endpoint_id=endpoint.id,
                        user_ids=[linked_user.id],
                    ),
                )
            ]
        ),
        current_user=actor,
        audit_service=_Audit(),
    )

    registered = (
        db_session.query(S3User)
        .filter(S3User.rgw_user_uid == "registered-automation-s3-user")
        .one()
    )
    assert result.success is True
    assert result.results[0].id == str(registered.id)
    assert updates[0][0] == registered.id
    assert updates[0][1].quota_max_size_gb == 3
    assert updates[0][1].quota_max_objects == 300
    assert [link.user_id for link in updates[0][1].user_links] == [linked_user.id]


def test_automation_updates_credentials_without_empty_user_update(
    db_session,
    monkeypatch,
):
    actor = _actor(db_session)
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint_id=endpoint.id)
    service = AdminAutomationService(db_session)
    monkeypatch.setattr(
        service.s3_user_handler.users,
        "update_user",
        lambda *_args, **_kwargs: pytest.fail("empty S3 user update must be skipped"),
    )
    audit = _Audit()

    result = service.apply(
        AdminAutomationApplyRequest(
            s3_users=[
                S3UserApply(
                    match=S3UserMatch(id=s3_user.id),
                    spec=S3UserSpec(
                        rgw_access_key="REPLACEMENT-S3-ACCESS-KEY",
                        rgw_secret_key="replacement-s3-secret-key",
                    ),
                )
            ]
        ),
        current_user=actor,
        audit_service=audit,
    )

    db_session.refresh(s3_user)
    assert result.success is True
    assert s3_user.rgw_access_key == "REPLACEMENT-S3-ACCESS-KEY"
    assert s3_user.rgw_secret_key == "replacement-s3-secret-key"
    assert audit.actions[0]["metadata"]["credential_fields_updated"] == [
        "rgw_access_key",
        "rgw_secret_key",
    ]


def test_automation_uses_public_quota_reader_and_skips_unchanged_secret(
    db_session,
    monkeypatch,
):
    actor = _actor(db_session)
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint_id=endpoint.id)
    service = AdminAutomationService(db_session)
    quota_reads = []
    monkeypatch.setattr(
        service.s3_user_handler.users,
        "get_user_quota",
        lambda current: quota_reads.append(current.id) or (1.0, 10),
    )

    unchanged = service.apply(
        AdminAutomationApplyRequest(
            s3_users=[
                S3UserApply(
                    match=S3UserMatch(id=s3_user.id),
                    spec=S3UserSpec(rgw_secret_key="existing-s3-secret-key"),
                )
            ]
        ),
        current_user=actor,
        audit_service=_Audit(),
    )
    quota_diff = service.apply(
        AdminAutomationApplyRequest(
            dry_run=True,
            s3_users=[
                S3UserApply(
                    match=S3UserMatch(id=s3_user.id),
                    spec=S3UserSpec(
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
    assert quota_reads == [s3_user.id]
    assert quota_diff.results[0].diff == {
        "quota_max_size_gb": {"from": 1.0, "to": 2.0},
        "quota_max_objects": {"from": 10, "to": 20},
    }


def test_automation_db_only_delete_does_not_build_rgw_client(
    db_session,
    monkeypatch,
):
    actor = _actor(db_session)
    endpoint = _endpoint(db_session)
    linked_user = _ui_user(db_session, email="deleted-s3-link@example.com")
    s3_user = _s3_user(db_session, endpoint_id=endpoint.id)
    db_session.add(UserS3User(user_id=linked_user.id, s3_user_id=s3_user.id))
    db_session.commit()
    service = AdminAutomationService(db_session)
    monkeypatch.setattr(
        service.s3_user_handler.users,
        "_admin_for_user",
        lambda *_args, **_kwargs: pytest.fail("RGW client must not be built"),
    )

    result = service.apply(
        AdminAutomationApplyRequest(
            s3_users=[
                S3UserApply(
                    state="absent",
                    match=S3UserMatch(id=s3_user.id),
                )
            ]
        ),
        current_user=actor,
        audit_service=_Audit(),
    )

    assert result.success is True
    assert db_session.query(S3User).filter(S3User.id == s3_user.id).first() is None
    assert (
        db_session.query(UserS3User)
        .filter(UserS3User.s3_user_id == s3_user.id)
        .first()
        is None
    )


@pytest.mark.parametrize(
    "factory",
    [
        lambda: S3UserMatch(id=1, uid="ambiguous-user"),
        lambda: S3UserSpec(
            storage_endpoint_id=1,
            storage_endpoint_url="https://ambiguous.example.com",
        ),
    ],
)
def test_s3_user_contract_rejects_ambiguous_references(factory):
    with pytest.raises(ValidationError):
        factory()
