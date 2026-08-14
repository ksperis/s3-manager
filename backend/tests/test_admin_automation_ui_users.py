# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.db import User, UserRole
from app.models.admin_automation import (
    AdminAutomationApplyRequest,
    UiUserApply,
    UiUserMatch,
    UiUserSpec,
)
from app.services.admin_automation_service import AdminAutomationService
from app.services.admin_automation_ui_user_handler import AdminAutomationUiUserHandler


class _Audit:
    def __init__(self) -> None:
        self.actions: list[dict] = []

    def record_action(self, **kwargs) -> None:
        self.actions.append(kwargs)


def _user(db_session, *, email: str, role: str) -> User:
    user = User(
        email=email,
        hashed_password="existing-password-hash",
        is_active=True,
        role=role,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_automation_creates_ui_user_through_dedicated_handler(db_session):
    actor = _user(
        db_session,
        email="ui-user-automation-actor@example.com",
        role=UserRole.UI_SUPERADMIN.value,
    )
    audit = _Audit()

    result = AdminAutomationService(db_session).apply(
        AdminAutomationApplyRequest(
            ui_users=[
                UiUserApply(
                    match=UiUserMatch(email="created-by-automation@example.com"),
                    spec=UiUserSpec(
                        password="automation-password",
                        full_name="Created by automation",
                        role=UserRole.UI_ADMIN.value,
                    ),
                )
            ]
        ),
        current_user=actor,
        audit_service=audit,
    )

    created = (
        db_session.query(User)
        .filter(User.email == "created-by-automation@example.com")
        .one()
    )
    assert result.success is True
    assert result.results[0].action == "created"
    assert created.full_name == "Created by automation"
    assert created.role == UserRole.UI_ADMIN.value
    assert [action["action"] for action in audit.actions] == ["create_ui_user"]


def test_automation_rejects_superadmin_promotion_by_ui_admin(db_session):
    actor = _user(
        db_session,
        email="ui-admin-automation-actor@example.com",
        role=UserRole.UI_ADMIN.value,
    )
    target_email = "forbidden-superadmin@example.com"

    result = AdminAutomationService(db_session).apply(
        AdminAutomationApplyRequest(
            ui_users=[
                UiUserApply(
                    match=UiUserMatch(email=target_email),
                    spec=UiUserSpec(
                        password="automation-password",
                        role=UserRole.UI_SUPERADMIN.value,
                    ),
                )
            ]
        ),
        current_user=actor,
        audit_service=_Audit(),
    )

    assert result.success is False
    assert result.results[0].action == "failed"
    assert "Only superadmin users" in (result.results[0].error or "")
    assert db_session.query(User).filter(User.email == target_email).first() is None


def test_automation_ignores_password_without_explicit_rotation(db_session):
    actor = _user(
        db_session,
        email="password-automation-actor@example.com",
        role=UserRole.UI_SUPERADMIN.value,
    )
    target = _user(
        db_session,
        email="password-automation-target@example.com",
        role=UserRole.UI_USER.value,
    )
    original_hash = target.hashed_password

    result = AdminAutomationService(db_session).apply(
        AdminAutomationApplyRequest(
            ui_users=[
                UiUserApply(
                    match=UiUserMatch(id=target.id),
                    spec=UiUserSpec(
                        full_name="Updated without password rotation",
                        password="replacement-password",
                    ),
                )
            ]
        ),
        current_user=actor,
        audit_service=_Audit(),
    )

    db_session.refresh(target)
    assert result.success is True
    assert result.results[0].action == "updated"
    assert target.full_name == "Updated without password rotation"
    assert target.hashed_password == original_hash


def test_ui_user_update_maps_association_ids_to_user_service_contract():
    payload = AdminAutomationUiUserHandler._build_update(
        UiUserApply(
            match=UiUserMatch(id=42),
            spec=UiUserSpec(
                s3_user_ids=[4, 2, 4],
                s3_connection_ids=[3, 1, 3],
            ),
        )
    )

    assert [link.s3_user_id for link in payload.s3_user_links or []] == [2, 4]
    assert payload.s3_connection_ids == [1, 3]


def test_ui_user_match_rejects_ambiguous_references():
    with pytest.raises(ValidationError):
        UiUserMatch(id=42, email="ambiguous-ui-user@example.com")
