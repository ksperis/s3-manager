# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import base64

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.db import (
    AccountRole,
    S3Account,
    S3Connection,
    S3User,
    StorageEndpoint,
    StorageProvider,
    User,
    UserRole,
    UserS3Account,
    UiGroupS3Connection,
)
from app.main import app
from app.routers import dependencies, execution_contexts
from app.services.effective_access_service import EffectiveAccessService
from app.services.users_service import UsersService
from tests.s3_account_factory import make_s3_account


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


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
    account = make_s3_account(
        db_session,
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
    endpoint = StorageEndpoint(
        name=f"{name}-endpoint",
        endpoint_url=f"https://{name}-endpoint.example.test",
        provider=StorageProvider.CEPH.value,
        is_default=True,
    )
    s3_user = S3User(
        name=name,
        rgw_user_uid=f"uid-{name}",
        rgw_access_key=f"AK-{name}",
        rgw_secret_key=f"SK-{name}",
        storage_endpoint=endpoint,
    )
    db_session.add_all([endpoint, s3_user])
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
        custom_endpoint_config=json.dumps(
            {
                "endpoint_url": f"https://{name}.example.test",
                "force_path_style": False,
                "provider": None,
                "region": None,
                "verify_tls": True,
            }
        ),
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
                    "role": AccountRole.ACCOUNT_ADMINISTRATOR.value,
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
    assert payload["can_create_manual_private_connections"] is False
    assert payload["can_provision_managed_private_connections"] is False
    assert payload["manager_tool_access"] == {
        "bucket_compare": False,
        "bucket_integrity_check": False,
        "bucket_migration": False,
        "bucket_purge": False,
        "feature_rules": False,
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
        }
    ]

    reject_resp = client.put(
        f"/api/admin/groups/{payload['id']}",
        json={"s3_connection_ids": [private_connection.id]},
    )
    assert reject_resp.status_code == 400
    assert "Only shared S3 connections can be linked" in reject_resp.json()["detail"]


def test_ui_group_projection_and_search_hide_private_connection_links(
    client: TestClient,
    db_session,
):
    user = _user(db_session, email="private-group-link@example.com")
    private_connection = _connection(
        db_session,
        creator_id=user.id,
        name="private-group-secret-name",
        shared=False,
    )
    created = client.post(
        "/api/admin/groups",
        json={"name": "Private legacy link holder"},
    )
    assert created.status_code == 201, created.text
    group_id = created.json()["id"]
    db_session.add(
        UiGroupS3Connection(
            group_id=group_id,
            s3_connection_id=private_connection.id,
        )
    )
    db_session.commit()

    listed = client.get(
        "/api/admin/groups",
        params={"search": "Private legacy link holder"},
    )
    assert listed.status_code == 200, listed.text
    group_payload = listed.json()["items"][0]
    assert group_payload["s3_connections"] == []
    assert group_payload["s3_connection_details"] == []

    hidden_search = client.get(
        "/api/admin/groups",
        params={"search": "private-group-secret-name"},
    )
    assert hidden_search.status_code == 200, hidden_search.text
    assert hidden_search.json()["total"] == 0


