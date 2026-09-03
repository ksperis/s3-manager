# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
import uuid
from datetime import timedelta

import pytest

from app.db import (
    AuditLog,
    ExternalIdentity,
    ExternalIdentityLinkRequest,
    User,
    UserNotification,
    UserRole,
)
from app.services.external_identity_user_service import ExternalIdentityLinkRequiredError
from app.services.users_service import UsersService
from app.utils.time import utcnow


def test_get_or_create_oidc_user_creates_new_user(db_session):
    service = UsersService(db_session)

    user, created = service.get_or_create_oidc_user(
        provider="Google",
        subject="sub-123",
        email="oidc@example.com",
        full_name="OIDC User",
        picture_url="http://example.com/pic.png",
    )

    assert created is True
    assert user.email == "oidc@example.com"
    identity = db_session.query(ExternalIdentity).one()
    assert identity.user_id == user.id
    assert identity.provider_type == "oidc"
    assert identity.provider_id == "google"
    assert identity.subject == "sub-123"
    assert identity.email_verified is True
    assert user.full_name == "OIDC User"
    assert user.hashed_password is None


def test_get_or_create_oidc_user_requires_approval_for_existing_email(db_session):
    existing = User(
        email="Existing@Example.com",
        full_name="Existing",
        hashed_password="hash",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(existing)
    db_session.commit()

    service = UsersService(db_session)
    with pytest.raises(ExternalIdentityLinkRequiredError):
        service.get_or_create_oidc_user(
            provider="google",
            subject="sub-456",
            email="existing@example.com",
            full_name="Existing Linked",
            picture_url=None,
        )

    request = db_session.query(ExternalIdentityLinkRequest).one()
    assert request.user_id == existing.id
    assert request.provider_type == "oidc"
    assert request.provider_id == "google"
    assert request.subject == "sub-456"
    assert db_session.query(ExternalIdentity).count() == 0


def test_identity_link_request_notifies_authorized_admins_once_per_episode(
    db_session,
):
    existing = User(
        email="identity-target@example.com",
        hashed_password="hash",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    admin = User(
        email="identity-admin@example.com",
        hashed_password="hash",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    superadmin = User(
        email="identity-superadmin@example.com",
        hashed_password="hash",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )
    inactive_admin = User(
        email="identity-inactive@example.com",
        hashed_password="hash",
        is_active=False,
        role=UserRole.UI_ADMIN.value,
    )
    db_session.add_all([existing, admin, superadmin, inactive_admin])
    db_session.commit()
    service = UsersService(db_session)

    def request_link() -> None:
        with pytest.raises(ExternalIdentityLinkRequiredError):
            service.get_or_create_oidc_user(
                provider="google",
                subject="identity-notification-subject",
                email=existing.email,
                full_name="Identity Target",
                picture_url=None,
            )

    request_link()
    request_link()

    rows = db_session.query(UserNotification).order_by(UserNotification.user_id).all()
    assert {row.user_id for row in rows} == {admin.id, superadmin.id}
    assert {row.notification_type for row in rows} == {"identity_link_request"}
    assert {row.subject_type for row in rows} == {"identity_request"}
    assert {row.severity for row in rows} == {"warning"}
    assert all("identity-notification-subject" not in row.payload_json for row in rows)

    link_request = db_session.query(ExternalIdentityLinkRequest).one()
    link_request.expires_at = utcnow() - timedelta(seconds=1)
    db_session.add(link_request)
    db_session.commit()

    request_link()

    assert db_session.query(UserNotification).count() == 4
    assert len({row.event_key for row in db_session.query(UserNotification).all()}) == 2


def test_privileged_identity_link_request_notifies_superadmins_only(db_session):
    target = User(
        email="privileged-target@example.com",
        hashed_password="hash",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    admin = User(
        email="standard-admin@example.com",
        hashed_password="hash",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    superadmin = User(
        email="review-superadmin@example.com",
        hashed_password="hash",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )
    db_session.add_all([target, admin, superadmin])
    db_session.commit()

    with pytest.raises(ExternalIdentityLinkRequiredError):
        UsersService(db_session).get_or_create_oidc_user(
            provider="google",
            subject="privileged-notification-subject",
            email=target.email,
            full_name="Privileged Target",
            picture_url=None,
        )

    rows = db_session.query(UserNotification).all()
    assert [row.user_id for row in rows] == [superadmin.id]


def test_get_or_create_oidc_user_rejects_email_bound_to_another_identity(
    db_session,
):
    existing = User(
        email="external@example.com",
        hashed_password=None,
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(existing)
    db_session.flush()
    db_session.add(
        ExternalIdentity(
            id=str(uuid.uuid4()),
            user_id=existing.id,
            provider_type="ldap",
            provider_id="corp",
            subject="ldap-subject",
            email=existing.email,
            email_verified=False,
        )
    )
    db_session.commit()

    service = UsersService(db_session)
    with pytest.raises(ExternalIdentityLinkRequiredError):
        service.get_or_create_oidc_user(
            provider="google",
            subject="oidc-subject",
            email="EXTERNAL@example.com",
            full_name="External User",
            picture_url=None,
        )


def test_get_or_create_oidc_user_reuses_existing_mapping(db_session):
    mapped = User(
        email="mapped@example.com",
        full_name="Mapped",
        hashed_password=None,
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(mapped)
    db_session.flush()
    db_session.add(
        ExternalIdentity(
            id=str(uuid.uuid4()),
            user_id=mapped.id,
            provider_type="oidc",
            provider_id="google",
            subject="sub-999",
            email=mapped.email,
            email_verified=True,
        )
    )
    db_session.commit()

    service = UsersService(db_session)
    user, created = service.get_or_create_oidc_user(
        provider="google",
        subject="sub-999",
        email="mapped@example.com",
        full_name="Updated Name",
        picture_url=None,
    )

    assert created is False
    assert user.id == mapped.id


def test_trusted_email_policy_links_an_eligible_local_account(db_session):
    existing = User(
        email="employee@example.com",
        full_name="Employee",
        hashed_password="local-password-hash",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(existing)
    db_session.commit()

    user, created = UsersService(db_session).get_or_create_oidc_user(
        provider="company",
        subject="secret-provider-subject",
        email="EMPLOYEE@example.com",
        full_name="Employee",
        picture_url=None,
        email_verified=True,
        linking_policy="trusted_email",
        trusted_email_domains=["example.com"],
    )

    assert created is False
    assert user.id == existing.id
    identity = db_session.query(ExternalIdentity).one()
    assert identity.user_id == existing.id
    assert identity.link_source == "trusted_email"
    assert db_session.query(ExternalIdentityLinkRequest).count() == 0
    audit = db_session.query(AuditLog).filter(AuditLog.action == "external_identity_trusted_email_linked").one()
    metadata = json.loads(audit.metadata_json or "{}")
    assert metadata == {"provider_id": "company", "provider_type": "oidc"}
    assert "secret-provider-subject" not in (audit.metadata_json or "")


@pytest.mark.parametrize(
    ("role", "is_active", "hashed_password", "email_verified", "domains"),
    [
        (UserRole.UI_ADMIN.value, True, "hash", True, ["example.com"]),
        (UserRole.UI_USER.value, False, "hash", True, ["example.com"]),
        (UserRole.UI_USER.value, True, None, True, ["example.com"]),
        (UserRole.UI_USER.value, True, "hash", False, ["example.com"]),
        (UserRole.UI_USER.value, True, "hash", True, ["other.example"]),
    ],
)
def test_trusted_email_policy_falls_back_to_manual_review(
    db_session,
    role,
    is_active,
    hashed_password,
    email_verified,
    domains,
):
    existing = User(
        email="manual-review@example.com",
        hashed_password=hashed_password,
        is_active=is_active,
        role=role,
    )
    db_session.add(existing)
    db_session.commit()

    with pytest.raises(ExternalIdentityLinkRequiredError):
        UsersService(db_session).get_or_create_oidc_user(
            provider="company",
            subject=f"manual-{role}-{is_active}-{email_verified}-{domains[0]}",
            email=existing.email,
            full_name=None,
            picture_url=None,
            email_verified=email_verified,
            linking_policy="trusted_email",
            trusted_email_domains=domains,
        )

    request = db_session.query(ExternalIdentityLinkRequest).one()
    assert request.user_id == existing.id
    assert request.status == "pending"
    assert db_session.query(ExternalIdentity).count() == 0


def test_trusted_email_policy_rejects_accounts_with_revoked_identity_history(db_session):
    existing = User(
        email="previously-federated@example.com",
        hashed_password="hash",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(existing)
    db_session.flush()
    revoked = ExternalIdentity(
        id=str(uuid.uuid4()),
        user_id=existing.id,
        provider_type="ldap",
        provider_id="legacy",
        subject="legacy-subject",
        email=existing.email,
        email_verified=False,
    )
    revoked.revoked_at = utcnow()
    db_session.add(revoked)
    db_session.commit()

    with pytest.raises(ExternalIdentityLinkRequiredError):
        UsersService(db_session).get_or_create_oidc_user(
            provider="company",
            subject="new-subject",
            email=existing.email,
            full_name=None,
            picture_url=None,
            email_verified=True,
            linking_policy="trusted_email",
            trusted_email_domains=["example.com"],
        )

    assert db_session.query(ExternalIdentity).count() == 1
    assert db_session.query(ExternalIdentityLinkRequest).count() == 1
