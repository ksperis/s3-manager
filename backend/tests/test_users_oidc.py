# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import uuid

import pytest

from app.db import ExternalIdentity, ExternalIdentityLinkRequest, User, UserRole
from app.services.external_identity_user_service import ExternalIdentityLinkRequiredError
from app.services.users_service import UsersService


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
    assert user.display_name == "OIDC User"
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
        display_name="Mapped",
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
