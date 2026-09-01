# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.db import AuthChallenge, RecoveryCode, User, WebAuthnCredential
from app.services.auth_session_service import AuthSessionService


@dataclass(frozen=True)
class MfaResetResult:
    passkeys_removed: int
    recovery_codes_removed: int
    challenges_removed: int


class MfaResetService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def reset(self, user: User, *, reason: str) -> MfaResetResult:
        passkeys_removed = self.db.query(WebAuthnCredential).filter(
            WebAuthnCredential.user_id == user.id,
        ).delete(synchronize_session=False)
        recovery_codes_removed = self.db.query(RecoveryCode).filter(
            RecoveryCode.user_id == user.id,
        ).delete(synchronize_session=False)
        challenges_removed = self.db.query(AuthChallenge).filter(
            AuthChallenge.user_id == user.id,
        ).delete(synchronize_session=False)
        user.auth_version += 1
        self.db.add(user)
        self.db.commit()
        AuthSessionService(self.db).revoke_all_for_user(
            user,
            reason,
            increment_version=False,
        )
        return MfaResetResult(
            passkeys_removed=passkeys_removed,
            recovery_codes_removed=recovery_codes_removed,
            challenges_removed=challenges_removed,
        )