def test_ui_group_avatar_supports_presets_upload_and_initials_fallback(client: TestClient, db_session):
    created = client.post(
        "/api/admin/groups",
        json={"name": "Research Operators", "avatar_source": "preset", "avatar_icon": "academic"},
    )
    assert created.status_code == 201, created.text
    group_id = created.json()["id"]
    assert created.json()["avatar"] == {
        "source": "preset",
        "initials": "RO",
        "icon": "academic",
        "url": None,
        "updated_at": created.json()["avatar"]["updated_at"],
    }

    minimal = client.get("/api/admin/groups/minimal")
    assert minimal.status_code == 200, minimal.text
    assert next(item for item in minimal.json() if item["id"] == group_id)["avatar"]["icon"] == "academic"

    uploaded = client.put(
        f"/api/admin/groups/{group_id}/avatar",
        files={"file": ("group.png", PNG_1X1, "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["avatar"]["source"] == "uploaded"
    assert uploaded.json()["avatar"]["url"].startswith(f"/admin/groups/{group_id}/avatar?v=")

    image = client.get(f"/api/admin/groups/{group_id}/avatar")
    assert image.status_code == 200
    assert image.content == PNG_1X1
    assert image.headers["content-type"] == "image/png"

    deleted = client.delete(f"/api/admin/groups/{group_id}/avatar")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["avatar"]["source"] == "initials"
    assert deleted.json()["avatar"]["initials"] == "RO"
    assert client.get(f"/api/admin/groups/{group_id}/avatar").status_code == 404


def test_ui_group_avatar_rejects_unsupported_content(client: TestClient):
    created = client.post("/api/admin/groups", json={"name": "Unsafe Image Group"})
    group_id = created.json()["id"]
    response = client.put(
        f"/api/admin/groups/{group_id}/avatar",
        files={"file": ("group.svg", b"<svg/>", "image/svg+xml")},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Avatar image must be a PNG or JPEG file."


def test_ui_group_effective_access_is_inherited_without_overwriting_direct_user_fields(client: TestClient, db_session):
    user = _user(db_session, role=UserRole.UI_USER.value)
    account = _account(db_session)
    s3_user = _s3_user(db_session)
    connection = _connection(db_session, creator_id=user.id, shared=True, access_manager=True)
    db_session.add(
            UserS3Account(
                user_id=user.id,
                account_id=account.id,
                is_root=False,
                role=AccountRole.PORTAL_USER.value,
            )
    )
    db_session.commit()

    response = client.post(
        "/api/admin/groups",
        json={
            "name": "Inherited operators",
            "can_access_storage_ops": True,
            "browser_advanced_features_enabled": True,
            "can_create_manual_private_connections": True,
            "can_provision_managed_private_connections": True,
            "manager_tool_access": {
                "bucket_compare": True,
                "bucket_integrity_check": False,
                "bucket_migration": True,
                "bucket_purge": True,
                "feature_rules": True,
            },
            "user_ids": [user.id],
            "account_links": [
                {
                    "account_id": account.id,
                    "role": AccountRole.ACCOUNT_ADMINISTRATOR.value,
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
    assert out.can_create_manual_private_connections is False
    assert out.can_provision_managed_private_connections is False
    assert out.manager_tool_access.bucket_compare is False
    assert out.effective_access is not None
    assert out.effective_access.can_access_storage_ops is True
    assert out.effective_access.browser_advanced_features_enabled is True
    assert out.effective_access.can_create_manual_private_connections is True
    assert out.effective_access.can_provision_managed_private_connections is True
    assert out.effective_access.manager_tool_access.bucket_compare is True
    assert out.effective_access.manager_tool_access.bucket_migration is True
    assert out.effective_access.manager_tool_access.bucket_purge is True
    assert out.effective_access.manager_tool_access.feature_rules is True
    assert "bucket_quota" not in out.effective_access.manager_tool_access.model_dump()
    assert "ceph_s3_user_keys" not in out.effective_access.manager_tool_access.model_dump()
    assert out.effective_access.accounts == [account.id]
    effective_account = out.effective_access.account_links[0]
    assert effective_account.role == AccountRole.ACCOUNT_ADMINISTRATOR.value
    assert effective_account.provenance.direct_role == AccountRole.PORTAL_USER.value
    assert effective_account.provenance.direct_determines_effective_role is False
    assert len(effective_account.provenance.groups) == 1
    assert effective_account.provenance.groups[0].role == AccountRole.ACCOUNT_ADMINISTRATOR.value
    assert effective_account.provenance.groups[0].determines_effective_role is True
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
    assert response.json()["detail"] == "Only superadmin users can grant privileged Ceph access"


def test_group_payload_rejects_removed_bucket_quota_permission(client: TestClient, db_session):
    admin_user = User(
        id=7002,
        email="admin-ui-group-quota@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: admin_user

    response = client.post(
        "/api/admin/groups",
        json={
            "name": "Quota operators",
            "manager_tool_access": {"bucket_quota": True},
        },
    )

    assert response.status_code == 422


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
