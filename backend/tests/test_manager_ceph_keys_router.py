# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.db import User, UserRole
from app.main import app
from app.models.s3_user import S3UserAccessKey, S3UserGeneratedKey
from app.routers.manager import ceph_keys as manager_ceph_keys_router
from app.services.s3_execution_context import S3ExecutionContext


class _FakeAuditService:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def record_action(self, **kwargs):  # noqa: ANN003
        self.calls.append(kwargs)


class _FakeS3UsersService:
    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def list_keys(self, user_id: int) -> list[S3UserAccessKey]:
        self.calls.append(("list_keys", user_id))
        return [
            S3UserAccessKey(
                access_key_id="AK-1",
                status="enabled",
                created_at=datetime(2026, 3, 12, 10, 0, tzinfo=timezone.utc),
                is_ui_managed=True,
                is_active=True,
            ),
            S3UserAccessKey(
                access_key_id="AK-2",
                status="disabled",
                created_at=datetime(2026, 3, 12, 11, 0, tzinfo=timezone.utc),
                is_ui_managed=False,
                is_active=False,
            ),
        ]

    def create_access_key_entry(self, user_id: int) -> S3UserGeneratedKey:
        self.calls.append(("create_access_key_entry", user_id))
        return S3UserGeneratedKey(access_key_id="AK-NEW", secret_access_key="SK-NEW")

    def set_key_status(self, user_id: int, access_key: str, active: bool) -> S3UserAccessKey:
        self.calls.append(("set_key_status", user_id, access_key, active))
        return S3UserAccessKey(
            access_key_id=access_key,
            status="enabled" if active else "disabled",
            is_ui_managed=False,
            is_active=active,
        )

    def delete_key(self, user_id: int, access_key: str) -> None:
        self.calls.append(("delete_key", user_id, access_key))


class _FakePortalKeyLockedService(_FakeS3UsersService):
    def set_key_status(self, user_id: int, access_key: str, active: bool) -> S3UserAccessKey:  # noqa: ARG002
        raise ValueError("Cannot disable the interface access key; rotate it instead")

    def delete_key(self, user_id: int, access_key: str) -> None:  # noqa: ARG002
        raise ValueError("Cannot delete the interface access key; rotate it instead")


def _account_context(*, s3_user_id: int | None = 77) -> S3ExecutionContext:
    return S3ExecutionContext(
        context_id=f"s3u-{s3_user_id}" if s3_user_id is not None else "s3u-missing",
        context_kind="legacy_user",
        name="managed-s3-user",
        access_key="AK",
        secret_key="SK",
        storage_endpoint_id=12,
        s3_user_id=s3_user_id,
    )


