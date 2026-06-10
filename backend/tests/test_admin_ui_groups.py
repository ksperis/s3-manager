# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.db import (
    AccountRole,
    S3Account,
    S3Connection,
    S3User,
    User,
    UserRole,
    UserS3Account,
)
from app.main import app
from app.routers import dependencies, execution_contexts
from app.services.effective_access_service import EffectiveAccessService
from app.services.users_service import UsersService


def _user(db_session, *, email: str = "group-user@example.com", role: str = UserRole.UI_USER.value) -> User:
    user = User(
        email=email,
        hashed_password="x",
        is_active=True,
        role=role,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _account(db_session, *, name: str = "group-account") -> S3Account:
    account = S3Account(
        name=name,
        rgw_account_id=f"RGW-{name}",
        rgw_access_key=f"AK-{name}",
        rgw_secret_key=f"SK-{name}",
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def _s3_user(db_session, *, name: str = "group-s3-user") -> S3User:
    s3_user = S3User(
        name=name,
        rgw_user_uid=f"uid-{name}",
        rgw_access_key=f"AK-{name}",
        rgw_secret_key=f"SK-{name}",
    )
    db_session.add(s3_user)
    db_session.commit()
    db_session.refresh(s3_user)
    return s3_user


def _connection(
    db_session,
    *,
    creator_id: int,
    name: str = "group-connection",
    shared: bool = True,
    access_manager: bool = True,
) -> S3Connection:
    connection = S3Connection(
        created_by_user_id=creator_id,
        name=name,
        is_shared=shared,
        is_active=True,
        access_manager=access_manager,
        access_browser=True,
        capabilities_json=json.dumps({"can_manage_iam": True}),
        access_key_id=f"AK-{name}",
        secret_access_key=f"SK-{name}",
    )
    db_session.add(connection)
    db_session.commit()
    db_session.refresh(connection)
    return connection


def test_ui_group_crud_defaults_and_rejects_private_connections(client: TestClient, db_session):
    user = _user(db_session)
    account = _account(db_session)
    s3_user = _s3_user(db_session)
    shared_connection = _connection(db_session, creator_id=user.id, shared=True)
    private_connection = _connection(db_session, creator_id=user.id, name="private-connection", shared=False)

    create_resp = client.post(
        "/api/admin/groups",
        json={
            "name": "Storage operators",
            "description": "Shared UI access",
            "user_ids": [user.id],
            "account_links": [
                {
                    "account_id": account.id,
                    "account_admin": True,
                    "account_role": AccountRole.PORTAL_MANAGER.value,
                }
            ],
            "s3_user_ids": [s3_user.id],
            "s3_connection_ids": [shared_connection.id],
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    payload = create_resp.json()
    assert payload["name"] == "Storage operators"
    assert payload["can_access_ceph_admin"] is False
    assert payload["can_access_storage_ops"] is False
    assert payload["browser_advanced_features_enabled"] is False
    assert payload["manager_tool_access"] == {
        "bucket_compare": False,
        "bucket_integrity_check": False,
        "bucket_migration": False,
        "feature_rules": False,
        "ceph_s3_user_keys": False,
    }
    assert payload["user_ids"] == [user.id]
    assert payload["accounts"] == [account.id]
    assert payload["account_details"] == [
        {"id": account.id, "name": "group-account", "rgw_account_id": "RGW-group-account"}
    ]
    assert payload["s3_users"] == [s3_user.id]
    assert payload["s3_user_details"] == [{"id": s3_user.id, "name": "group-s3-user"}]
    assert payload["s3_connections"] == [shared_connection.id]
    assert payload["s3_connection_details"] == [
        {
            "id": shared_connection.id,
            "name": "group-connection",
            "access_manager": True,
            "access_browser": True,
        }
    ]

    reject_resp = client.put(
        f"/api/admin/groups/{payload['id']}",
        json={"s3_connection_ids": [private_connection.id]},
    )
    assert reject_resp.status_code == 400
    assert "Only shared S3 connections can be linked" in reject_resp.json()["detail"]


def test_ui_group_effective_access_is_inherited_without_overwriting_direct_user_fields(client: TestClient, db_session):
    user = _user(db_session, role=UserRole.UI_USER.value)
    account = _account(db_session)
    s3_user = _s3_user(db_session)
    connection = _connection(db_session, creator_id=user.id, shared=True, access_manager=True)
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            account_admin=False,
            is_root=False,
            account_role=AccountRole.PORTAL_USER.value,
        )
    )
    db_session.commit()

    response = client.post(
        "/api/admin/groups",
        json={
            "name": "Inherited operators",
            "can_access_storage_ops": True,
            "browser_advanced_features_enabled": True,
            "manager_tool_access": {
                "bucket_compare": True,
                "bucket_integrity_check": False,
                "bucket_migration": True,
                "feature_rules": True,
                "ceph_s3_user_keys": False,
            },
            "user_ids": [user.id],
            "account_links": [
                {
                    "account_id": account.id,
                    "account_admin": True,
                    "account_role": AccountRole.PORTAL_MANAGER.value,
                }
            ],
            "s3_user_ids": [s3_user.id],
            "s3_connection_ids": [connection.id],
        },
    )
    assert response.status_code == 201, response.text

    out = UsersService(db_session).user_to_out(user)
    assert out.can_access_storage_ops is False
    assert out.browser_advanced_features_enabled is False
    assert out.manager_tool_access.bucket_compare is False
    assert out.effective_access is not None
    assert out.effective_access.can_access_storage_ops is True
    assert out.effective_access.browser_advanced_features_enabled is True
    assert out.effective_access.manager_tool_access.bucket_compare is True
    assert out.effective_access.manager_tool_access.bucket_migration is True
    assert out.effective_access.manager_tool_access.feature_rules is True
    assert out.effective_access.accounts == [account.id]
    assert out.effective_access.account_links[0].account_admin is True
    assert out.effective_access.account_links[0].account_role == AccountRole.PORTAL_MANAGER.value
    assert out.effective_access.s3_users == [s3_user.id]
    assert out.effective_access.s3_connections == [connection.id]

    account_ctx = dependencies.get_account_context(
        request=type("Request", (), {"url": type("Url", (), {"path": "/api/manager/buckets"})(), "headers": {}})(),
        account_ref=str(account.id),
        actor=user,
        db=db_session,
    )
    assert account_ctx.id == account.id

    contexts = execution_contexts.list_execution_contexts(workspace="manager", user=user, db=db_session)
    context_ids = {context.id for context in contexts}
    assert str(account.id) in context_ids
    assert f"s3u-{s3_user.id}" in context_ids
    assert f"conn-{connection.id}" in context_ids


def test_group_ceph_admin_grant_requires_superadmin(client: TestClient, db_session):
    admin_user = User(
        id=7001,
        email="admin-ui-group@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: admin_user

    response = client.post(
        "/api/admin/groups",
        json={"name": "Ceph admins", "can_access_ceph_admin": True},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Only superadmin users can grant ceph_admin access"


def test_effective_ceph_admin_requires_user_admin_role(client: TestClient, db_session):
    ui_user = _user(db_session, email="plain-ui-user@example.com", role=UserRole.UI_USER.value)
    ui_admin = _user(db_session, email="admin-ui-user@example.com", role=UserRole.UI_ADMIN.value)

    response = client.post(
        "/api/admin/groups",
        json={
            "name": "Ceph group",
            "can_access_ceph_admin": True,
            "user_ids": [ui_user.id, ui_admin.id],
        },
    )
    assert response.status_code == 201, response.text

    service = EffectiveAccessService(db_session)
    assert service.resolve_user(ui_user).can_access_ceph_admin is False
    assert service.resolve_user(ui_admin).can_access_ceph_admin is True

    with_dependencies = dependencies.get_current_ceph_admin(user=ui_admin, db=db_session)
    assert with_dependencies.id == ui_admin.id
    try:
        dependencies.get_current_ceph_admin(user=ui_user, db=db_session)
    except HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("plain UI user should not inherit effective Ceph Admin access")
