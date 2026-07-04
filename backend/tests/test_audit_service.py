# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json

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


def test_record_action_sanitizes_sensitive_metadata_before_persisting(db_session) -> None:
    user = _create_user(db_session)

    service = AuditService(db_session)
    service.record_action(
        user=user,
        scope="admin",
        action="connection.update",
        entity_type="s3_connection",
        entity_id="42",
        metadata={
            "endpoint_url": "https://s3.example.test/bucket",
            "access_key_id": "AKIA1234567890ABCDEF",
            "secret_access_key": "secret-value",
            "client_secret": "oauth-secret",
            "client_secret_action": "set",
            "bind_password_action": "clear",
            "nested": {
                "token": "session-token-value",
                "note": (
                    "failed with token=leaked and "
                    "X-Amz-Signature=deadbeef at https://rgw.internal/object"
                ),
            },
            "items": [{"password": "plain-password"}],
        },
    )

    log = db_session.query(AuditLog).one()
    metadata = json.loads(log.metadata_json or "{}")
    assert metadata["endpoint_url"] == "https://s3.example.test/bucket"
    assert metadata["access_key_id"] == "AKIA1234567890ABCDEF"
    assert metadata["secret_access_key"] == "<redacted>"
    assert metadata["client_secret"] == "<redacted>"
    assert metadata["client_secret_action"] == "set"
    assert metadata["bind_password_action"] == "clear"
    assert metadata["nested"]["token"] == "<redacted>"
    assert "token=<redacted>" in metadata["nested"]["note"]
    assert "X-Amz-Signature=<redacted>" in metadata["nested"]["note"]
    assert "https://rgw.internal/object" in metadata["nested"]["note"]
    assert metadata["items"][0]["password"] == "<redacted>"
    assert "secret-value" not in log.metadata_json
    assert "oauth-secret" not in log.metadata_json
    assert "session-token-value" not in log.metadata_json
    assert "plain-password" not in log.metadata_json
