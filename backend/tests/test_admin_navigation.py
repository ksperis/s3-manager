# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import timedelta

from app.db import (
    ExternalIdentityLinkRequest,
    PortalAdminRequest,
    User,
    UserRole,
)
from app.main import app
from app.routers import dependencies
from app.utils.time import utcnow
from tests.s3_account_factory import make_s3_account


def _user(db_session, *, email: str, role: str) -> User:
    user = User(
        email=email,
        full_name=email.split("@")[0],
        hashed_password="x",
        is_active=True,
        role=role,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_pending_request_counts_follow_status_expiry_and_role_visibility(client, db_session):
    standard = _user(db_session, email="standard@example.org", role=UserRole.UI_USER.value)
    privileged = _user(db_session, email="privileged@example.org", role=UserRole.UI_ADMIN.value)
    account = make_s3_account(db_session, name="Research")
    db_session.add(account)
    db_session.commit()
    now = utcnow()
    db_session.add_all(
        [
            ExternalIdentityLinkRequest(
                id="standard-pending",
                user_id=standard.id,
                provider_type="oidc",
                provider_id="company",
                subject="standard-pending",
                email=standard.email,
                status="pending",
                created_at=now,
                expires_at=now + timedelta(hours=1),
            ),
            ExternalIdentityLinkRequest(
                id="privileged-pending",
                user_id=privileged.id,
                provider_type="oidc",
                provider_id="company",
                subject="privileged-pending",
                email=privileged.email,
                status="pending",
                created_at=now,
                expires_at=now + timedelta(hours=1),
            ),
            ExternalIdentityLinkRequest(
                id="expired-pending",
                user_id=standard.id,
                provider_type="oidc",
                provider_id="company",
                subject="expired-pending",
                email=standard.email,
                status="pending",
                created_at=now - timedelta(hours=2),
                expires_at=now - timedelta(hours=1),
            ),
            ExternalIdentityLinkRequest(
                id="approved-identity",
                user_id=standard.id,
                provider_type="oidc",
                provider_id="company",
                subject="approved-identity",
                email=standard.email,
                status="approved",
                created_at=now,
                expires_at=now + timedelta(hours=1),
            ),
            PortalAdminRequest(
                account_id=account.id,
                requester_user_id=standard.id,
                requester_email=standard.email,
                request_type="portal_user_access",
                status="pending",
                payload_json="{}",
                created_at=now,
                updated_at=now,
            ),
            PortalAdminRequest(
                account_id=account.id,
                requester_user_id=standard.id,
                requester_email=standard.email,
                request_type="portal_user_access",
                status="processing",
                payload_json="{}",
                created_at=now,
                updated_at=now,
            ),
            PortalAdminRequest(
                account_id=account.id,
                requester_user_id=standard.id,
                requester_email=standard.email,
                request_type="portal_user_access",
                status="failed",
                payload_json="{}",
                created_at=now,
                updated_at=now,
            ),
        ]
    )
    db_session.commit()

    admin = _user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: admin
    admin_response = client.get("/api/admin/navigation/pending-requests")

    assert admin_response.status_code == 200
    assert admin_response.json() == {
        "identity_link_requests": 1,
        "portal_requests": 1,
    }

    superadmin = _user(db_session, email="superadmin@example.org", role=UserRole.UI_SUPERADMIN.value)
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: superadmin
    superadmin_response = client.get("/api/admin/navigation/pending-requests")

    assert superadmin_response.status_code == 200
    assert superadmin_response.json() == {
        "identity_link_requests": 2,
        "portal_requests": 1,
    }


def test_pending_request_counts_require_admin_authentication(client):
    app.dependency_overrides.pop(dependencies.get_current_super_admin)

    response = client.get("/api/admin/navigation/pending-requests")

    assert response.status_code == 401
