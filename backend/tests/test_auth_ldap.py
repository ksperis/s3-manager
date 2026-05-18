# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json

from app.db import AuditLog, RefreshSession, User, UserRole
from app.routers import auth as auth_router
from app.services.ldap_service import LDAPAuthenticationError, LDAPConfigurationError


def test_list_ldap_providers(client, monkeypatch):
    class FakeLDAPService:
        def list_providers(self):
            return [{"id": "corp", "display_name": "Corporate LDAP"}]

    monkeypatch.setattr(auth_router, "get_ldap_auth_service", lambda db: FakeLDAPService())

    response = client.get("/api/auth/ldap/providers")

    assert response.status_code == 200
    assert response.json() == [{"id": "corp", "display_name": "Corporate LDAP"}]


def test_ldap_login_creates_refresh_session_and_returns_ui_none_user(client, db_session, monkeypatch):
    class FakeLDAPService:
        def authenticate(self, provider_id, username, password):
            user = User(
                email="jane@example.test",
                full_name="Jane Doe",
                display_name="Jane Doe",
                hashed_password=None,
                is_active=True,
                role=UserRole.UI_NONE.value,
                auth_provider=f"ldap:{provider_id}",
                auth_provider_subject="uuid-123",
            )
            db_session.add(user)
            db_session.commit()
            db_session.refresh(user)
            return user, True

    monkeypatch.setattr(auth_router, "get_ldap_auth_service", lambda db: FakeLDAPService())

    response = client.post(
        "/api/auth/ldap/corp/login",
        json={"username": "jane", "password": "secret-password"},
        headers={"X-Forwarded-For": "198.51.100.30", "User-Agent": "pytest-ldap"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["access_token"]
    assert payload["user"]["email"] == "jane@example.test"
    assert payload["user"]["role"] == UserRole.UI_NONE.value
    assert payload["user"]["auth_provider"] == "ldap:corp"
    session = db_session.query(RefreshSession).first()
    assert session is not None
    assert session.auth_type == "ldap"
    audit = db_session.query(AuditLog).filter(AuditLog.action == "login_ldap_success").first()
    assert audit is not None
    assert audit.ip_address == "198.51.100.30"
    assert audit.user_agent == "pytest-ldap"


def test_ldap_login_failure_is_audited(client, db_session, monkeypatch):
    class FakeLDAPService:
        def authenticate(self, provider_id, username, password):
            raise LDAPAuthenticationError("Invalid credentials")

    monkeypatch.setattr(auth_router, "get_ldap_auth_service", lambda db: FakeLDAPService())

    response = client.post(
        "/api/auth/ldap/corp/login",
        json={"username": "jane", "password": "bad-password"},
        headers={"X-Forwarded-For": "198.51.100.31", "User-Agent": "pytest-ldap"},
    )

    assert response.status_code == 401
    audit = db_session.query(AuditLog).filter(AuditLog.action == "login_failure").first()
    assert audit is not None
    assert audit.user_email == "ldap:corp:jane"
    assert audit.message == "Invalid LDAP credentials"


def test_ldap_configuration_error_hides_detail_from_client_but_audits_it(client, db_session, monkeypatch):
    class FakeLDAPService:
        def authenticate(self, provider_id, username, password):
            raise LDAPConfigurationError("LDAP user entry contains an invalid email address")

    monkeypatch.setattr(auth_router, "get_ldap_auth_service", lambda db: FakeLDAPService())

    response = client.post(
        "/api/auth/ldap/corp/login",
        json={"username": "jane", "password": "secret-password"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "LDAP provider is unavailable. Please contact an administrator."
    audit = db_session.query(AuditLog).filter(AuditLog.action == "login_ldap_configuration_error").first()
    assert audit is not None
    assert audit.message == "LDAP provider configuration error"
    metadata = json.loads(audit.metadata_json or "{}")
    assert metadata["error"] == "LDAP user entry contains an invalid email address"