def _ui_user() -> User:
    return User(
        id=501,
        email="ui-user@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )


def test_manager_ceph_keys_list_ok(client):
    service = _FakeS3UsersService()

    app.dependency_overrides[manager_ceph_keys_router.require_manager_rgw_access_key_management] = lambda: _account_context()
    app.dependency_overrides[manager_ceph_keys_router.get_current_account_user] = _ui_user
    app.dependency_overrides[manager_ceph_keys_router.get_manager_ceph_s3_users_service] = lambda: service

    response = client.get("/api/manager/ceph/keys")

    assert response.status_code == 200, response.text
    assert [entry["access_key_id"] for entry in response.json()] == ["AK-1", "AK-2"]
    assert response.json()[0]["created_at"] == "2026-03-12T10:00:00Z"
    assert service.calls == [("list_keys", 77)]


def test_manager_ceph_keys_create_records_audit(client):
    service = _FakeS3UsersService()
    audit = _FakeAuditService()

    app.dependency_overrides[manager_ceph_keys_router.require_manager_rgw_access_key_management] = lambda: _account_context()
    app.dependency_overrides[manager_ceph_keys_router.get_current_account_user] = _ui_user
    app.dependency_overrides[manager_ceph_keys_router.get_manager_ceph_s3_users_service] = lambda: service
    app.dependency_overrides[manager_ceph_keys_router.get_audit_service] = lambda: audit

    response = client.post("/api/manager/ceph/keys")

    assert response.status_code == 201, response.text
    assert response.json()["access_key_id"] == "AK-NEW"
    assert service.calls == [("create_access_key_entry", 77)]
    assert len(audit.calls) == 1
    assert audit.calls[0]["scope"] == "manager"
    assert audit.calls[0]["action"] == "create_s3_user_access_key"


def test_manager_ceph_keys_update_status_records_audit(client):
    service = _FakeS3UsersService()
    audit = _FakeAuditService()

    app.dependency_overrides[manager_ceph_keys_router.require_manager_rgw_access_key_management] = lambda: _account_context()
    app.dependency_overrides[manager_ceph_keys_router.get_current_account_user] = _ui_user
    app.dependency_overrides[manager_ceph_keys_router.get_manager_ceph_s3_users_service] = lambda: service
    app.dependency_overrides[manager_ceph_keys_router.get_audit_service] = lambda: audit

    response = client.put("/api/manager/ceph/keys/AK-2/status", json={"active": False})

    assert response.status_code == 200, response.text
    assert response.json()["access_key_id"] == "AK-2"
    assert service.calls == [("set_key_status", 77, "AK-2", False)]
    assert len(audit.calls) == 1
    assert audit.calls[0]["action"] == "update_s3_user_access_key_status"


def test_manager_ceph_keys_delete_records_audit(client):
    service = _FakeS3UsersService()
    audit = _FakeAuditService()

    app.dependency_overrides[manager_ceph_keys_router.require_manager_rgw_access_key_management] = lambda: _account_context()
    app.dependency_overrides[manager_ceph_keys_router.get_current_account_user] = _ui_user
    app.dependency_overrides[manager_ceph_keys_router.get_manager_ceph_s3_users_service] = lambda: service
    app.dependency_overrides[manager_ceph_keys_router.get_audit_service] = lambda: audit

    response = client.delete("/api/manager/ceph/keys/AK-2")

    assert response.status_code == 204, response.text
    assert service.calls == [("delete_key", 77, "AK-2")]
    assert len(audit.calls) == 1
    assert audit.calls[0]["action"] == "delete_s3_user_access_key"


@pytest.mark.parametrize(
    ("method", "path", "json_payload"),
    [
        ("get", "/api/manager/ceph/keys", None),
        ("post", "/api/manager/ceph/keys", None),
        ("put", "/api/manager/ceph/keys/AK-2/status", {"active": True}),
        ("put", "/api/manager/ceph/keys/AK-2/status", {"active": False}),
        ("delete", "/api/manager/ceph/keys/AK-2", None),
    ],
)
def test_manager_ceph_key_endpoints_forbid_operations_before_ceph_call(
    client,
    method,
    path,
    json_payload,
):
    service = _FakeS3UsersService()

    def _forbidden_context():
        raise HTTPException(status_code=403, detail="Ceph key management is not available for this context")

    app.dependency_overrides[manager_ceph_keys_router.require_manager_rgw_access_key_management] = _forbidden_context
    app.dependency_overrides[manager_ceph_keys_router.get_current_account_user] = _ui_user
    app.dependency_overrides[manager_ceph_keys_router.get_manager_ceph_s3_users_service] = lambda: service

    response = (
        getattr(client, method)(path, json=json_payload)
        if json_payload is not None
        else getattr(client, method)(path)
    )

    assert response.status_code == 403, response.text
    assert "not available" in response.json()["detail"].lower()
    assert service.calls == []


def test_manager_ceph_keys_forbidden_when_context_is_not_s3_user(client):
    service = _FakeS3UsersService()

    app.dependency_overrides[manager_ceph_keys_router.require_manager_rgw_access_key_management] = lambda: _account_context(s3_user_id=None)
    app.dependency_overrides[manager_ceph_keys_router.get_current_account_user] = _ui_user
    app.dependency_overrides[manager_ceph_keys_router.get_manager_ceph_s3_users_service] = lambda: service

    response = client.get("/api/manager/ceph/keys")

    assert response.status_code == 403, response.text
    assert "not available" in response.json()["detail"].lower()
    assert service.calls == []


def test_manager_ceph_keys_rejects_disabling_portal_key(client):
    service = _FakePortalKeyLockedService()

    app.dependency_overrides[manager_ceph_keys_router.require_manager_rgw_access_key_management] = lambda: _account_context()
    app.dependency_overrides[manager_ceph_keys_router.get_current_account_user] = _ui_user
    app.dependency_overrides[manager_ceph_keys_router.get_manager_ceph_s3_users_service] = lambda: service

    response = client.put("/api/manager/ceph/keys/AK-PORTAL/status", json={"active": False})

    assert response.status_code == 400, response.text
    assert "cannot disable" in response.json()["detail"].lower()


def test_manager_ceph_keys_rejects_deleting_portal_key(client):
    service = _FakePortalKeyLockedService()

    app.dependency_overrides[manager_ceph_keys_router.require_manager_rgw_access_key_management] = lambda: _account_context()
    app.dependency_overrides[manager_ceph_keys_router.get_current_account_user] = _ui_user
    app.dependency_overrides[manager_ceph_keys_router.get_manager_ceph_s3_users_service] = lambda: service

    response = client.delete("/api/manager/ceph/keys/AK-PORTAL")

    assert response.status_code == 400, response.text
    assert "cannot delete" in response.json()["detail"].lower()
