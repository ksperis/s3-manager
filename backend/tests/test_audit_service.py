# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json

import pytest

from app.db import AuditLog, S3Account, User, UserRole
from app.services.audit_policy import (
    DATA_PLANE_AUDIT_ACTIONS,
    NON_AUDIT_OPERATION_ACTIONS,
    should_persist_audit_action,
)
from app.services.audit_service import (
    MAX_AUDIT_METADATA_LENGTH,
    AuditService,
    parse_audit_metadata,
)
from tests.s3_account_factory import make_s3_account


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
    account = make_s3_account(db_session, name="persisted-account")
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    service = AuditService(db_session)
    service.record_action(
        user=user,
        scope="browser",
        action="update_bucket_versioning",
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
        action="update_bucket_versioning",
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


def test_audit_metadata_truncation_remains_valid_json(db_session) -> None:
    user = _create_user(db_session)
    service = AuditService(db_session)
    service.record_action(
        user=user,
        scope="admin",
        action="large_metadata",
        metadata={"details": 'value with "quotes" and \\slashes ' * 1000},
    )

    log = db_session.query(AuditLog).one()
    assert log.metadata_json is not None
    assert len(log.metadata_json) <= MAX_AUDIT_METADATA_LENGTH
    metadata = parse_audit_metadata(log.metadata_json)
    assert metadata is not None
    assert metadata["truncated"] is True
    assert metadata["original_length"] > MAX_AUDIT_METADATA_LENGTH
    assert metadata["preview"].startswith('{"details":')


def test_audit_metadata_parser_rejects_noncanonical_storage() -> None:
    assert parse_audit_metadata(None) is None
    assert parse_audit_metadata('{"key": "value"}') == {"key": "value"}

    for raw in ("{", "[]", '"value"'):
        with pytest.raises(ValueError):
            parse_audit_metadata(raw)


@pytest.mark.parametrize(
    "action",
    sorted(DATA_PLANE_AUDIT_ACTIONS | NON_AUDIT_OPERATION_ACTIONS),
)
@pytest.mark.parametrize("status", ["success", "failure"])
def test_record_action_does_not_persist_excluded_actions(
    db_session,
    action: str,
    status: str,
) -> None:
    AuditService(db_session).record_action(
        user=None,
        user_email="actor@example.com",
        user_role="user",
        scope="browser",
        action=action,
        status=status,
        metadata={"secret_access_key": "must-not-be-processed"},
    )

    assert db_session.query(AuditLog).count() == 0
    assert should_persist_audit_action(action) is False


@pytest.mark.parametrize(
    "action",
    [
        "login_success",
        "logout",
        "revoke_api_token",
        "create_iam_user",
        "create_portal_share",
        "create_public_link",
        "update_bucket_versioning",
        "update_project_portal_settings",
        "start_bucket_migration",
        "finish_storage_space_history_cleanup",
    ],
)
def test_record_action_keeps_control_security_and_workflow_actions(
    db_session,
    action: str,
) -> None:
    AuditService(db_session).record_action(
        user=None,
        user_email="actor@example.com",
        user_role="user",
        scope="portal",
        action=action,
    )

    assert db_session.query(AuditLog).one().action == action
    assert should_persist_audit_action(action) is True
