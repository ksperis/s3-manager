# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace

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
    UserS3Account,
    UserUiGroup,
)
from app.models.project import ProjectProvisionAccountsRequest
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
    legacy = _seed_account(db_session, name="legacy", endpoint=endpoint)
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
            UserS3Account(user_id=user.id, account_id=legacy.id, account_role=AccountRole.PORTAL_MANAGER.value),
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


class _FakeAccountsService:
    def __init__(self, db_session) -> None:
        self.db_session = db_session
        self.created_endpoint_ids: list[int] = []

    def create_account_with_manager(self, payload):  # noqa: ANN001
        self.created_endpoint_ids.append(payload.storage_endpoint_id)
        account = S3Account(
            name=payload.name,
            rgw_account_id=f"rgw-{payload.name}",
            rgw_access_key=f"AK-{payload.name}",
            rgw_secret_key="SECRET",
            storage_endpoint_id=payload.storage_endpoint_id,
        )
        self.db_session.add(account)
        self.db_session.flush()
        return SimpleNamespace(db_id=account.id, id=str(account.id))

    def get_account_quota(self, _account):  # noqa: ANN001
        return None, None


def test_project_account_provisioning_deduplicates_zonegroup_endpoints(db_session):
    first = _seed_endpoint(db_session, name="endpoint-a1", zonegroup="zg-a")
    duplicate = _seed_endpoint(db_session, name="endpoint-a2", zonegroup="zg-a")
    second = _seed_endpoint(db_session, name="endpoint-b1", zonegroup="zg-b")
    project = Project(name="Research Data", description=None)
    db_session.add(project)
    db_session.commit()

    fake_accounts = _FakeAccountsService(db_session)
    service = ProjectsService(db_session, accounts_service=fake_accounts)

    result = service.provision_accounts_for_project(
        project.id,
        ProjectProvisionAccountsRequest(endpoint_ids=[first.id, duplicate.id, second.id]),
    )

    assert fake_accounts.created_endpoint_ids == [first.id, second.id]
    assert result.reused_endpoint_ids == [duplicate.id]
    assert len(result.created_account_ids) == 2
    assert [link.display_name for link in result.project.account_links] == ["zg-a", "zg-b"]
    assert [link.storage_endpoint_id for link in result.project.account_links] == [first.id, second.id]
