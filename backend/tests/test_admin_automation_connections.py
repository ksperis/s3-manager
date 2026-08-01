# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.db import S3Connection, User, UserRole
from app.models.admin_automation import (
    AdminAutomationApplyRequest,
    S3ConnectionApply,
    S3ConnectionMatch,
    S3ConnectionSpec,
)
from app.services.admin_automation_service import AdminAutomationService


class _Audit:
    def record_action(self, **_kwargs) -> None:
        return None


def _user(db_session) -> User:
    user = User(
        email="automation-connections@example.test",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _connection(db_session, user: User, *, name: str, shared: bool) -> S3Connection:
    connection = S3Connection(
        created_by_user_id=user.id,
        name=name,
        is_shared=shared,
        access_manager=True,
        access_browser=True,
        access_key_id=f"AK-{name}-{shared}",
        secret_access_key=f"SK-{name}-{shared}",
    )
    db_session.add(connection)
    db_session.commit()
    db_session.refresh(connection)
    return connection


def test_automation_cannot_find_or_delete_private_connection_by_id(db_session):
    user = _user(db_session)
    private = _connection(db_session, user, name="private-id-target", shared=False)
    service = AdminAutomationService(db_session)
    item = S3ConnectionApply(
        state="absent",
        match=S3ConnectionMatch(id=private.id),
    )

    result = service.apply(
        AdminAutomationApplyRequest(s3_connections=[item]),
        current_user=user,
        audit_service=_Audit(),
    )

    assert result.success is True
    assert result.results[0].action == "skipped"
    assert db_session.query(S3Connection).filter(S3Connection.id == private.id).one()


def test_automation_name_lookup_selects_shared_connection_only(db_session):
    user = _user(db_session)
    private = _connection(db_session, user, name="same-name", shared=False)
    shared = _connection(db_session, user, name="same-name", shared=True)
    service = AdminAutomationService(db_session)

    found = service._find_s3_connection(
        S3ConnectionApply(state="absent", match=S3ConnectionMatch(name="same-name")),
        user,
    )

    assert found is not None and found.id == shared.id
    assert found.id != private.id


@pytest.mark.parametrize("legacy_field", ["is_shared", "access_manager", "access_browser"])
def test_automation_connection_spec_rejects_visibility_and_access_flags(legacy_field):
    with pytest.raises(ValidationError):
        S3ConnectionSpec.model_validate(
            {
                "name": "invalid-spec",
                "endpoint_url": "https://automation.invalid.test",
                "access_key_id": "AK-INVALID",
                "secret_access_key": "SK-INVALID",
                legacy_field: True,
            }
        )


def test_automation_creates_shared_manager_only_connection(db_session, monkeypatch):
    user = _user(db_session)
    service = AdminAutomationService(db_session)
    monkeypatch.setattr(service, "_refresh_detected_capabilities", lambda connection: None)
    item = S3ConnectionApply(
        match=S3ConnectionMatch(name="automation-created"),
        spec=S3ConnectionSpec(
            name="automation-created",
            endpoint_url="https://automation-created.example.test",
            access_key_id="AK-AUTOMATION-CREATED",
            secret_access_key="SK-AUTOMATION-CREATED",
        ),
    )

    result = service.apply(
        AdminAutomationApplyRequest(s3_connections=[item]),
        current_user=user,
        audit_service=_Audit(),
    )

    assert result.success is True
    created = db_session.query(S3Connection).filter(S3Connection.name == "automation-created").one()
    assert created.is_shared is True
    assert created.access_manager is True
    assert created.access_browser is False
    assert created.remediation_required is False
