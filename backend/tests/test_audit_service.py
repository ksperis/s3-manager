# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import AuditLog, S3Account, User, UserRole
from app.services.audit_service import AuditService


def _create_user(db_session) -> User:
    user = User(
        email="audit-user@example.com",
        full_name="Audit User",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_record_action_keeps_persisted_account_fk(db_session) -> None:
    user = _create_user(db_session)
    account = S3Account(name="persisted-account")
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    service = AuditService(db_session)
    service.record_action(
        user=user,
        scope="browser",
        action="delete_objects",
        entity_type="bucket",
        entity_id="bucket-a",
        account=account,
    )

    log = db_session.query(AuditLog).one()
    assert log.user_id == user.id
    assert log.account_id == account.id
    assert log.account_name == "persisted-account"


def test_record_action_omits_fk_for_synthetic_account_context(db_session) -> None:
    user = _create_user(db_session)
    synthetic_account = S3Account(name="synthetic-connection-context")
    synthetic_account.id = -1_000_001

    service = AuditService(db_session)
    service.record_action(
        user=user,
        scope="browser",
        action="delete_objects",
        entity_type="bucket",
        entity_id="bucket-b",
        account=synthetic_account,
    )

    log = db_session.query(AuditLog).one()
    assert log.user_id == user.id
    assert log.account_id is None
    assert log.account_name == "synthetic-connection-context"
