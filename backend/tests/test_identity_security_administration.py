# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.db import (
    AppSetting,
    AuditLog,
    AuthChallenge,
    ExternalIdentity,
    ExternalIdentityLinkRequest,
    RecoveryCode,
    S3Session,
    User,
    UserRole,
    WebAuthnCredential,
)
from app.main import app
from app.models.app_settings import AppSettings
from app.routers import dependencies
from app.services.api_token_service import ApiTokenService
from app.services import app_settings_service
from app.services.app_settings_service import load_app_settings_for_db
from app.services.auth_session_service import AuthSessionService
from app.services.mfa_reset_service import MfaResetService
from app.utils.time import utcnow
from tests.auth_test_utils import authenticate_ui_client, clear_ui_client, trusted_origin_headers


@pytest.fixture
def auth_client(db_session):
    def override_get_db():
        yield db_session

    app.dependency_overrides[dependencies.get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides = {}


def _user(db_session, *, email: str, role: str) -> User:
    row = User(
        email=email,
        full_name=email.split("@", 1)[0],
        hashed_password="local-password-hash",
        is_active=True,
        role=role,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _set_admin_passkey_policy(db_session, required: bool) -> None:
    load_app_settings_for_db(db_session)
    row = db_session.query(AppSetting).filter(AppSetting.key == "default").one()
    settings = AppSettings.model_validate_json(row.payload_json)
    settings.general.require_passkey_for_admins = required
    row.payload_json = settings.model_dump_json(indent=2)
    db_session.add(row)
    db_session.commit()


def test_common_mfa_reset_removes_all_factors_sessions_and_tokens(db_session):
    target = _user(db_session, email="reset-target@example.com", role=UserRole.UI_ADMIN.value)
    db_session.add_all(
        [
            WebAuthnCredential(
                id="reset-passkey",
                user_id=target.id,
                credential_id="reset-passkey-credential",
                public_key="public-key",
                sign_count=0,
                transports_json="[]",
                name="Passkey",
            ),
            RecoveryCode(
                id="reset-recovery",
                user_id=target.id,
                code_hash="reset-recovery-hash",
            ),
            AuthChallenge(
                id="reset-challenge",
                user_id=target.id,
                binding_sid="pre-auth",
                purpose="authentication",
                challenge_hash="reset-challenge-hash",
                payload_json="{}",
                expires_at=utcnow() + timedelta(minutes=5),
            ),
        ]
    )
    db_session.commit()
    session = AuthSessionService(db_session).create_for_user(
        target,
        auth_type="password",
        ip_address="127.0.0.1",
        user_agent="pytest",
        mfa_verified=True,
    ).session
    _, token = ApiTokenService(db_session).create_for_user(
        target,
        name="before-reset",
        scopes=["profile:read"],
    )
    previous_version = target.auth_version

    result = MfaResetService(db_session).reset(target, reason="test_mfa_reset")

    assert result.passkeys_removed == 1
    assert result.recovery_codes_removed == 1
    assert result.challenges_removed == 1
    assert db_session.query(WebAuthnCredential).count() == 0
    assert db_session.query(RecoveryCode).count() == 0
    assert db_session.query(AuthChallenge).count() == 0
    db_session.refresh(target)
    db_session.refresh(session)
    db_session.refresh(token)
    assert target.auth_version == previous_version + 1
    assert session.revoked_at is not None
    assert token.revoked_at is not None


def test_admin_mfa_reset_honors_role_hierarchy(auth_client, db_session):
    _set_admin_passkey_policy(db_session, False)
    admin = _user(db_session, email="reset-admin@example.com", role=UserRole.UI_ADMIN.value)
    standard = _user(db_session, email="reset-standard@example.com", role=UserRole.UI_USER.value)
    privileged = _user(db_session, email="reset-privileged@example.com", role=UserRole.UI_ADMIN.value)
    admin_credentials = authenticate_ui_client(auth_client, db_session, admin, mfa_verified=False)

    standard_response = auth_client.post(
        f"/api/admin/users/{standard.id}/mfa/reset",
        headers=trusted_origin_headers(csrf_token=admin_credentials.csrf_token),
    )
    privileged_response = auth_client.post(
        f"/api/admin/users/{privileged.id}/mfa/reset",
        headers=trusted_origin_headers(csrf_token=admin_credentials.csrf_token),
    )

    assert standard_response.status_code == 200
    assert standard_response.json()["passkey_enrollment_required"] is False
    assert privileged_response.status_code == 403

    clear_ui_client(auth_client)
    superadmin = _user(db_session, email="reset-superadmin@example.com", role=UserRole.UI_SUPERADMIN.value)
    super_credentials = authenticate_ui_client(auth_client, db_session, superadmin, mfa_verified=False)
    privileged_response = auth_client.post(
        f"/api/admin/users/{privileged.id}/mfa/reset",
        headers=trusted_origin_headers(csrf_token=super_credentials.csrf_token),
    )
    self_response = auth_client.post(
        f"/api/admin/users/{superadmin.id}/mfa/reset",
        headers=trusted_origin_headers(csrf_token=super_credentials.csrf_token),
    )

    assert privileged_response.status_code == 200
    assert self_response.status_code == 400


def test_admin_global_session_inventory_filters_privileged_accounts(auth_client, db_session):
    _set_admin_passkey_policy(db_session, False)
    admin = _user(db_session, email="session-admin@example.com", role=UserRole.UI_ADMIN.value)
    standard = _user(db_session, email="session-standard@example.com", role=UserRole.UI_USER.value)
    privileged = _user(db_session, email="session-privileged@example.com", role=UserRole.UI_SUPERADMIN.value)
    authenticate_ui_client(auth_client, db_session, admin, mfa_verified=False)
    standard_session = AuthSessionService(db_session).create_for_user(
        standard,
        auth_type="password",
        ip_address="192.0.2.10",
        user_agent="pytest-standard",
        mfa_verified=False,
    ).session
    AuthSessionService(db_session).create_for_user(
        privileged,
        auth_type="password",
        ip_address="192.0.2.11",
        user_agent="pytest-privileged",
        mfa_verified=True,
    )

    response = auth_client.get("/api/admin/identity/sessions")

    assert response.status_code == 200
    payload = response.json()
    assert [row["id"] for row in payload] == [standard_session.id]
    assert payload[0]["user_email"] == standard.email
    assert payload[0]["user_full_name"] == standard.full_name
    assert payload[0]["user_role"] == UserRole.UI_USER.value

    summary = auth_client.get("/api/admin/stats/summary")
    assert summary.status_code == 200
    assert summary.json()["total_active_sessions"] == len(payload)
    assert summary.json()["active_sessions_by_type"] == {"ui": len(payload), "s3": 0}


def test_superadmin_session_summary_groups_ui_and_s3_sessions(auth_client, db_session):
    superadmin = _user(db_session, email="summary-superadmin@example.com", role=UserRole.UI_SUPERADMIN.value)
    standard = _user(db_session, email="summary-standard@example.com", role=UserRole.UI_USER.value)
    authenticate_ui_client(auth_client, db_session, superadmin, mfa_verified=True)
    AuthSessionService(db_session).create_for_user(
        standard,
        auth_type="password",
        ip_address="192.0.2.12",
        user_agent="pytest-standard",
        mfa_verified=False,
    )
    now = utcnow()
    s3_session = S3Session(
        id="summary-s3-session",
        access_key_enc="ACCESS",
        secret_key_enc="SECRET",
        access_key_hash="summary-hash",
        actor_type="s3_account",
        role=UserRole.UI_USER.value,
        capabilities=json.dumps({"access_browser": True}),
        created_at=now,
        last_used_at=now,
        idle_expires_at=now + timedelta(minutes=30),
        absolute_expires_at=now + timedelta(hours=8),
    )
    db_session.add(s3_session)
    db_session.commit()
    AuthSessionService(db_session).create_for_s3_session(
        s3_session,
        ip_address="192.0.2.13",
        user_agent="pytest-s3",
    )

    summary = auth_client.get("/api/admin/stats/summary")

    assert summary.status_code == 200
    assert summary.json()["total_active_sessions"] == 3
    assert summary.json()["active_sessions_by_type"] == {"ui": 2, "s3": 1}


def test_admin_link_request_queue_is_filtered_by_role_hierarchy(auth_client, db_session):
    _set_admin_passkey_policy(db_session, False)
    admin = _user(db_session, email="link-admin@example.com", role=UserRole.UI_ADMIN.value)
    standard = _user(db_session, email="link-standard@example.com", role=UserRole.UI_USER.value)
    privileged = _user(db_session, email="link-privileged@example.com", role=UserRole.UI_ADMIN.value)
    now = utcnow()
    db_session.add_all(
        [
            ExternalIdentityLinkRequest(
                id="standard-link-request",
                user_id=standard.id,
                provider_type="oidc",
                provider_id="company",
                subject="standard-sensitive-subject",
                email=standard.email,
                status="pending",
                created_at=now,
                expires_at=now + timedelta(hours=1),
            ),
            ExternalIdentityLinkRequest(
                id="privileged-link-request",
                user_id=privileged.id,
                provider_type="oidc",
                provider_id="company",
                subject="privileged-sensitive-subject",
                email=privileged.email,
                status="pending",
                created_at=now,
                expires_at=now + timedelta(hours=1),
            ),
        ]
    )
    db_session.commit()
    credentials = authenticate_ui_client(auth_client, db_session, admin, mfa_verified=False)
    headers = trusted_origin_headers(csrf_token=credentials.csrf_token)

    inventory = auth_client.get("/api/admin/identity/link-requests")
    privileged_decision = auth_client.post(
        "/api/admin/identity/link-requests/privileged-link-request",
        json={"approve": True},
        headers=headers,
    )
    standard_decision = auth_client.post(
        "/api/admin/identity/link-requests/standard-link-request",
        json={"approve": True},
        headers=headers,
    )

    assert inventory.status_code == 200
    assert [row["id"] for row in inventory.json()] == ["standard-link-request"]
    assert "subject" not in inventory.text
    assert privileged_decision.status_code == 403
    assert standard_decision.status_code == 200
    assert db_session.query(ExternalIdentity).filter(ExternalIdentity.user_id == standard.id).count() == 1
    audit = db_session.query(AuditLog).filter(AuditLog.action == "external_identity_link_decision").one()
    assert "standard-sensitive-subject" not in (audit.metadata_json or "")


def test_only_superadmin_can_manage_privileged_users_and_self_protection_applies(auth_client, db_session):
    admin = _user(db_session, email="hierarchy-admin@example.com", role=UserRole.UI_ADMIN.value)
    admin_credentials = authenticate_ui_client(auth_client, db_session, admin, mfa_verified=False)
    create_admin = auth_client.post(
        "/api/admin/users",
        json={
            "email": "forbidden-admin@example.com",
            "password": "correct horse battery staple",
            "role": UserRole.UI_ADMIN.value,
        },
        headers=trusted_origin_headers(csrf_token=admin_credentials.csrf_token),
    )
    assert create_admin.status_code == 403

    clear_ui_client(auth_client)
    superadmin = _user(db_session, email="sole-superadmin@example.com", role=UserRole.UI_SUPERADMIN.value)
    super_credentials = authenticate_ui_client(auth_client, db_session, superadmin, mfa_verified=False)
    headers = trusted_origin_headers(csrf_token=super_credentials.csrf_token)

    deactivate = auth_client.put(
        f"/api/admin/users/{superadmin.id}",
        json={"is_active": False},
        headers=headers,
    )
    demote = auth_client.put(
        f"/api/admin/users/{superadmin.id}",
        json={"role": UserRole.UI_USER.value},
        headers=headers,
    )
    delete = auth_client.delete(f"/api/admin/users/{superadmin.id}", headers=headers)

    assert deactivate.status_code == 400
    assert demote.status_code == 400
    assert delete.status_code == 400
    assert db_session.query(User).filter(User.id == superadmin.id).one().is_active is True


def test_stale_admin_session_can_read_security_data_and_revoke_access(auth_client, db_session):
    admin = _user(db_session, email="balanced-admin@example.com", role=UserRole.UI_SUPERADMIN.value)
    target = _user(db_session, email="balanced-target@example.com", role=UserRole.UI_USER.value)
    credentials = authenticate_ui_client(auth_client, db_session, admin, mfa_verified=False)
    target_session = AuthSessionService(db_session).create_for_user(
        target,
        auth_type="password",
        ip_address="192.0.2.20",
        user_agent="pytest-target",
        mfa_verified=False,
    ).session
    _, token_row = ApiTokenService(db_session).create_for_user(
        admin,
        name="balanced-revocation",
        scopes=["admin:read"],
    )
    headers = trusted_origin_headers(csrf_token=credentials.csrf_token)

    assert auth_client.get(f"/api/admin/users/{target.id}/security").status_code == 200
    assert auth_client.get("/api/admin/identity/link-requests").status_code == 200
    assert auth_client.get("/api/admin/identity/sessions").status_code == 200
    assert auth_client.get("/api/auth/api-tokens").status_code == 200
    assert auth_client.delete(
        f"/api/admin/identity/sessions/{target_session.id}",
        headers=headers,
    ).status_code == 204
    assert auth_client.delete(
        f"/api/auth/api-tokens/{token_row.id}",
        headers=headers,
    ).status_code == 204


def test_stale_admin_session_rejects_only_critical_link_decision(auth_client, db_session):
    admin = _user(db_session, email="decision-admin@example.com", role=UserRole.UI_SUPERADMIN.value)
    target = _user(db_session, email="decision-target@example.com", role=UserRole.UI_USER.value)
    now = utcnow()
    db_session.add_all(
        [
            ExternalIdentityLinkRequest(
                id="reject-without-step-up",
                user_id=target.id,
                provider_type="oidc",
                provider_id="company",
                subject="reject-subject",
                email=target.email,
                status="pending",
                created_at=now,
                expires_at=now + timedelta(hours=1),
            ),
            ExternalIdentityLinkRequest(
                id="approve-with-step-up",
                user_id=target.id,
                provider_type="oidc",
                provider_id="company",
                subject="approve-subject",
                email=target.email,
                status="pending",
                created_at=now,
                expires_at=now + timedelta(hours=1),
            ),
        ]
    )
    db_session.commit()
    credentials = authenticate_ui_client(auth_client, db_session, admin, mfa_verified=False)
    headers = trusted_origin_headers(csrf_token=credentials.csrf_token)

    rejected = auth_client.post(
        "/api/admin/identity/link-requests/reject-without-step-up",
        json={"approve": False},
        headers=headers,
    )
    approved = auth_client.post(
        "/api/admin/identity/link-requests/approve-with-step-up",
        json={"approve": True},
        headers=headers,
    )

    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    assert approved.status_code == 403
    assert approved.json()["detail"] == "Recent WebAuthn verification required"


def test_user_update_step_up_depends_on_persisted_security_change(auth_client, db_session):
    admin = _user(db_session, email="user-guard-admin@example.com", role=UserRole.UI_SUPERADMIN.value)
    target = _user(db_session, email="user-guard-target@example.com", role=UserRole.UI_USER.value)
    credentials = authenticate_ui_client(auth_client, db_session, admin, mfa_verified=False)
    headers = trusted_origin_headers(csrf_token=credentials.csrf_token)

    name_only = auth_client.put(
        f"/api/admin/users/{target.id}",
        json={"full_name": "Updated Name"},
        headers=headers,
    )
    identical_role = auth_client.put(
        f"/api/admin/users/{target.id}",
        json={"role": UserRole.UI_USER.value},
        headers=headers,
    )
    role_change = auth_client.put(
        f"/api/admin/users/{target.id}",
        json={"role": UserRole.UI_NONE.value},
        headers=headers,
    )

    assert name_only.status_code == 200
    assert name_only.json()["full_name"] == "Updated Name"
    assert identical_role.status_code == 200
    assert role_change.status_code == 403
    assert role_change.json()["detail"] == "Recent WebAuthn verification required"

    _set_admin_passkey_policy(db_session, False)
    role_change_without_policy = auth_client.put(
        f"/api/admin/users/{target.id}",
        json={"role": UserRole.UI_NONE.value},
        headers=headers,
    )
    assert role_change_without_policy.status_code == 200
    assert role_change_without_policy.json()["role"] == UserRole.UI_NONE.value


def test_stale_session_must_step_up_for_user_creation_and_deletion(auth_client, db_session):
    admin = _user(db_session, email="user-mutation-admin@example.com", role=UserRole.UI_SUPERADMIN.value)
    target = _user(db_session, email="user-mutation-target@example.com", role=UserRole.UI_USER.value)
    credentials = authenticate_ui_client(auth_client, db_session, admin, mfa_verified=False)
    headers = trusted_origin_headers(csrf_token=credentials.csrf_token)

    created = auth_client.post(
        "/api/admin/users",
        json={
            "email": "blocked-create@example.com",
            "password": "correct horse battery staple",
            "role": UserRole.UI_USER.value,
        },
        headers=headers,
    )
    deleted = auth_client.delete(f"/api/admin/users/{target.id}", headers=headers)

    assert created.status_code == 403
    assert deleted.status_code == 403
    assert db_session.query(User).filter(User.id == target.id).first() is not None


def test_authentication_setting_change_is_guarded_before_side_effects(auth_client, db_session, monkeypatch):
    @contextmanager
    def settings_session():
        yield db_session

    monkeypatch.setattr(app_settings_service, "_open_settings_session", settings_session)
    admin = _user(db_session, email="settings-guard-admin@example.com", role=UserRole.UI_SUPERADMIN.value)
    credentials = authenticate_ui_client(auth_client, db_session, admin, mfa_verified=False)
    headers = trusted_origin_headers(csrf_token=credentials.csrf_token)
    current = load_app_settings_for_db(db_session)

    unchanged = auth_client.put(
        "/api/admin/settings",
        json=current.model_dump(mode="json"),
        headers=headers,
    )
    weakened = current.model_copy(deep=True)
    weakened.general.require_passkey_for_admins = False
    disabling_policy = auth_client.put(
        "/api/admin/settings",
        json=weakened.model_dump(mode="json"),
        headers=headers,
    )

    assert unchanged.status_code == 200
    assert disabling_policy.status_code == 403
    assert disabling_policy.json()["detail"] == "Recent WebAuthn verification required"
    assert load_app_settings_for_db(db_session).general.require_passkey_for_admins is True


def test_bearer_token_is_denied_on_direct_identity_routes_but_allowed_for_automation(auth_client, db_session):
    admin = _user(db_session, email="automation-exception@example.com", role=UserRole.UI_SUPERADMIN.value)
    api_token, _ = ApiTokenService(db_session).create_for_user(
        admin,
        name="automation-exception",
        scopes=["admin:read", "admin:write"],
    )
    clear_ui_client(auth_client)
    authorization = {"Authorization": f"Bearer {api_token}"}

    direct = auth_client.get("/api/admin/users/minimal", headers=authorization)
    automation = auth_client.post(
        "/api/admin/automation/apply",
        json={},
        headers=authorization,
    )

    assert direct.status_code == 401
    assert direct.json()["detail"] == "UI session required"
    assert automation.status_code == 200
    assert automation.json()["success"] is True


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        (
            "/api/admin/settings/oidc/providers",
            {
                "provider_id": "guarded-oidc",
                "display_name": "Guarded OIDC",
                "discovery_url": "https://issuer.example.test/.well-known/openid-configuration",
                "client_id": "client-id",
                "redirect_uri": "https://app.example.test/auth/callback",
                "scopes": ["openid"],
                "enabled": True,
                "use_pkce": True,
                "use_nonce": True,
            },
        ),
        (
            "/api/admin/settings/ldap/providers",
            {
                "provider_id": "guarded-ldap",
                "display_name": "Guarded LDAP",
                "url": "ldaps://ldap.example.test",
                "bind_dn": "",
                "bind_password": "",
                "user_base_dn": "ou=people,dc=example,dc=test",
                "user_filter": "(uid={username})",
                "email_attribute": "mail",
                "name_attribute": "displayName",
                "start_tls": False,
                "tls_verify": True,
                "timeout_seconds": 5,
                "enabled": True,
                "allow_insecure": False,
            },
        ),
    ],
)
def test_oidc_and_ldap_mutations_require_recent_passkey(auth_client, db_session, path, payload):
    admin = _user(db_session, email=f"provider-guard-{payload['provider_id']}@example.com", role=UserRole.UI_SUPERADMIN.value)
    credentials = authenticate_ui_client(auth_client, db_session, admin, mfa_verified=False)

    response = auth_client.post(
        path,
        json=payload,
        headers=trusted_origin_headers(csrf_token=credentials.csrf_token),
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Recent WebAuthn verification required"
