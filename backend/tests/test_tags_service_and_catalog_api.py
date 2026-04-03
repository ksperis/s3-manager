# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import S3Account, S3Connection, S3User, StorageEndpoint, StorageProvider, TagDefinition, User, UserRole, UserS3Account
from app.main import app
from app.routers import dependencies
from app.services.tags_service import TagsService
from app.utils.tagging import TAG_DOMAIN_ADMIN_MANAGED, TAG_DOMAIN_ENDPOINT, TAG_DOMAIN_PRIVATE_CONNECTION_USER
from fastapi.testclient import TestClient


def _ui_admin(user_id: int, email: str) -> User:
    return User(
        id=user_id,
        email=email,
        full_name=email.split("@", 1)[0],
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )


def _endpoint(db_session, name: str = "tags-endpoint") -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider=StorageProvider.CEPH.value,
        is_default=False,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def _account(db_session, endpoint_id: int, name: str = "tags-account") -> S3Account:
    account = S3Account(
        name=name,
        rgw_account_id=f"RGW-{name.upper()}",
        rgw_access_key=f"AK-{name.upper()}",
        rgw_secret_key=f"SK-{name.upper()}",
        storage_endpoint_id=endpoint_id,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def _s3_user(db_session, endpoint_id: int, name: str = "tags-user") -> S3User:
    s3_user = S3User(
        name=name,
        rgw_user_uid=f"{name}-uid",
        rgw_access_key=f"AK-{name.upper()}",
        rgw_secret_key=f"SK-{name.upper()}",
        storage_endpoint_id=endpoint_id,
    )
    db_session.add(s3_user)
    db_session.commit()
    db_session.refresh(s3_user)
    return s3_user


def _private_connection(db_session, owner_user_id: int, name: str) -> S3Connection:
    row = S3Connection(
        created_by_user_id=owner_user_id,
        name=name,
        is_shared=False,
        is_active=True,
        access_manager=False,
        access_browser=True,
        access_key_id=f"AK-{name.upper()}",
        secret_access_key=f"SK-{name.upper()}",
        capabilities_json='{"can_manage_iam": false}',
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def test_tags_service_propagates_admin_managed_color_updates_across_entities(db_session):
    endpoint = _endpoint(db_session, name="admin-managed-endpoint")
    account = _account(db_session, endpoint.id, name="admin-managed-account")
    s3_user = _s3_user(db_session, endpoint.id, name="admin-managed-user")
    service = TagsService(db_session)

    service.replace_account_tags(account, [{"label": "prod", "color_key": "amber"}])
    service.replace_s3_user_tags(s3_user, [{"label": "prod", "color_key": "blue"}])

    assert [tag.label for tag in service.get_account_tags(account)] == ["prod"]
    assert [tag.color_key for tag in service.get_account_tags(account)] == ["blue"]
    assert [tag.scope for tag in service.get_account_tags(account)] == ["standard"]
    assert [tag.color_key for tag in service.get_s3_user_tags(s3_user)] == ["blue"]
    assert [tag.scope for tag in service.get_s3_user_tags(s3_user)] == ["standard"]

    definitions = service.list_definitions(domain_kind=TAG_DOMAIN_ADMIN_MANAGED, owner_user_id=None)
    assert len(definitions) == 1
    assert definitions[0].label == "prod"
    assert definitions[0].color_key == "blue"
    assert definitions[0].scope == "standard"


def test_tags_service_isolates_private_tag_colors_per_owner(db_session):
    owner_a = _ui_admin(4101, "owner-a@example.test")
    owner_b = _ui_admin(4102, "owner-b@example.test")
    db_session.add_all([owner_a, owner_b])
    db_session.commit()

    connection_a = _private_connection(db_session, owner_a.id, "private-a")
    connection_b = _private_connection(db_session, owner_b.id, "private-b")
    service = TagsService(db_session)

    service.replace_connection_tags(connection_a, [{"label": "prod", "color_key": "amber"}])
    service.replace_connection_tags(connection_b, [{"label": "prod", "color_key": "blue"}])

    assert [tag.color_key for tag in service.get_connection_tags(connection_a)] == ["amber"]
    assert [tag.color_key for tag in service.get_connection_tags(connection_b)] == ["blue"]

    owner_a_catalog = service.list_definitions(domain_kind=TAG_DOMAIN_PRIVATE_CONNECTION_USER, owner_user_id=owner_a.id)
    owner_b_catalog = service.list_definitions(domain_kind=TAG_DOMAIN_PRIVATE_CONNECTION_USER, owner_user_id=owner_b.id)
    assert [(item.label, item.color_key, item.scope) for item in owner_a_catalog] == [("prod", "amber", "standard")]
    assert [(item.label, item.color_key, item.scope) for item in owner_b_catalog] == [("prod", "blue", "standard")]
    assert db_session.query(TagDefinition).filter(TagDefinition.domain_kind == TAG_DOMAIN_PRIVATE_CONNECTION_USER).count() == 2


def test_admin_tag_definitions_api_respects_domain_permissions(client: TestClient, db_session):
    endpoint = _endpoint(db_session, name="catalog-endpoint")
    account = _account(db_session, endpoint.id, name="catalog-account")
    service = TagsService(db_session)

    service.replace_storage_endpoint_tags(endpoint, [{"label": "rgw-a", "color_key": "violet"}])
    service.replace_account_tags(account, [{"label": "finance", "color_key": "emerald"}])
    db_session.commit()

    admin_managed_resp = client.get("/api/admin/tag-definitions", params={"domain": "admin_managed"})
    assert admin_managed_resp.status_code == 200, admin_managed_resp.text
    assert [(item["label"], item["color_key"], item["scope"]) for item in admin_managed_resp.json()["items"]] == [
        ("finance", "emerald", "standard")
    ]

    endpoint_resp = client.get("/api/admin/tag-definitions", params={"domain": "endpoint"})
    assert endpoint_resp.status_code == 200, endpoint_resp.text
    assert [(item["label"], item["color_key"], item["scope"]) for item in endpoint_resp.json()["items"]] == [
        ("rgw-a", "violet", "standard")
    ]

    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: _ui_admin(5001, "admin@example.test")
    admin_endpoint_resp = client.get("/api/admin/tag-definitions", params={"domain": "endpoint"})
    assert admin_endpoint_resp.status_code == 403, admin_endpoint_resp.text

    admin_managed_as_admin_resp = client.get("/api/admin/tag-definitions", params={"domain": "admin_managed"})
    assert admin_managed_as_admin_resp.status_code == 200, admin_managed_as_admin_resp.text
    assert [(item["label"], item["color_key"], item["scope"]) for item in admin_managed_as_admin_resp.json()["items"]] == [
        ("finance", "emerald", "standard")
    ]


def test_private_connection_tag_definitions_api_isolated_by_owner(client: TestClient, db_session):
    owner_a = _ui_admin(6101, "private-owner-a@example.test")
    owner_b = _ui_admin(6102, "private-owner-b@example.test")
    db_session.add_all([owner_a, owner_b])
    db_session.commit()

    connection_a = _private_connection(db_session, owner_a.id, "private-catalog-a")
    connection_b = _private_connection(db_session, owner_b.id, "private-catalog-b")
    service = TagsService(db_session)
    service.replace_connection_tags(connection_a, [{"label": "ops", "color_key": "orange"}])
    service.replace_connection_tags(connection_b, [{"label": "ops", "color_key": "sky"}])
    db_session.commit()

    app.dependency_overrides[dependencies.get_current_account_user] = lambda: owner_a
    owner_a_resp = client.get("/api/connections/tag-definitions")
    assert owner_a_resp.status_code == 200, owner_a_resp.text
    assert [(item["label"], item["color_key"], item["scope"]) for item in owner_a_resp.json()["items"]] == [
        ("ops", "orange", "standard")
    ]

    app.dependency_overrides[dependencies.get_current_account_user] = lambda: owner_b
    owner_b_resp = client.get("/api/connections/tag-definitions")
    assert owner_b_resp.status_code == 200, owner_b_resp.text
    assert [(item["label"], item["color_key"], item["scope"]) for item in owner_b_resp.json()["items"]] == [
        ("ops", "sky", "standard")
    ]


def test_execution_contexts_selector_hides_administrative_tags(client: TestClient, db_session):
    user = _ui_admin(7101, "selector-user@example.test")
    db_session.add(user)
    db_session.commit()

    endpoint = _endpoint(db_session, name="selector-endpoint")
    account = _account(db_session, endpoint.id, name="selector-account")
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            account_admin=True,
            is_root=False,
        )
    )
    db_session.commit()

    service = TagsService(db_session)
    service.replace_storage_endpoint_tags(
        endpoint,
        [
            {"label": "ceph", "color_key": "slate", "scope": "standard"},
            {"label": "internal", "color_key": "rose", "scope": "administrative"},
        ],
    )
    service.replace_account_tags(
        account,
        [
            {"label": "finance", "color_key": "emerald", "scope": "standard"},
            {"label": "billing", "color_key": "amber", "scope": "administrative"},
        ],
    )
    db_session.commit()

    app.dependency_overrides[dependencies.get_current_account_user] = lambda: user
    response = client.get("/api/me/execution-contexts", params={"workspace": "manager"})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload) == 1
    assert [(item["label"], item["scope"]) for item in payload[0]["tags"]] == [("finance", "standard")]
    assert [(item["label"], item["scope"]) for item in payload[0]["endpoint_tags"]] == [("ceph", "standard")]


def test_ceph_admin_endpoint_selector_hides_administrative_tags(client: TestClient, db_session):
    admin = User(
        id=7201,
        email="ceph-admin@example.test",
        full_name="ceph-admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )
    db_session.add(admin)
    db_session.commit()
    endpoint = _endpoint(db_session, name="ceph-selector-endpoint")
    service = TagsService(db_session)
    service.replace_storage_endpoint_tags(
        endpoint,
        [
            {"label": "rgw-a", "color_key": "violet", "scope": "standard"},
            {"label": "ops-note", "color_key": "orange", "scope": "administrative"},
        ],
    )
    db_session.commit()

    app.dependency_overrides[dependencies.get_current_ceph_admin] = lambda: admin
    app.dependency_overrides[dependencies.require_ceph_admin_enabled] = lambda: None
    response = client.get("/api/ceph-admin/endpoints")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload) == 1
    assert [(item["label"], item["scope"]) for item in payload[0]["tags"]] == [("rgw-a", "standard")]
