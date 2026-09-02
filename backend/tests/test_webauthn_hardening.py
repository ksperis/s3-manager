# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from webauthn.helpers import bytes_to_base64url

from app.core.security import get_password_hash
from app.db import AppSetting, AuditLog, AuthChallenge, AuthSession, RecoveryCode, User, UserRole, WebAuthnCredential
from app.models.app_settings import AppSettings
from app.scripts import reset_last_superadmin_mfa as reset_last_superadmin_mfa_script
from app.scripts.create_first_admin import FirstAdminError, create_first_admin
from app.scripts.reset_last_superadmin_mfa import OperatorRecoveryError, reset_last_superadmin_mfa
from app.core.config import get_settings
from app.services.auth_session_service import AuthSessionService
from app.services.app_settings_service import load_app_settings_for_db
from app.services.webauthn_service import LastRequiredPasskeyError, WebAuthnSecurityError, WebAuthnService


def _user(db_session, *, email: str, role: str = UserRole.UI_USER.value) -> User:
    row = User(
        email=email,
        full_name="Passkey User",
        hashed_password=get_password_hash("correct horse battery staple"),
        is_active=True,
        role=role,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _set_passkey_policy(db_session, *, admins: bool = True, users: bool = False) -> None:
    load_app_settings_for_db(db_session)
    row = db_session.query(AppSetting).filter(AppSetting.key == "default").one()
    settings = AppSettings.model_validate_json(row.payload_json)
    settings.general.require_passkey_for_admins = admins
    settings.general.require_passkey_for_users = users
    row.payload_json = settings.model_dump_json(indent=2)
    db_session.add(row)
    db_session.commit()


def _credential(user: User, credential_id: str) -> WebAuthnCredential:
    return WebAuthnCredential(
        id=credential_id,
        user_id=user.id,
        credential_id=f"{credential_id}-raw",
        public_key="public-key",
        sign_count=0,
        transports_json="[]",
        name="Passkey",
    )


def test_last_passkey_can_be_revoked_only_when_role_policy_allows_it(db_session):
    standard = _user(db_session, email="optional-passkey@example.com")
    optional = _credential(standard, "optional-passkey")
    db_session.add(optional)
    db_session.commit()
    WebAuthnService(db_session).revoke_credential(standard, optional.id)
    assert optional.revoked_at is not None

    required_user = _user(db_session, email="required-passkey@example.com")
    required = _credential(required_user, "required-passkey")
    db_session.add(required)
    db_session.commit()
    _set_passkey_policy(db_session, users=True)
    with pytest.raises(LastRequiredPasskeyError, match="must keep"):
        WebAuthnService(db_session).revoke_credential(required_user, required.id)

    admin = _user(db_session, email="admin-required-passkey@example.com", role=UserRole.UI_ADMIN.value)
    admin_credential = _credential(admin, "admin-required-passkey")
    db_session.add(admin_credential)
    db_session.commit()
    with pytest.raises(LastRequiredPasskeyError, match="must keep"):
        WebAuthnService(db_session).revoke_credential(admin, admin_credential.id)


def test_registration_options_require_user_verification_and_none_attestation(db_session):
    user = _user(db_session, email="registration-options@example.com")
    options = WebAuthnService(db_session).begin_registration(user, binding_sid="session-1")

    assert options["rp"]["id"]
    assert options["timeout"] == 300_000
    assert options["attestation"] == "none"
    assert options["authenticatorSelection"]["userVerification"] == "required"
    challenge = db_session.query(AuthChallenge).one()
    assert challenge.binding_sid == "session-1"
    assert challenge.expires_at > challenge.created_at


def test_registration_challenge_is_single_use_and_bound_to_the_ui_session(db_session):
    user = _user(db_session, email="registration-binding@example.com")
    service = WebAuthnService(db_session)
    service.begin_registration(user, binding_sid="session-a")

    with pytest.raises(WebAuthnSecurityError, match="unavailable"):
        service._consume_challenge(user.id, "webauthn_register", binding_sid="session-b")
    with pytest.raises(WebAuthnSecurityError, match="unavailable"):
        service._consume_challenge(user.id, "webauthn_register", binding_sid=None)

    challenge = service._consume_challenge(user.id, "webauthn_register", binding_sid="session-a")
    assert len(challenge) == 32
    with pytest.raises(WebAuthnSecurityError, match="unavailable"):
        service._consume_challenge(user.id, "webauthn_register", binding_sid="session-a")


def test_registration_verification_uses_exact_origin_rp_and_user_verification(db_session, monkeypatch):
    user = _user(db_session, email="registration-origin@example.com")
    service = WebAuthnService(db_session)
    service.begin_registration(user, binding_sid="session-origin")
    captured: dict = {}

    def verify(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            credential_id=b"new-credential",
            credential_public_key=b"new-public-key",
            sign_count=0,
        )

    monkeypatch.setattr("app.services.webauthn_service.verify_registration_response", verify)
    row = service.finish_registration(
        user,
        credential={"response": {"transports": ["internal"]}},
        name="Platform passkey",
        binding_sid="session-origin",
    )

    assert row.name == "Platform passkey"
    assert captured["expected_rp_id"] == get_settings().webauthn_rp_id
    assert captured["expected_origin"] == get_settings().webauthn_origin
    assert captured["require_user_verification"] is True


def test_authentication_updates_counter_and_rejects_counter_replay(db_session, monkeypatch):
    user = _user(db_session, email="counter@example.com")
    credential_id = bytes_to_base64url(b"credential-id")
    row = WebAuthnCredential(
        id="credential-row",
        user_id=user.id,
        credential_id=credential_id,
        public_key=bytes_to_base64url(b"public-key"),
        sign_count=1,
        transports_json="[]",
        name="Security key",
    )
    db_session.add(row)
    db_session.commit()
    service = WebAuthnService(db_session)
    service.begin_authentication(user, binding_sid="preauth-counter")
    with pytest.raises(WebAuthnSecurityError, match="challenge"):
        service._consume_challenge(
            user.id,
            "webauthn_authenticate",
            binding_sid="different-preauth",
        )
    captured: dict = {}

    def verify(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(new_sign_count=2)

    verifier = monkeypatch.setattr(
        "app.services.webauthn_service.verify_authentication_response",
        verify,
    )
    del verifier
    result = service.finish_authentication(
        user,
        credential={"id": credential_id},
        binding_sid="preauth-counter",
    )
    assert result.sign_count == 2
    assert result.last_used_at is not None
    assert captured["expected_rp_id"] == get_settings().webauthn_rp_id
    assert captured["expected_origin"] == get_settings().webauthn_origin
    assert captured["require_user_verification"] is True

    service.begin_authentication(user, binding_sid="preauth-replay")
    with pytest.raises(WebAuthnSecurityError, match="counter replay"):
        service.finish_authentication(
            user,
            credential={"id": credential_id},
            binding_sid="preauth-replay",
        )


def test_recovery_codes_are_returned_once_hashed_at_rest_and_atomically_consumed(db_session):
    user = _user(db_session, email="recovery@example.com")
    service = WebAuthnService(db_session)
    codes = service.issue_recovery_codes(user)

    assert len(codes) == 10
    assert len(set(codes)) == 10
    persisted = db_session.query(RecoveryCode).filter(RecoveryCode.user_id == user.id).all()
    assert len(persisted) == 10
    serialized = json.dumps([row.code_hash for row in persisted])
    assert all(code not in serialized for code in codes)
    assert service.consume_recovery_code(user, codes[0]) is True
    assert service.consume_recovery_code(user, codes[0]) is False


def test_recovery_code_login_does_not_count_as_recent_webauthn(db_session):
    user = _user(db_session, email="recovery-recency@example.com")
    sessions = AuthSessionService(db_session)
    recovery_session = sessions.create_for_user(
        user,
        auth_type="recovery_code",
        ip_address="127.0.0.1",
        user_agent="pytest",
        mfa_verified=True,
    ).session
    passkey_session = sessions.create_for_user(
        user,
        auth_type="webauthn",
        ip_address="127.0.0.1",
        user_agent="pytest",
        mfa_verified=True,
    ).session

    service = WebAuthnService(db_session)
    assert service.is_recent(recovery_session) is False
    assert service.is_recent(passkey_session) is True


def test_operator_reset_is_restricted_to_exact_sole_superadmin_and_revokes_every_session(db_session):
    user = _user(db_session, email="sole-admin@example.com", role=UserRole.UI_SUPERADMIN.value)
    credential = WebAuthnCredential(
        id="operator-credential",
        user_id=user.id,
        credential_id=bytes_to_base64url(b"operator-credential"),
        public_key=bytes_to_base64url(b"public-key"),
        sign_count=0,
        transports_json="[]",
        name="Operator key",
    )
    db_session.add(credential)
    db_session.commit()
    WebAuthnService(db_session).issue_recovery_codes(user)
    session = AuthSessionService(db_session).create_for_user(
        user,
        auth_type="webauthn",
        ip_address="127.0.0.1",
        user_agent="pytest",
        mfa_verified=True,
    ).session

    with pytest.raises(OperatorRecoveryError, match="exactly match"):
        reset_last_superadmin_mfa(db_session, email=user.email, confirmation="yes")

    reset = reset_last_superadmin_mfa(
        db_session,
        email=user.email,
        confirmation=f"RESET MFA {user.email}",
    )
    db_session.refresh(session)
    assert reset.auth_version == 2
    assert session.revoked_at is not None
    assert db_session.query(WebAuthnCredential).count() == 0
    assert db_session.query(RecoveryCode).count() == 0
    audit = db_session.query(AuditLog).filter(AuditLog.action == "operator_reset_last_superadmin_mfa").one()
    assert user.email not in (audit.metadata_json or "")


def test_operator_reset_cli_prints_after_session_close(monkeypatch, db_session, capsys):
    _user(db_session, email="cli-admin@example.com", role=UserRole.UI_SUPERADMIN.value)
    monkeypatch.setattr(reset_last_superadmin_mfa_script, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(
        "builtins.input",
        lambda _prompt: "RESET MFA cli-admin@example.com",
    )
    monkeypatch.setattr(
        "sys.argv",
        [
            "reset_last_superadmin_mfa",
            "--email",
            "cli-admin@example.com",
        ],
    )

    reset_last_superadmin_mfa_script.main()

    assert capsys.readouterr().out == (
        "This action removes passkeys and recovery codes and revokes every session.\n"
        "MFA reset completed for cli-admin@example.com. The current passkey policy applies at next login.\n"
    )


def test_first_admin_command_requires_confirmation_and_minimum_password(db_session):
    with pytest.raises(FirstAdminError, match="Confirmation"):
        create_first_admin(
            db_session,
            email="first@example.com",
            full_name="First Admin",
            password="correct horse battery staple",
            confirmation="CREATE",
        )
    with pytest.raises(FirstAdminError, match="12"):
        create_first_admin(
            db_session,
            email="first@example.com",
            full_name="First Admin",
            password="too-short",
            confirmation="CREATE FIRST ADMIN first@example.com",
        )

    user = create_first_admin(
        db_session,
        email="first@example.com",
        full_name="First Admin",
        password="correct horse battery staple",
        confirmation="CREATE FIRST ADMIN first@example.com",
    )
    assert user.role == UserRole.UI_SUPERADMIN.value
    assert user.is_active is True
