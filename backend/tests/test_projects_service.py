# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

from app.db import (
    AccountRole,
    Project,
    ProjectS3Account,
    S3Account,
    StorageEndpoint,
    StorageProvider,
    UiGroup,
    UiGroupProject,
    User,
    UserProject,
    UserRole,
    UserUiGroup,
)
from app.services.effective_access_service import EffectiveAccessService
from app.services.projects_service import ProjectsService


def _seed_endpoint(db_session, *, name: str, zonegroup: str | None = None) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider=StorageProvider.CEPH.value,
        ceph_zonegroup_name=zonegroup,
        features_config=(
            "features:\n"
            "  account:\n"
            "    enabled: true\n"
            "  iam:\n"
            "    enabled: true\n"
        ),
        is_default=False,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.flush()
    return endpoint


def _seed_account(db_session, *, name: str, endpoint: StorageEndpoint) -> S3Account:
    account = S3Account(
        name=name,
        rgw_account_id=f"rgw-{name}",
        rgw_access_key=f"AK-{name}",
        rgw_secret_key="SECRET",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.flush()
    return account


def _seed_user(db_session, email: str) -> User:
    user = User(email=email, hashed_password="x", role=UserRole.UI_USER.value, is_active=True)
    db_session.add(user)
    db_session.flush()
    return user


def test_portal_projects_use_project_links_and_group_role_precedence(db_session):
    endpoint = _seed_endpoint(db_session, name="paris", zonegroup="zg-fr")
    primary = _seed_account(db_session, name="primary", endpoint=endpoint)
    replica = _seed_account(db_session, name="replica", endpoint=endpoint)
    user = _seed_user(db_session, "project-user@example.test")
    group = UiGroup(name="project-managers")
    project = Project(name="Genome", description="Sequencing")
    db_session.add_all([group, project])
    db_session.flush()
    db_session.add_all(
        [
            ProjectS3Account(project_id=project.id, account_id=primary.id, display_name="Paris", sort_order=0),
            ProjectS3Account(project_id=project.id, account_id=replica.id, display_name="Rennes", sort_order=1),
            UserProject(user_id=user.id, project_id=project.id, account_role=AccountRole.PORTAL_USER.value),
            UserUiGroup(user_id=user.id, group_id=group.id),
            UiGroupProject(group_id=group.id, project_id=project.id, account_role=AccountRole.PORTAL_MANAGER.value),
        ]
    )
    db_session.commit()

    service = ProjectsService(db_session)

    projects = service.list_portal_projects_for_user(user)

    assert len(projects) == 1
    portal_project = projects[0]
    assert portal_project.id == f"proj-{project.id}"
    assert portal_project.account_role == AccountRole.PORTAL_MANAGER.value
    assert [account.display_name for account in portal_project.accounts] == ["Paris", "Rennes"]
    assert [account.account_name for account in portal_project.accounts] == ["primary", "replica"]

    access = service.resolve_portal_project_access(user, project.id)
    account_access = service.account_access_for_project(access, primary.id)
    assert account_access.role == AccountRole.PORTAL_MANAGER.value
    assert account_access.account.id == primary.id


def test_same_account_project_access_uses_project_specific_portal_settings_override(db_session):
    endpoint = _seed_endpoint(db_session, name="shared", zonegroup="zg-shared")
    account = _seed_account(db_session, name="shared-account", endpoint=endpoint)
    user = _seed_user(db_session, "project-specific-settings@example.test")
    first = Project(
        name="First project",
        description=None,
        portal_settings_override=json.dumps({"admin": {"allow_portal_user_bucket_create": False}}),
    )
    second = Project(
        name="Second project",
        description=None,
        portal_settings_override=json.dumps({"admin": {"allow_portal_user_bucket_create": True}}),
    )
    db_session.add_all([first, second])
    db_session.flush()
    db_session.add_all(
        [
            ProjectS3Account(project_id=first.id, account_id=account.id, display_name="First", sort_order=0),
            ProjectS3Account(project_id=second.id, account_id=account.id, display_name="Second", sort_order=0),
            UserProject(user_id=user.id, project_id=first.id, account_role=AccountRole.PORTAL_USER.value),
            UserProject(user_id=user.id, project_id=second.id, account_role=AccountRole.PORTAL_USER.value),
        ]
    )
    db_session.commit()

    service = ProjectsService(db_session)

    first_access = service.account_access_for_project(
        service.resolve_portal_project_access(user, first.id),
        account.id,
    )
    second_access = service.account_access_for_project(
        service.resolve_portal_project_access(user, second.id),
        account.id,
    )

    assert first_access.account.id == second_access.account.id == account.id
    assert first_access.portal_settings_override.allow_portal_user_bucket_create is False
    assert second_access.portal_settings_override.allow_portal_user_bucket_create is True


def test_effective_access_exposes_project_links_for_workspace_guard(db_session):
    user = _seed_user(db_session, "project-session@example.test")
    group = UiGroup(name="project-session-managers")
    project = Project(name="Portal Workspace", description=None)
    db_session.add_all([group, project])
    db_session.flush()
    db_session.add_all(
        [
            UserProject(user_id=user.id, project_id=project.id, account_role=AccountRole.PORTAL_USER.value),
            UserUiGroup(user_id=user.id, group_id=group.id),
            UiGroupProject(group_id=group.id, project_id=project.id, account_role=AccountRole.PORTAL_MANAGER.value),
        ]
    )
    db_session.commit()

    effective_access = EffectiveAccessService(db_session).to_user_effective_access(user)

    assert effective_access.account_links == []
    assert len(effective_access.portal_projects) == 1
    assert effective_access.portal_projects[0].id == project.id
    assert effective_access.portal_projects[0].name == "Portal Workspace"
    assert effective_access.portal_projects[0].account_role == AccountRole.PORTAL_MANAGER.value
