# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Emergency operator recovery for the final active UI superadministrator.

Run from ``backend`` with ``python -m app.scripts.reset_last_superadmin_mfa``.
The command deliberately accepts no password or recovery code and never logs a
credential. The next successful primary login must enroll a new passkey.
"""
from __future__ import annotations

import argparse

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.db import AuthChallenge, RecoveryCode, User, WebAuthnCredential
from app.db.enums import UserRole
from app.services.audit_service import AuditService
from app.services.auth_session_service import AuthSessionService


class OperatorRecoveryError(ValueError):
    pass


def reset_last_superadmin_mfa(db: Session, *, email: str, confirmation: str) -> User:
    normalized_email = email.strip().lower()
    expected = f"RESET MFA {normalized_email}"
    if confirmation != expected:
        raise OperatorRecoveryError(f"Confirmation must exactly match: {expected}")

    active_superadmins = db.query(User).filter(
        User.role == UserRole.UI_SUPERADMIN.value,
        User.is_active.is_(True),
    ).all()
    if len(active_superadmins) != 1:
        raise OperatorRecoveryError("Operator recovery is restricted to the sole active superadministrator")
    user = active_superadmins[0]
    if user.email.strip().lower() != normalized_email:
        raise OperatorRecoveryError("The supplied email does not match the sole active superadministrator")

    db.query(WebAuthnCredential).filter(WebAuthnCredential.user_id == user.id).delete(synchronize_session=False)
    db.query(RecoveryCode).filter(RecoveryCode.user_id == user.id).delete(synchronize_session=False)
    db.query(AuthChallenge).filter(AuthChallenge.user_id == user.id).delete(synchronize_session=False)
    user.auth_version += 1
    db.add(user)
    db.commit()

    AuthSessionService(db).revoke_all_for_user(
        user,
        "operator_mfa_reset",
        increment_version=False,
    )
    AuditService(db).record_action(
        user=None,
        user_email=user.email,
        user_role="operator",
        scope="security",
        action="operator_reset_last_superadmin_mfa",
        entity_type="user",
        entity_id=str(user.id),
        metadata={"all_sessions_revoked": True, "passkey_enrollment_required": True},
    )
    return user


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset MFA for the sole active UI superadministrator.")
    parser.add_argument("--email", required=True, help="Exact email of the final active superadministrator")
    args = parser.parse_args()
    normalized_email = args.email.strip().lower()
    print("This action removes passkeys and recovery codes and revokes every session.")
    confirmation = input(f"Type 'RESET MFA {normalized_email}' to continue: ")

    db = SessionLocal()
    try:
        user = reset_last_superadmin_mfa(db, email=normalized_email, confirmation=confirmation)
    finally:
        db.close()
    print(f"MFA reset completed for {user.email}. A new passkey is required at next login.")


if __name__ == "__main__":
    main()
