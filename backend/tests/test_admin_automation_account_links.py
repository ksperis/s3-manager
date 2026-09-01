# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.db import ManagerAccountRole, PortalAccountRole, S3Account, User, UserRole, UserS3Account
from app.models.admin_automation import (
    AccountLinkAccountRef,
    AccountLinkApply,
    AccountLinkUserRef,
    AdminAutomationApplyRequest,
)
from app.services.admin_automation_service import AdminAutomationService
from app.services import users_service as users_service_module
from tests.s3_account_factory import make_s3_account


class _Audit:
    def __init__(self) -> None:
        self.actions: list[dict] = []

    def record_action(self, **kwargs) -> None:
        self.actions.append(kwargs)


def _user(db_session, *, email: str, role: str) -> User:
    user = User(
        email=email,
        hashed_password="x",
        is_active=True,
        role=role,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _account(db_session, *, name: str = "Automation account") -> S3Account:
    account = make_s3_account(
        db_session,
        name=name,
        rgw_account_id="RGW-AUTOMATION-ACCOUNT",
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def test_automation_creates_account_link_with_canonical_result_key(db_session):
    actor = _user(
        db_session,
        email="account-link-actor@example.com",
        role=UserRole.UI_SUPERADMIN.value,
    )
    target = _user(
        db_session,
        email="account-link-target@example.com",
        role=UserRole.UI_USER.value,
    )
    account = _account(db_session)
    audit = _Audit()

    result = AdminAutomationService(db_session).apply(
        AdminAutomationApplyRequest(
            account_links=[
                AccountLinkApply(
                    user=AccountLinkUserRef(email=target.email),
                    account=AccountLinkAccountRef(name=account.name),
                    manager_role=None,
                    portal_role=PortalAccountRole.PORTAL_USER.value,
                )
            ]
        ),
        current_user=actor,
        audit_service=audit,
    )

    link = (
        db_session.query(UserS3Account)
        .filter_by(user_id=target.id, account_id=account.id)
        .one()
    )
    assert result.success is True
    assert result.results[0].action == "created"
    assert result.results[0].id == str(link.id)
    assert result.results[0].key == (
        f"user[email={target.email}],account[name={account.name}]"
    )
    assert link.manager_role is None
    assert link.portal_role == PortalAccountRole.PORTAL_USER.value
    assert audit.actions[0]["metadata"]["manager_role"] is None
    assert audit.actions[0]["metadata"]["portal_role"] == PortalAccountRole.PORTAL_USER.value


def test_automation_updates_existing_account_link_role(db_session):
    actor = _user(
        db_session,
        email="account-link-update-actor@example.com",
        role=UserRole.UI_SUPERADMIN.value,
    )
    target = _user(
        db_session,
        email="account-link-update-target@example.com",
        role=UserRole.UI_USER.value,
    )
    account = _account(db_session)
    link = UserS3Account(
        user_id=target.id,
        account_id=account.id,
        manager_role=None,
        portal_role=PortalAccountRole.PORTAL_USER.value,
    )
    db_session.add(link)
    db_session.commit()

    result = AdminAutomationService(db_session).apply(
        AdminAutomationApplyRequest(
            account_links=[
                AccountLinkApply(
                    user=AccountLinkUserRef(id=target.id),
                    account=AccountLinkAccountRef(id=account.id),
                    manager_role=None,
                    portal_role=PortalAccountRole.PORTAL_MANAGER.value,
                )
            ]
        ),
        current_user=actor,
        audit_service=_Audit(),
    )

    db_session.refresh(link)
    assert result.success is True
    assert result.results[0].diff == {
        "manager_role": {"from": None, "to": None},
        "portal_role": {
            "from": PortalAccountRole.PORTAL_USER.value,
            "to": PortalAccountRole.PORTAL_MANAGER.value,
        }
    }
    assert link.manager_role is None
    assert link.portal_role == PortalAccountRole.PORTAL_MANAGER.value


def test_automation_unassigns_through_portal_role_sync_boundary(
    db_session,
    monkeypatch,
):
    actor = _user(
        db_session,
        email="account-link-delete-actor@example.com",
        role=UserRole.UI_SUPERADMIN.value,
    )
    target = _user(
        db_session,
        email="account-link-delete-target@example.com",
        role=UserRole.UI_USER.value,
    )
    account = _account(db_session)
    link = UserS3Account(
        user_id=target.id,
        account_id=account.id,
        manager_role=None,
        portal_role=PortalAccountRole.PORTAL_MANAGER.value,
    )
    db_session.add(link)
    db_session.commit()
    before = {(target.id, account.id): PortalAccountRole.PORTAL_MANAGER.value}
    after = {(target.id, account.id): None}
    snapshots = iter((before, after))
    sync_calls: list[tuple[str, dict, dict]] = []
    monkeypatch.setattr(
        users_service_module,
        "capture_effective_portal_roles",
        lambda *_args, **_kwargs: next(snapshots),
    )
    monkeypatch.setattr(
        users_service_module,
        "sync_portal_role_downgrades",
        lambda _db, *, before, after: sync_calls.append(("down", before, after)),
    )
    monkeypatch.setattr(
        users_service_module,
        "sync_portal_role_promotions",
        lambda _db, *, before, after: sync_calls.append(("up", before, after)),
    )

    result = AdminAutomationService(db_session).apply(
        AdminAutomationApplyRequest(
            account_links=[
                AccountLinkApply(
                    state="absent",
                    user=AccountLinkUserRef(id=target.id),
                    account=AccountLinkAccountRef(id=account.id),
                    manager_role=None,
                    portal_role=None,
                )
            ]
        ),
        current_user=actor,
        audit_service=_Audit(),
    )

    assert result.success is True
    assert result.results[0].action == "deleted"
    assert (
        db_session.query(UserS3Account)
        .filter_by(user_id=target.id, account_id=account.id)
        .first()
        is None
    )
    assert sync_calls == [
        ("down", before, after),
        ("up", before, after),
    ]


def test_automation_can_remove_former_root_account_link(db_session):
    actor = _user(
        db_session,
        email="root-link-actor@example.com",
        role=UserRole.UI_SUPERADMIN.value,
    )
    target = _user(
        db_session,
        email="root-link-target@example.com",
        role=UserRole.UI_USER.value,
    )
    account = _account(db_session)
    link = UserS3Account(
        user_id=target.id,
        account_id=account.id,
        manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
        portal_role=None,
    )
    db_session.add(link)
    db_session.commit()

    result = AdminAutomationService(db_session).apply(
        AdminAutomationApplyRequest(
            account_links=[
                AccountLinkApply(
                    state="absent",
                    user=AccountLinkUserRef(id=target.id),
                    account=AccountLinkAccountRef(id=account.id),
                    manager_role=None,
                    portal_role=None,
                )
            ]
        ),
        current_user=actor,
        audit_service=_Audit(),
    )

    assert result.success is True
    assert result.results[0].action == "deleted"
    assert db_session.query(UserS3Account).filter_by(id=link.id).first() is None


@pytest.mark.parametrize(
    "reference",
    [
        lambda: AccountLinkUserRef(id=1, email="ambiguous@example.com"),
        lambda: AccountLinkAccountRef(id=1, name="Ambiguous account"),
    ],
)
def test_account_link_references_reject_ambiguous_selectors(reference):
    with pytest.raises(ValidationError, match="requires exactly one"):
        reference()
