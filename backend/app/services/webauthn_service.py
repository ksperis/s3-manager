# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import secrets
import uuid
from datetime import timedelta
from typing import Any, Optional

from sqlalchemy import update
from sqlalchemy.orm import Session
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.exceptions import InvalidAuthenticationResponse, InvalidRegistrationResponse
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.core.config import Settings, get_settings
from app.core.security import hash_refresh_token
from app.db import AuthChallenge, AuthSession, RecoveryCode, User, WebAuthnCredential
from app.utils.time import utcnow


class WebAuthnSecurityError(ValueError):
    pass


class WebAuthnService:
    def __init__(self, db: Session, settings: Optional[Settings] = None) -> None:
        self.db = db
        self.settings = settings or get_settings()

    def has_credentials(self, user_id: int) -> bool:
        return self.db.query(WebAuthnCredential.id).filter(
            WebAuthnCredential.user_id == user_id,
            WebAuthnCredential.revoked_at.is_(None),
        ).first() is not None

    def begin_registration(self, user: User, *, binding_sid: Optional[str] = None) -> dict[str, Any]:
        challenge = secrets.token_bytes(32)
        existing = self.db.query(WebAuthnCredential).filter(
            WebAuthnCredential.user_id == user.id,
            WebAuthnCredential.revoked_at.is_(None),
        ).all()
        options = generate_registration_options(
            rp_id=self.settings.webauthn_rp_id,
            rp_name=self.settings.webauthn_rp_name,
            user_id=str(user.id).encode(),
            user_name=user.email,
            user_display_name=user.display_name or user.full_name or user.email,
            challenge=challenge,
            timeout=300_000,
            attestation=AttestationConveyancePreference.NONE,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.PREFERRED,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
            exclude_credentials=[
                PublicKeyCredentialDescriptor(id=base64url_to_bytes(row.credential_id))
                for row in existing
            ],
        )
        self._store_challenge(user.id, "webauthn_register", challenge, binding_sid=binding_sid)
        return json.loads(options_to_json(options))

    def finish_registration(
        self,
        user: User,
        *,
        credential: dict[str, Any],
        name: str,
        binding_sid: Optional[str] = None,
    ) -> WebAuthnCredential:
        challenge = self._consume_challenge(
            user.id,
            "webauthn_register",
            binding_sid=binding_sid,
        )
        try:
            verified = verify_registration_response(
                credential=credential,
                expected_challenge=challenge,
                expected_rp_id=self.settings.webauthn_rp_id,
                expected_origin=self.settings.webauthn_origin,
                require_user_verification=True,
            )
        except (InvalidRegistrationResponse, ValueError) as exc:
            raise WebAuthnSecurityError("Invalid WebAuthn registration response") from exc
        row = WebAuthnCredential(
            id=str(uuid.uuid4()),
            user_id=user.id,
            credential_id=bytes_to_base64url(verified.credential_id),
            public_key=bytes_to_base64url(verified.credential_public_key),
            sign_count=verified.sign_count,
            transports_json=json.dumps(credential.get("response", {}).get("transports") or []),
            name=(name or "Passkey").strip()[:128] or "Passkey",
            created_at=utcnow(),
        )
        user.auth_version += 1
        self.db.add_all([row, user])
        self.db.commit()
        self.db.refresh(row)
        return row

    def begin_authentication(self, user: User, *, binding_sid: Optional[str] = None) -> dict[str, Any]:
        challenge = secrets.token_bytes(32)
        credentials = self.db.query(WebAuthnCredential).filter(
            WebAuthnCredential.user_id == user.id,
            WebAuthnCredential.revoked_at.is_(None),
        ).all()
        if not credentials:
            raise WebAuthnSecurityError("No active passkey is enrolled")
        options = generate_authentication_options(
            rp_id=self.settings.webauthn_rp_id,
            challenge=challenge,
            timeout=300_000,
            allow_credentials=[
                PublicKeyCredentialDescriptor(id=base64url_to_bytes(row.credential_id))
                for row in credentials
            ],
            user_verification=UserVerificationRequirement.REQUIRED,
        )
        self._store_challenge(
            user.id,
            "webauthn_authenticate",
            challenge,
            binding_sid=binding_sid,
        )
        return json.loads(options_to_json(options))

    def finish_authentication(
        self,
        user: User,
        *,
        credential: dict[str, Any],
        binding_sid: Optional[str] = None,
    ) -> WebAuthnCredential:
        challenge = self._consume_challenge(
            user.id,
            "webauthn_authenticate",
            binding_sid=binding_sid,
        )
        credential_id = str(credential.get("id") or "")
        row = self.db.query(WebAuthnCredential).filter(
            WebAuthnCredential.user_id == user.id,
            WebAuthnCredential.credential_id == credential_id,
            WebAuthnCredential.revoked_at.is_(None),
        ).first()
        if not row:
            raise WebAuthnSecurityError("Passkey is not registered")
        try:
            verified = verify_authentication_response(
                credential=credential,
                expected_challenge=challenge,
                expected_rp_id=self.settings.webauthn_rp_id,
                expected_origin=self.settings.webauthn_origin,
                credential_public_key=base64url_to_bytes(row.public_key),
                credential_current_sign_count=row.sign_count,
                require_user_verification=True,
            )
        except (InvalidAuthenticationResponse, ValueError) as exc:
            raise WebAuthnSecurityError("Invalid WebAuthn authentication response") from exc
        if row.sign_count > 0 and verified.new_sign_count <= row.sign_count:
            raise WebAuthnSecurityError("WebAuthn signature counter replay detected")
        row.sign_count = verified.new_sign_count
        row.last_used_at = utcnow()
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def issue_recovery_codes(self, user: User) -> list[str]:
        self.db.query(RecoveryCode).filter(RecoveryCode.user_id == user.id).delete(synchronize_session=False)
        codes = [f"{secrets.token_hex(4)}-{secrets.token_hex(4)}" for _ in range(10)]
        now = utcnow()
        self.db.add_all(
            [
                RecoveryCode(
                    id=str(uuid.uuid4()),
                    user_id=user.id,
                    code_hash=self._recovery_hash(user.id, code),
                    created_at=now,
                )
                for code in codes
            ]
        )
        self.db.commit()
        return codes

    def consume_recovery_code(self, user: User, code: str) -> bool:
        now = utcnow()
        result = self.db.execute(
            update(RecoveryCode)
            .where(
                RecoveryCode.user_id == user.id,
                RecoveryCode.code_hash == self._recovery_hash(user.id, code),
                RecoveryCode.consumed_at.is_(None),
            )
            .values(consumed_at=now)
        )
        self.db.commit()
        return result.rowcount == 1

    def revoke_credential(self, user: User, credential_id: str) -> None:
        row = self.db.query(WebAuthnCredential).filter(
            WebAuthnCredential.id == credential_id,
            WebAuthnCredential.user_id == user.id,
            WebAuthnCredential.revoked_at.is_(None),
        ).first()
        if not row:
            raise WebAuthnSecurityError("Passkey not found")
        remaining = self.db.query(WebAuthnCredential.id).filter(
            WebAuthnCredential.user_id == user.id,
            WebAuthnCredential.revoked_at.is_(None),
            WebAuthnCredential.id != row.id,
        ).first()
        if user.role in {"ui_admin", "ui_superadmin"} and remaining is None:
            raise WebAuthnSecurityError("Administrators must keep at least one passkey")
        row.revoked_at = utcnow()
        user.auth_version += 1
        self.db.add_all([row, user])
        self.db.commit()

    def is_recent(self, auth_session: AuthSession) -> bool:
        return bool(
            auth_session.auth_type in {"webauthn", "password+webauthn"}
            and auth_session.mfa_verified_at
            and auth_session.mfa_verified_at >= utcnow() - timedelta(minutes=self.settings.mfa_recent_minutes)
        )

    def _store_challenge(
        self,
        user_id: int,
        purpose: str,
        challenge: bytes,
        *,
        binding_sid: Optional[str] = None,
    ) -> None:
        now = utcnow()
        self.db.query(AuthChallenge).filter(
            AuthChallenge.user_id == user_id,
            AuthChallenge.purpose == purpose,
            AuthChallenge.consumed_at.is_(None),
        ).update({AuthChallenge.consumed_at: now}, synchronize_session=False)
        encoded = bytes_to_base64url(challenge)
        self.db.add(
            AuthChallenge(
                id=str(uuid.uuid4()),
                user_id=user_id,
                binding_sid=binding_sid,
                purpose=purpose,
                challenge_hash=hash_refresh_token(encoded),
                payload_json=json.dumps({"challenge": encoded}),
                created_at=now,
                expires_at=now + timedelta(minutes=5),
            )
        )
        self.db.commit()

    def _consume_challenge(
        self,
        user_id: int,
        purpose: str,
        *,
        binding_sid: Optional[str] = None,
    ) -> bytes:
        now = utcnow()
        query = self.db.query(AuthChallenge).filter(
            AuthChallenge.user_id == user_id,
            AuthChallenge.purpose == purpose,
            AuthChallenge.consumed_at.is_(None),
            AuthChallenge.expires_at > now,
        )
        query = query.filter(AuthChallenge.binding_sid == binding_sid)
        row = query.order_by(AuthChallenge.created_at.desc()).first()
        if not row:
            raise WebAuthnSecurityError("WebAuthn challenge is unavailable")
        claimed = self.db.execute(
            update(AuthChallenge)
            .where(
                AuthChallenge.id == row.id,
                AuthChallenge.consumed_at.is_(None),
                AuthChallenge.expires_at > now,
            )
            .values(consumed_at=now)
        )
        if claimed.rowcount != 1:
            self.db.rollback()
            raise WebAuthnSecurityError("WebAuthn challenge has already been consumed")
        self.db.commit()
        encoded = json.loads(row.payload_json)["challenge"]
        if hash_refresh_token(encoded) != row.challenge_hash:
            raise WebAuthnSecurityError("WebAuthn challenge integrity check failed")
        return base64url_to_bytes(encoded)

    @staticmethod
    def _recovery_hash(user_id: int, code: str) -> str:
        return hash_refresh_token(f"{user_id}:{str(code or '').strip().lower()}")
