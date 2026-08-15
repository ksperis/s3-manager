# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import json
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from pwdlib import PasswordHash
from pwdlib.hashers.bcrypt import BcryptHasher
from sqlalchemy import text
from starlette.requests import Request

from app.core.config import Settings, get_settings
from app.core.security import (
    create_ui_access_token,
    decode_typed_token,
    get_password_hash,
    verify_password,
)
from app.db import AuthSession, ExternalIdentity, RefreshToken, S3Session, User, UserRole, WebAuthnCredential
from app.db import AuditLog
from app.main import app
from app.models.user import UserUpdate
from app.routers import dependencies
from app.routers import auth as auth_router
from app.services.api_token_service import ApiTokenService
from app.services.auth_session_service import AuthSessionError, AuthSessionService, RefreshReplayError
from app.services.external_identity_user_service import ExternalIdentityLinkRequiredError
from app.services.oidc_service import OIDCStateError
from app.services.users_service import UsersService
from app.utils.request_security import client_ip
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


def _user(db_session, *, email: str = "security@example.com", role: str = UserRole.UI_USER.value) -> User:
    row = User(
        email=email,
        full_name="Security Test",
        hashed_password=get_password_hash("correct horse battery staple"),
        is_active=True,
        role=role,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def test_ui_jwt_is_strictly_typed_and_rejects_wrong_type_audience_and_legacy_token(db_session):
    settings = get_settings()
    user = _user(db_session)
    token = create_ui_access_token(
        user_id=user.id,
        session_id="session-1",
        auth_version=user.auth_version,
        role=user.role,
    )
    claims = decode_typed_token(token, expected_type="ui_access")
    assert claims is not None
    assert claims["iss"] == settings.jwt_issuer
    assert claims["aud"] == settings.ui_jwt_audience
    assert claims["sub"] == f"user:{user.id}"
    assert decode_typed_token(token, expected_type="api_access") is None

    key = settings.effective_ui_jwt_keys()[0]
    kid = hashlib.sha256(key.encode()).hexdigest()[:16]
    wrong_audience = jwt.encode(
        {
            "typ": "ui_access",
            "iss": settings.jwt_issuer,
            "aud": "wrong-audience",
            "sub": f"user:{user.id}",
            "sid": "session-1",
            "auth_version": user.auth_version,
            "iat": utcnow(),
            "nbf": utcnow(),
            "exp": utcnow() + timedelta(minutes=5),
            "jti": "wrong-audience-jti",
        },
        key,
        algorithm=settings.jwt_algorithm,
        headers={"kid": kid, "typ": "ui_access"},
    )
    assert decode_typed_token(wrong_audience, expected_type="ui_access") is None
    legacy = jwt.encode(
        {"sub": "legacy", "iat": utcnow(), "nbf": utcnow(), "exp": utcnow() + timedelta(minutes=5)},
        key,
        algorithm=settings.jwt_algorithm,
        headers={"kid": kid},
    )
    assert decode_typed_token(legacy, expected_type="ui_access") is None


def test_login_returns_only_cookie_session_and_auth_endpoints_are_no_store(auth_client, db_session):
    settings = get_settings()
    user = _user(db_session, email="cookie-login@example.com")
    response = auth_client.post(
        "/api/auth/login",
        data={"username": user.email, "password": "correct horse battery staple"},
        headers={**trusted_origin_headers(), "Content-Type": "application/x-www-form-urlencoded"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "authenticated"
    assert "access_token" not in response.json()
    cookies = response.headers.get_list("set-cookie")
    access_cookie = next(value for value in cookies if value.startswith(f"{settings.access_token_cookie_name}="))
    refresh_cookie = next(value for value in cookies if value.startswith(f"{settings.refresh_token_cookie_name}="))
    assert "HttpOnly" in access_cookie and "SameSite=lax" in access_cookie
    assert "Max-Age=300" in access_cookie and "Domain=" not in access_cookie
    assert "HttpOnly" in refresh_cookie and "SameSite=lax" in refresh_cookie
    assert response.headers["cache-control"] == "no-store"

    session_response = auth_client.get("/api/auth/session")
    assert session_response.status_code == 200
    assert session_response.json()["user"]["email"] == user.email
    assert "access_token" not in session_response.text


def test_origin_csrf_and_authentication_class_confusion_are_rejected(auth_client, db_session):
    user = _user(db_session, email="csrf@example.com")
    missing_origin = auth_client.post(
        "/api/auth/login",
        data={"username": user.email, "password": "correct horse battery staple"},
    )
    assert missing_origin.status_code == 403

    credentials = authenticate_ui_client(auth_client, db_session, user)
    missing_csrf = auth_client.post("/api/auth/logout-all", headers=trusted_origin_headers())
    assert missing_csrf.status_code == 403
    wrong_origin = auth_client.post(
        "/api/auth/logout-all",
        headers={"Origin": "https://attacker.example", "X-CSRF-Token": credentials.csrf_token},
    )
    assert wrong_origin.status_code == 403
    mixed = auth_client.get(
        "/api/users/me",
        headers={"Authorization": "Bearer definitely-not-an-api-token"},
    )
    assert mixed.status_code == 400
    public_mixed = auth_client.get(
        "/api/auth/oidc/providers",
        headers={"Authorization": "Bearer definitely-not-an-api-token"},
    )
    assert public_mixed.status_code == 400


def test_logout_revokes_refresh_family_when_access_cookie_is_unavailable(auth_client, db_session):
    user = _user(db_session, email="logout-refresh@example.com")
    credentials = authenticate_ui_client(auth_client, db_session, user)
    settings = get_settings()
    auth_client.cookies.delete(settings.access_token_cookie_name, path="/api")

    response = auth_client.post(
        "/api/auth/logout",
        headers=trusted_origin_headers(csrf_token=credentials.csrf_token),
    )

    assert response.status_code == 204
    with pytest.raises(AuthSessionError):
        AuthSessionService(db_session).rotate(credentials.refresh_token)


def test_enrolled_passkey_requires_mfa_for_a_non_admin_login(auth_client, db_session):
    user = _user(db_session, email="passkey-user@example.com")
    db_session.add(
        WebAuthnCredential(
            id="passkey-user-credential",
            user_id=user.id,
            credential_id="passkey-user-credential-id",
            public_key="public-key",
            sign_count=0,
            transports_json="[]",
            name="Passkey",
        )
    )
    db_session.commit()

    response = auth_client.post(
        "/api/auth/login",
        data={"username": user.email, "password": "correct horse battery staple"},
        headers={**trusted_origin_headers(), "Content-Type": "application/x-www-form-urlencoded"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "mfa_required"
    assert "access_token" not in response.text


def test_external_identity_inventory_and_revocation_require_a_recent_passkey(auth_client, db_session):
    user = _user(db_session, email="external-identity@example.com")
    identity = ExternalIdentity(
        id="external-identity-1",
        user_id=user.id,
        provider_type="oidc",
        provider_id="company",
        subject="subject-1",
        email=user.email,
        email_verified=True,
    )
    db_session.add(identity)
    db_session.commit()
    credentials = authenticate_ui_client(auth_client, db_session, user, mfa_verified=True)

    inventory = auth_client.get("/api/auth/security/external-identities")
    assert inventory.status_code == 200
    assert inventory.json()[0]["provider_id"] == "company"
    assert "subject" not in inventory.json()[0]

    response = auth_client.delete(
        f"/api/auth/security/external-identities/{identity.id}",
        headers=trusted_origin_headers(csrf_token=credentials.csrf_token),
    )
    assert response.status_code == 204
    db_session.refresh(identity)
    db_session.refresh(credentials.session)
    assert identity.revoked_at is not None
    assert credentials.session.revoked_at is not None


def test_recovery_code_regeneration_revokes_sessions_and_api_tokens(auth_client, db_session):
    admin = _user(
        db_session,
        email="recovery-regeneration@example.com",
        role=UserRole.UI_ADMIN.value,
    )
    credentials = authenticate_ui_client(auth_client, db_session, admin)
    _, api_token = ApiTokenService(db_session).create_for_user(
        admin,
        name="before-recovery-regeneration",
        scopes=["profile:read"],
    )
    previous_auth_version = admin.auth_version

    response = auth_client.post(
        "/api/auth/security/recovery-codes",
        headers=trusted_origin_headers(csrf_token=credentials.csrf_token),
    )

    assert response.status_code == 200
    assert len(response.json()["codes"]) == 10
    db_session.refresh(admin)
    db_session.refresh(credentials.session)
    db_session.refresh(api_token)
    assert admin.auth_version == previous_auth_version + 1
    assert credentials.session.revoked_at is not None
    assert api_token.revoked_at is not None
    cleared_cookies = response.headers.get_list("set-cookie")
    assert any(
        value.startswith(f"{get_settings().access_token_cookie_name}=") and "Max-Age=0" in value
        for value in cleared_cookies
    )
    assert any(
        value.startswith(f"{get_settings().refresh_token_cookie_name}=") and "Max-Age=0" in value
        for value in cleared_cookies
    )


def test_superadmin_can_inventory_and_revoke_another_users_session(auth_client, db_session):
    superadmin = _user(
        db_session,
        email="session-superadmin@example.com",
        role=UserRole.UI_SUPERADMIN.value,
    )
    other = _user(db_session, email="session-owner@example.com")
    current = authenticate_ui_client(auth_client, db_session, superadmin, mfa_verified=True)
    other_credentials = AuthSessionService(db_session).create_for_user(
        other,
        auth_type="password",
        ip_address="192.0.2.50",
        user_agent="pytest-other",
        mfa_verified=False,
    )

    inventory = auth_client.get("/api/auth/admin/sessions")
    assert inventory.status_code == 200
    by_id = {row["id"]: row for row in inventory.json()}
    assert by_id[current.session.id]["user_id"] == superadmin.id
    assert by_id[other_credentials.session.id]["user_id"] == other.id

    response = auth_client.delete(
        f"/api/auth/admin/sessions/{other_credentials.session.id}",
        headers=trusted_origin_headers(csrf_token=current.csrf_token),
    )
    assert response.status_code == 204
    db_session.refresh(other_credentials.session)
    assert other_credentials.session.revoked_at is not None


def test_refresh_replay_revokes_the_entire_family(db_session):
    db_session.execute(text("PRAGMA foreign_keys = ON"))
    try:
        user = _user(db_session, email="refresh-replay@example.com")
        service = AuthSessionService(db_session)
        original = service.create_for_user(
            user,
            auth_type="password",
            ip_address="127.0.0.1",
            user_agent="pytest",
            mfa_verified=False,
        )
        replacement = service.rotate(original.refresh_token)
        assert replacement.refresh_token != original.refresh_token

        with pytest.raises(RefreshReplayError):
            service.rotate(original.refresh_token)

        rows = db_session.query(RefreshToken).filter(RefreshToken.auth_session_id == original.session.id).all()
        assert len(rows) == 2
        assert all(row.revoked_at is not None for row in rows)
        db_session.refresh(original.session)
        assert original.session.revoked_at is not None
        with pytest.raises(AuthSessionError):
            service.rotate(replacement.refresh_token)
    finally:
        db_session.rollback()
        db_session.execute(text("PRAGMA foreign_keys = OFF"))


def test_expired_s3_auth_session_erases_persisted_credentials(db_session):
    now = utcnow()
    s3_session = S3Session(
        id="s3-session-expired",
        access_key_enc="ACCESS",
        secret_key_enc="SECRET",
        access_key_hash="hash",
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
    credentials = AuthSessionService(db_session).create_for_s3_session(
        s3_session,
        ip_address="127.0.0.1",
        user_agent="pytest",
    )
    credentials.session.idle_expires_at = now - timedelta(seconds=1)
    db_session.add(credentials.session)
    db_session.commit()

    with pytest.raises(AuthSessionError):
        AuthSessionService(db_session).validate_access(credentials.session.id, expected_type="s3_access")

    db_session.refresh(s3_session)
    assert s3_session.revoked_at is not None
    assert s3_session.access_key_enc is None
    assert s3_session.secret_key_enc is None


def test_expired_s3_credentials_are_erased_by_startup_cleanup(db_session):
    now = utcnow()
    s3_session = S3Session(
        id="s3-session-startup-cleanup",
        access_key_enc="ACCESS",
        secret_key_enc="SECRET",
        access_key_hash="cleanup-hash",
        actor_type="s3_account",
        role=UserRole.UI_USER.value,
        capabilities=json.dumps({"access_browser": True}),
        created_at=now - timedelta(hours=9),
        last_used_at=now - timedelta(hours=9),
        idle_expires_at=now - timedelta(minutes=1),
        absolute_expires_at=now - timedelta(minutes=1),
    )
    db_session.add(s3_session)
    db_session.commit()

    assert AuthSessionService(db_session).cleanup_expired() == 1
    db_session.refresh(s3_session)
    assert s3_session.revoked_at is not None
    assert s3_session.access_key_enc is None
    assert s3_session.secret_key_enc is None


def test_argon2_accepts_long_passwords_and_legacy_bcrypt_is_rehashed(db_session):
    long_password = "long-password-" + ("é" * 100)
    modern_hash = get_password_hash(long_password)
    assert modern_hash.startswith("$argon2id$")
    assert verify_password(long_password, modern_hash)

    legacy_password = "legacy password with sufficient length"
    legacy_hash = PasswordHash((BcryptHasher(),)).hash(legacy_password)
    user = User(
        email="legacy-bcrypt@example.com",
        full_name="Legacy",
        hashed_password=legacy_hash,
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(user)
    db_session.commit()
    authenticated = UsersService(db_session).authenticate(user.email, legacy_password)
    assert authenticated is not None
    assert authenticated.hashed_password.startswith("$argon2id$")
    assert authenticated.auth_version == 2


def test_promotion_to_admin_revokes_existing_session_and_forces_passkey_enrollment(auth_client, db_session):
    user = _user(db_session, email="promoted-admin@example.com")
    credentials = authenticate_ui_client(auth_client, db_session, user, mfa_verified=False)

    promoted = UsersService(db_session).update_user(user.id, UserUpdate(role=UserRole.UI_ADMIN.value))

    db_session.refresh(credentials.session)
    assert promoted.auth_version == 2
    assert credentials.session.revoked_at is not None
    clear_ui_client(auth_client)
    response = auth_client.post(
        "/api/auth/login",
        data={"username": user.email, "password": "correct horse battery staple"},
        headers={**trusted_origin_headers(), "Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "mfa_enrollment_required"
    assert "access_token" not in response.json()


def _request(*, direct: str, forwarded: str | None = None) -> Request:
    headers = []
    if forwarded is not None:
        headers.append((b"x-forwarded-for", forwarded.encode()))
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers, "client": (direct, 1234)})


def test_forwarded_for_is_ignored_unless_peer_is_trusted_and_trusted_hops_are_removed():
    settings = Settings(_env_file=None, trusted_proxy_cidrs=["10.0.0.0/8"])
    assert client_ip(_request(direct="192.0.2.10", forwarded="198.51.100.1"), settings) == "192.0.2.10"
    assert (
        client_ip(
            _request(direct="10.0.0.2", forwarded="203.0.113.250, 198.51.100.8, 10.0.0.1"),
            settings,
        )
        == "198.51.100.8"
    )


def test_oidc_callback_failure_is_generic_audited_and_never_persists_code_or_state(
    auth_client,
    db_session,
    monkeypatch,
):
    class FailingOidcService:
        db = db_session

        def complete_login(self, provider_id, code, state):
            raise OIDCStateError(f"replayed state={state} code={code}")

    monkeypatch.setattr(auth_router, "get_oidc_service", lambda db: FailingOidcService())
    response = auth_client.post(
        "/api/auth/oidc/company/callback",
        json={"code": "secret-code", "state": "secret-state"},
        headers=trusted_origin_headers(),
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid OIDC response"
    audit = db_session.query(AuditLog).filter(AuditLog.action == "login_oidc_failure").one()
    persisted = f"{audit.message or ''} {audit.metadata_json or ''}"
    assert "secret-code" not in persisted
    assert "secret-state" not in persisted


def test_oidc_email_collision_creates_an_audited_manual_link_response(auth_client, db_session, monkeypatch):
    class LinkingOidcService:
        db = db_session

        def complete_login(self, provider_id, code, state):
            raise ExternalIdentityLinkRequiredError("link-request-1")

    monkeypatch.setattr(auth_router, "get_oidc_service", lambda db: LinkingOidcService())
    response = auth_client.post(
        "/api/auth/oidc/company/callback",
        json={"code": "code", "state": "state"},
        headers=trusted_origin_headers(),
    )
    assert response.status_code == 200
    assert response.json() == {
        "status": "link_approval_required",
        "user": None,
        "session": None,
        "redirect_path": None,
        "link_request_id": "link-request-1",
        "recovery_codes": None,
    }
    audit = db_session.query(AuditLog).filter(AuditLog.action == "external_identity_link_requested").one()
    assert audit.entity_id == "link-request-1"
