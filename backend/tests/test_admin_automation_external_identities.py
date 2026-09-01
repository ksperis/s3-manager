# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import ExternalIdentity, User, UserRole
from app.models.admin_automation import (
    AdminAutomationApplyRequest,
    ExternalIdentityApply,
    ExternalIdentityMatch,
    ExternalIdentitySpec,
    ExternalIdentityUserRef,
)
from app.services.admin_automation_service import AdminAutomationService


class _Audit:
    def __init__(self) -> None:
        self.actions: list[dict] = []

    def record_action(self, **kwargs) -> None:
        self.actions.append(kwargs)


def _user(db_session, *, email: str, role: str = UserRole.UI_USER.value) -> User:
    row = User(
        email=email,
        hashed_password="local-password-hash",
        is_active=True,
        role=role,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _payload(target: User, *, state: str = "present", restore: bool = False) -> AdminAutomationApplyRequest:
    return AdminAutomationApplyRequest(
        external_identities=[
            ExternalIdentityApply(
                state=state,
                match=ExternalIdentityMatch(
                    provider_type="oidc",
                    provider_id="Company",
                    subject="sensitive-subject",
                ),
                user=ExternalIdentityUserRef(id=target.id),
                spec=ExternalIdentitySpec(email=target.email, email_verified=True),
                restore=restore,
            )
        ]
    )


def test_external_identity_provisioning_supports_dry_run_and_idempotence(db_session):
    actor = _user(db_session, email="automation-superadmin@example.com", role=UserRole.UI_SUPERADMIN.value)
    target = _user(db_session, email="automation-target@example.com")
    service = AdminAutomationService(db_session)
    audit = _Audit()

    dry_run_payload = _payload(target)
    dry_run_payload.dry_run = True
    preview = service.apply(dry_run_payload, current_user=actor, audit_service=audit)
    assert preview.success is True
    assert preview.results[0].action == "created"
    assert preview.results[0].dry_run is True
    assert db_session.query(ExternalIdentity).count() == 0

    applied = service.apply(_payload(target), current_user=actor, audit_service=audit)
    repeated = service.apply(_payload(target), current_user=actor, audit_service=audit)

    assert applied.results[0].action == "created"
    assert repeated.results[0].action == "skipped"
    identity = db_session.query(ExternalIdentity).one()
    assert identity.user_id == target.id
    assert identity.provider_id == "company"
    assert identity.link_source == "automation"
    serialized_audit = str([action.get("metadata") for action in audit.actions])
    assert "sensitive-subject" not in serialized_audit


def test_external_identity_provisioning_reports_subject_conflict(db_session):
    actor = _user(db_session, email="conflict-superadmin@example.com", role=UserRole.UI_SUPERADMIN.value)
    owner = _user(db_session, email="identity-owner@example.com")
    other = _user(db_session, email="identity-other@example.com")
    service = AdminAutomationService(db_session)
    service.apply(_payload(owner), current_user=actor, audit_service=_Audit())

    result = service.apply(_payload(other), current_user=actor, audit_service=_Audit())

    assert result.success is False
    assert result.results[0].action == "failed"
    assert result.results[0].error == "External identity subject belongs to another user"


def test_external_identity_provisioning_requires_explicit_restore(db_session):
    actor = _user(db_session, email="restore-superadmin@example.com", role=UserRole.UI_SUPERADMIN.value)
    target = _user(db_session, email="restore-target@example.com")
    service = AdminAutomationService(db_session)
    audit = _Audit()
    assert service.apply(_payload(target), current_user=actor, audit_service=audit).success is True

    revoked = service.apply(_payload(target, state="absent"), current_user=actor, audit_service=audit)
    denied = service.apply(_payload(target), current_user=actor, audit_service=audit)
    restored = service.apply(_payload(target, restore=True), current_user=actor, audit_service=audit)

    assert revoked.results[0].action == "deleted"
    assert denied.success is False
    assert "explicit restoration" in (denied.results[0].error or "")
    assert restored.results[0].action == "updated"
    identity = db_session.query(ExternalIdentity).one()
    assert identity.revoked_at is None


def test_ui_admin_cannot_provision_identity_for_privileged_user(db_session):
    actor = _user(db_session, email="identity-admin@example.com", role=UserRole.UI_ADMIN.value)
    target = _user(db_session, email="identity-admin-target@example.com", role=UserRole.UI_ADMIN.value)

    result = AdminAutomationService(db_session).apply(
        _payload(target),
        current_user=actor,
        audit_service=_Audit(),
    )

    assert result.success is False
    assert result.results[0].error == "Administrators can manage only standard users"
