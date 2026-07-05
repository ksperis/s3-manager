# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json

from app.db import Project
from app.main import app
from app.routers.admin import projects as admin_projects_router


class _CapturingAuditService:
    def __init__(self) -> None:
        self.actions: list[dict] = []

    def record_action(self, **kwargs):  # noqa: ANN003
        self.actions.append(kwargs)


def _seed_project(db_session, *, overrides: dict | None = None) -> Project:
    project = Project(
        name="portal-admin-project",
        description="Portal project settings test",
        portal_settings_override=json.dumps(overrides) if overrides else None,
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)
    return project


def test_admin_get_project_portal_settings_returns_project_overrides(client, db_session):
    project = _seed_project(
        db_session,
        overrides={
            "admin": {"allow_portal_user_bucket_create": False},
            "portal_manager": {"allow_portal_user_access_key_create": True},
        },
    )

    response = client.get(f"/api/admin/projects/{project.id}/portal-settings")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["admin_override"]["allow_portal_user_bucket_create"] is False
    assert body["effective"]["allow_portal_user_bucket_create"] is False
    assert "portal_manager_override" not in body
    assert "override_policy" not in body


def test_admin_put_project_portal_settings_replaces_legacy_portal_manager_override_and_audits(client, db_session):
    audit = _CapturingAuditService()
    app.dependency_overrides[admin_projects_router.get_audit_logger] = lambda: audit
    project = _seed_project(
        db_session,
        overrides={
            "portal_manager": {
                "allow_portal_user_access_key_create": True,
                "bucket_defaults": {"enable_cors": True},
            },
        },
    )

    response = client.put(
        f"/api/admin/projects/{project.id}/portal-settings",
        json={
            "allow_portal_user_bucket_create": False,
            "bucket_defaults": {"versioning": True},
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["admin_override"]["allow_portal_user_bucket_create"] is False
    assert body["admin_override"]["bucket_defaults"]["versioning"] is True
    assert "portal_manager_override" not in body
    assert "override_policy" not in body

    db_session.refresh(project)
    stored = json.loads(project.portal_settings_override)
    assert stored["admin"]["allow_portal_user_bucket_create"] is False
    assert "portal_manager" not in stored

    assert len(audit.actions) == 1
    assert audit.actions[0]["action"] == "update_project_portal_settings"
    assert audit.actions[0]["scope"] == "admin"
    assert audit.actions[0]["entity_type"] == "project"
    assert audit.actions[0]["entity_id"] == str(project.id)
    assert audit.actions[0]["metadata"]["admin_override"]["bucket_defaults"]["versioning"] is True


def test_admin_put_project_portal_settings_resets_with_empty_payload(client, db_session):
    project = _seed_project(
        db_session,
        overrides={"admin": {"allow_portal_user_bucket_create": False}},
    )

    response = client.put(f"/api/admin/projects/{project.id}/portal-settings", json={})

    assert response.status_code == 200, response.text
    assert response.json()["admin_override"] == {}
    db_session.refresh(project)
    assert project.portal_settings_override is None


def test_admin_project_portal_settings_returns_404_for_unknown_project(client):
    response = client.get("/api/admin/projects/999999/portal-settings")

    assert response.status_code == 404
