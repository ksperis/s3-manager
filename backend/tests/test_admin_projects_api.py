# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi.testclient import TestClient

from app.db import AccountRole, S3Account, StorageEndpoint, StorageProvider, User, UserRole


def _endpoint(db_session) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="admin-project-endpoint",
        endpoint_url="https://admin-project.example.test",
        provider=StorageProvider.CEPH.value,
        features_config=(
            "features:\n"
            "  iam:\n"
            "    enabled: true\n"
        ),
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def test_admin_projects_crud_manages_account_and_user_links(client: TestClient, db_session):
    endpoint = _endpoint(db_session)
    account = S3Account(
        name="project-api-account",
        rgw_account_id="RGWPROJECTAPI0001",
        rgw_access_key="AK-PROJECT-API",
        rgw_secret_key="SK-PROJECT-API",
        storage_endpoint_id=endpoint.id,
    )
    user = User(
        email="project-api-user@example.test",
        hashed_password="x",
        role=UserRole.UI_USER.value,
        is_active=True,
    )
    db_session.add_all([account, user])
    db_session.commit()
    db_session.refresh(account)
    db_session.refresh(user)

    create_resp = client.post(
        "/api/admin/projects",
        json={
            "name": "Admin Project",
            "description": "Created by API",
            "account_links": [{"account_id": account.id, "display_name": "Paris"}],
            "user_links": [{"user_id": user.id, "account_role": AccountRole.PORTAL_USER.value}],
        },
    )

    assert create_resp.status_code == 201, create_resp.text
    payload = create_resp.json()
    project_id = payload["id"]
    assert payload["account_links"][0]["display_name"] == "Paris"
    assert payload["user_links"][0]["account_role"] == AccountRole.PORTAL_USER.value

    update_resp = client.put(
        f"/api/admin/projects/{project_id}",
        json={
            "description": None,
            "account_links": [{"account_id": account.id, "display_name": "Rennes"}],
            "user_links": [{"user_id": user.id, "account_role": AccountRole.PORTAL_MANAGER.value}],
        },
    )

    assert update_resp.status_code == 200, update_resp.text
    updated = update_resp.json()
    assert updated["description"] is None
    assert updated["account_links"][0]["display_name"] == "Rennes"
    assert updated["user_links"][0]["account_role"] == AccountRole.PORTAL_MANAGER.value

    list_resp = client.get("/api/admin/projects", params={"search": "Rennes"})
    assert list_resp.status_code == 200, list_resp.text
    assert list_resp.json()["total"] == 1
