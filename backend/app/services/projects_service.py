# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.db import (
    AccountRole,
    Project,
    ProjectS3Account,
    S3Account,
    StorageEndpoint,
    UiGroup,
    UiGroupProject,
    User,
    UserProject,
    UserUiGroup,
)
from app.models.project import (
    PaginatedProjectsResponse,
    PortalProject,
    PortalProjectAccount,
    Project as ProjectOut,
    ProjectAccountLink,
    ProjectAccountLinkInput,
    ProjectCreate,
    ProjectGroupLink,
    ProjectGroupLinkInput,
    ProjectProvisionAccountsRequest,
    ProjectProvisionAccountsResponse,
    ProjectSummary,
    ProjectUpdate,
    ProjectUserLink,
    ProjectUserLinkInput,
    validate_project_role,
)
from app.models.app_settings import PortalSettingsOverride
from app.models.s3_account import S3AccountCreate
from app.routers.dependencies_internal.types import AccountAccess, AccountCapabilities
from app.services.effective_access_service import EffectiveAccountLink
from app.services.s3_accounts_service import S3AccountsService
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.time import utcnow


_PORTAL_ROLE_RANK = {
    AccountRole.PORTAL_USER.value: 1,
    AccountRole.PORTAL_MANAGER.value: 2,
}
_PORTAL_ROLE_BY_RANK = {
    1: AccountRole.PORTAL_USER.value,
    2: AccountRole.PORTAL_MANAGER.value,
}


@dataclass(frozen=True)
class PortalProjectAccess:
    project: Project
    actor: User
    role: str
    account_links: list[ProjectS3Account]

    @property
    def account_ids(self) -> set[int]:
        return {link.account_id for link in self.account_links}


class ProjectsService:
    def __init__(self, db: Session, accounts_service: Optional[S3AccountsService] = None) -> None:
        self.db = db
        self.accounts_service = accounts_service

    def paginate_projects(
        self,
        *,
        page: int,
        page_size: int,
        search: Optional[str] = None,
        sort_field: str = "name",
        sort_direction: str = "asc",
    ) -> PaginatedProjectsResponse:
        query = self.db.query(Project)
        search_value = search.strip() if isinstance(search, str) else ""
        if search_value:
            pattern = f"%{search_value}%"
            query = (
                query.outerjoin(ProjectS3Account, ProjectS3Account.project_id == Project.id)
                .outerjoin(S3Account, ProjectS3Account.account_id == S3Account.id)
                .outerjoin(UserProject, UserProject.project_id == Project.id)
                .outerjoin(User, UserProject.user_id == User.id)
                .filter(
                    or_(
                        Project.name.ilike(pattern),
                        func.coalesce(Project.description, "").ilike(pattern),
                        func.coalesce(S3Account.name, "").ilike(pattern),
                        func.coalesce(S3Account.rgw_account_id, "").ilike(pattern),
                        func.coalesce(ProjectS3Account.display_name, "").ilike(pattern),
                        func.coalesce(User.email, "").ilike(pattern),
                    )
                )
                .distinct()
            )
        sort_map = {
            "name": Project.name,
            "created_at": Project.created_at,
            "updated_at": Project.updated_at,
        }
        order_column = sort_map.get(sort_field, Project.name)
        if sort_direction == "desc":
            order_column = order_column.desc()
        total = query.with_entities(func.count(func.distinct(Project.id))).scalar() or 0
        rows = query.order_by(order_column).offset(max(page - 1, 0) * page_size).limit(page_size).all()
        items = [self.project_to_out(project) for project in rows]
        return PaginatedProjectsResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            has_next=page * page_size < total,
        )

    def list_project_summaries(self) -> list[ProjectSummary]:
        rows = self.db.query(Project).order_by(func.lower(Project.name).asc(), Project.name.asc(), Project.id.asc()).all()
        return [self.project_to_summary(project) for project in rows]

    def get_project(self, project_id: int) -> Project:
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError("Project not found")
        return project

    def create_project(self, payload: ProjectCreate) -> ProjectOut:
        if self._project_name_exists(payload.name):
            raise ValueError("Project already exists")
        project = Project(name=payload.name, description=payload.description)
        self.db.add(project)
        self.db.flush()
        self._replace_account_links(project, payload.account_links)
        self._replace_user_links(project, payload.user_links)
        self._replace_group_links(project, payload.group_links)
        self.db.commit()
        self.db.refresh(project)
        return self.project_to_out(project)

    def update_project(self, project_id: int, payload: ProjectUpdate) -> ProjectOut:
        project = self.get_project(project_id)
        if "name" in payload.model_fields_set and payload.name is not None and payload.name != project.name:
            if self._project_name_exists(payload.name, exclude_project_id=project.id):
                raise ValueError("Project already exists")
            project.name = payload.name
        if "description" in payload.model_fields_set:
            project.description = payload.description
        if payload.account_links is not None:
            self._replace_account_links(project, payload.account_links)
        if payload.user_links is not None:
            self._replace_user_links(project, payload.user_links)
        if payload.group_links is not None:
            self._replace_group_links(project, payload.group_links)
        project.updated_at = utcnow()
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)
        return self.project_to_out(project)

    def delete_project(self, project_id: int) -> None:
        project = self.get_project(project_id)
        self.db.delete(project)
        self.db.commit()

    def provision_accounts_for_project(
        self,
        project_id: int,
        payload: ProjectProvisionAccountsRequest,
    ) -> ProjectProvisionAccountsResponse:
        project = self.get_project(project_id)
        if self.accounts_service is None:
            raise ValueError("Account provisioning is unavailable")
        endpoints = (
            self.db.query(StorageEndpoint)
            .filter(StorageEndpoint.id.in_(sorted({int(endpoint_id) for endpoint_id in payload.endpoint_ids})))
            .all()
        )
        found_ids = {endpoint.id for endpoint in endpoints}
        missing_ids = sorted(set(payload.endpoint_ids) - found_ids)
        if missing_ids:
            raise ValueError(f"Storage endpoints not found: {', '.join(str(item) for item in missing_ids)}")
        targets = self._dedupe_endpoints_by_zonegroup(endpoints)
        created_account_ids: list[int] = []
        reused_endpoint_ids = sorted(set(payload.endpoint_ids) - {endpoint.id for endpoint in targets})
        for endpoint in targets:
            name = self._unique_account_name(
                self._normalized_account_name(payload.base_name or project.name, endpoint)
            )
            created = self.accounts_service.create_account_with_manager(
                S3AccountCreate(
                    name=name,
                    email=payload.email,
                    storage_endpoint_id=endpoint.id,
                )
            )
            account_id = int(created.db_id or created.id)
            created_account_ids.append(account_id)
            label = self._default_project_account_label(endpoint)
            self._upsert_project_account(project, account_id=account_id, display_name=label, sort_order=len(created_account_ids))
        project.updated_at = utcnow()
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)
        return ProjectProvisionAccountsResponse(
            project=self.project_to_out(project),
            created_account_ids=created_account_ids,
            reused_endpoint_ids=reused_endpoint_ids,
        )

    def list_portal_projects_for_user(self, user: User) -> list[PortalProject]:
        role_by_project = self._project_roles_for_user(user)
        if not role_by_project:
            return []
        projects = (
            self.db.query(Project)
            .filter(Project.id.in_(role_by_project.keys()))
            .order_by(func.lower(Project.name).asc(), Project.name.asc(), Project.id.asc())
            .all()
        )
        results: list[PortalProject] = []
        for project in projects:
            accounts = self._portal_accounts_for_project(project)
            if not accounts:
                continue
            results.append(
                PortalProject(
                    id=f"proj-{project.id}",
                    db_id=project.id,
                    name=project.name,
                    description=project.description,
                    account_role=role_by_project[project.id],
                    accounts=accounts,
                )
            )
        return results

    def resolve_portal_project_access(self, user: User, project_id: int) -> PortalProjectAccess:
        role_by_project = self._project_roles_for_user(user)
        role = role_by_project.get(project_id)
        if role not in {AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value}:
            raise ValueError("Not authorized for this project")
        project = self.get_project(project_id)
        account_links = [
            link
            for link in sorted(project.account_links, key=lambda item: (item.sort_order, item.display_name.lower(), item.id))
            if link.account is not None and self._is_portal_eligible_account(link.account)
        ]
        if not account_links:
            raise ValueError("Project has no portal-eligible S3 accounts")
        return PortalProjectAccess(project=project, actor=user, role=role, account_links=account_links)

    def account_access_for_project(
        self,
        access: PortalProjectAccess,
        account_id: int,
    ) -> AccountAccess:
        link = next((item for item in access.account_links if item.account_id == account_id), None)
        if link is None or link.account is None:
            raise ValueError("S3Account is not associated with this project")
        return AccountAccess(
            account=link.account,
            actor=access.actor,
            membership=EffectiveAccountLink(
                account_id=link.account_id,
                account_admin=False,
                is_root=False,
            ),
            capabilities=self._portal_capabilities(access.role),
            role=access.role,
            portal_settings_override=self._project_portal_settings_override(access.project),
        )

    def _project_portal_settings_override(self, project: Project) -> PortalSettingsOverride:
        raw = project.portal_settings_override
        if not raw:
            return PortalSettingsOverride()
        try:
            payload = json.loads(raw)
        except (TypeError, ValueError):
            return PortalSettingsOverride()
        if not isinstance(payload, dict):
            return PortalSettingsOverride()
        admin_payload = payload.get("admin")
        if not isinstance(admin_payload, dict):
            return PortalSettingsOverride()
        try:
            return PortalSettingsOverride.model_validate(admin_payload)
        except Exception:
            return PortalSettingsOverride()

    def project_to_summary(self, project: Project) -> ProjectSummary:
        return ProjectSummary(
            id=project.id,
            name=project.name,
            description=project.description,
            account_count=len(project.account_links or []),
            user_count=len(project.user_links or []),
            group_count=len(project.group_links or []),
        )

    def project_to_out(self, project: Project) -> ProjectOut:
        account_links = [
            self._account_link_to_model(link)
            for link in sorted(project.account_links or [], key=lambda item: (item.sort_order, item.display_name.lower(), item.id))
            if link.account is not None
        ]
        user_links = [
            ProjectUserLink(user_id=link.user_id, user_email=link.user.email, account_role=link.account_role)
            for link in sorted(project.user_links or [], key=lambda item: (item.user.email.lower(), item.user_id))
            if link.user is not None
        ]
        group_links = [
            ProjectGroupLink(group_id=link.group_id, group_name=link.group.name, account_role=link.account_role)
            for link in sorted(project.group_links or [], key=lambda item: (item.group.name.lower(), item.group_id))
            if link.group is not None
        ]
        return ProjectOut(
            id=project.id,
            name=project.name,
            description=project.description,
            account_links=account_links,
            user_links=user_links,
            group_links=group_links,
            account_count=len(account_links),
            user_count=len(user_links),
            group_count=len(group_links),
            created_at=project.created_at,
            updated_at=project.updated_at,
        )

    def _project_name_exists(self, name: str, exclude_project_id: Optional[int] = None) -> bool:
        query = self.db.query(Project).filter(func.lower(Project.name) == name.lower())
        if exclude_project_id is not None:
            query = query.filter(Project.id != exclude_project_id)
        return self.db.query(query.exists()).scalar()

    def _replace_account_links(self, project: Project, links: list[ProjectAccountLinkInput]) -> None:
        cleaned: dict[int, ProjectAccountLinkInput] = {}
        for link in links:
            cleaned[int(link.account_id)] = link
        if cleaned:
            found_ids = {
                row[0]
                for row in self.db.query(S3Account.id).filter(S3Account.id.in_(cleaned.keys())).all()
            }
            missing = sorted(set(cleaned) - found_ids)
            if missing:
                raise ValueError(f"S3 accounts not found: {', '.join(str(item) for item in missing)}")
        self.db.query(ProjectS3Account).filter(ProjectS3Account.project_id == project.id).delete(synchronize_session=False)
        for account_id, link in cleaned.items():
            self._upsert_project_account(
                project,
                account_id=account_id,
                display_name=link.display_name,
                sort_order=link.sort_order,
            )

    def _replace_user_links(self, project: Project, links: list[ProjectUserLinkInput]) -> None:
        cleaned: dict[int, str] = {}
        for link in links:
            cleaned[int(link.user_id)] = validate_project_role(link.account_role)
        if cleaned:
            found_ids = {row[0] for row in self.db.query(User.id).filter(User.id.in_(cleaned.keys())).all()}
            missing = sorted(set(cleaned) - found_ids)
            if missing:
                raise ValueError(f"Users not found: {', '.join(str(item) for item in missing)}")
        self.db.query(UserProject).filter(UserProject.project_id == project.id).delete(synchronize_session=False)
        for user_id, role in cleaned.items():
            self.db.add(UserProject(project_id=project.id, user_id=user_id, account_role=role))

    def _replace_group_links(self, project: Project, links: list[ProjectGroupLinkInput]) -> None:
        cleaned: dict[int, str] = {}
        for link in links:
            cleaned[int(link.group_id)] = validate_project_role(link.account_role)
        if cleaned:
            found_ids = {row[0] for row in self.db.query(UiGroup.id).filter(UiGroup.id.in_(cleaned.keys())).all()}
            missing = sorted(set(cleaned) - found_ids)
            if missing:
                raise ValueError(f"UI groups not found: {', '.join(str(item) for item in missing)}")
        self.db.query(UiGroupProject).filter(UiGroupProject.project_id == project.id).delete(synchronize_session=False)
        for group_id, role in cleaned.items():
            self.db.add(UiGroupProject(project_id=project.id, group_id=group_id, account_role=role))

    def _upsert_project_account(
        self,
        project: Project,
        *,
        account_id: int,
        display_name: Optional[str],
        sort_order: int,
    ) -> ProjectS3Account:
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise ValueError("S3Account not found")
        label = display_name or self._default_project_account_label(account.storage_endpoint) or account.name
        link = (
            self.db.query(ProjectS3Account)
            .filter(ProjectS3Account.project_id == project.id, ProjectS3Account.account_id == account_id)
            .first()
        )
        if link is None:
            link = ProjectS3Account(project_id=project.id, account_id=account_id)
        link.display_name = label
        link.sort_order = sort_order
        link.updated_at = utcnow()
        self.db.add(link)
        return link

    def _account_link_to_model(self, link: ProjectS3Account) -> ProjectAccountLink:
        account = link.account
        endpoint = account.storage_endpoint if account else None
        return ProjectAccountLink(
            account_id=link.account_id,
            account_name=account.name,
            display_name=link.display_name,
            sort_order=link.sort_order,
            rgw_account_id=account.rgw_account_id,
            storage_endpoint_id=endpoint.id if endpoint else None,
            storage_endpoint_name=endpoint.name if endpoint else None,
            storage_endpoint_url=endpoint.endpoint_url if endpoint else None,
            storage_endpoint_zonegroup=endpoint.ceph_zonegroup_name if endpoint else None,
        )

    def _project_roles_for_user(self, user: User) -> dict[int, str]:
        role_by_project: dict[int, str] = {}

        def merge(project_id: int, role: Optional[str]) -> None:
            if role not in _PORTAL_ROLE_RANK:
                return
            current_rank = _PORTAL_ROLE_RANK.get(role_by_project.get(project_id), 0)
            next_rank = max(current_rank, _PORTAL_ROLE_RANK.get(role or "", 0))
            role_by_project[project_id] = _PORTAL_ROLE_BY_RANK[next_rank]

        direct_rows = (
            self.db.query(UserProject.project_id, UserProject.account_role)
            .filter(UserProject.user_id == user.id)
            .all()
        )
        for project_id, role in direct_rows:
            merge(project_id, role)

        group_ids = [
            row[0]
            for row in self.db.query(UserUiGroup.group_id).filter(UserUiGroup.user_id == user.id).all()
        ]
        if group_ids:
            group_rows = (
                self.db.query(UiGroupProject.project_id, UiGroupProject.account_role)
                .filter(UiGroupProject.group_id.in_(group_ids))
                .all()
            )
            for project_id, role in group_rows:
                merge(project_id, role)

        return role_by_project

    def _portal_accounts_for_project(self, project: Project) -> list[PortalProjectAccount]:
        accounts: list[PortalProjectAccount] = []
        account_service = self.accounts_service
        for link in sorted(project.account_links or [], key=lambda item: (item.sort_order, item.display_name.lower(), item.id)):
            account = link.account
            if account is None or not self._is_portal_eligible_account(account):
                continue
            endpoint = account.storage_endpoint
            quota_max_size_gb = quota_max_objects = None
            if account_service is not None:
                quota_max_size_gb, quota_max_objects = account_service.get_account_quota(account)
            accounts.append(
                PortalProjectAccount(
                    account_id=account.id,
                    account_name=account.name,
                    display_name=link.display_name,
                    rgw_account_id=account.rgw_account_id,
                    storage_endpoint_id=endpoint.id if endpoint else None,
                    storage_endpoint_name=endpoint.name if endpoint else None,
                    storage_endpoint_url=endpoint.endpoint_url if endpoint else None,
                    storage_endpoint_zonegroup=endpoint.ceph_zonegroup_name if endpoint else None,
                    quota_max_size_gb=quota_max_size_gb,
                    quota_max_objects=quota_max_objects,
                )
            )
        return accounts

    def _is_portal_eligible_account(self, account: S3Account) -> bool:
        endpoint = getattr(account, "storage_endpoint", None)
        if not account.rgw_account_id or endpoint is None or str(endpoint.provider) != "ceph":
            return False
        return bool(resolve_feature_flags(endpoint).iam_enabled)

    def _portal_capabilities(self, role: str) -> AccountCapabilities:
        can_manage = role == AccountRole.PORTAL_MANAGER.value
        return AccountCapabilities(
            can_manage_buckets=can_manage,
            can_manage_portal_users=can_manage,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        )

    def _dedupe_endpoints_by_zonegroup(self, endpoints: list[StorageEndpoint]) -> list[StorageEndpoint]:
        selected: dict[str, StorageEndpoint] = {}
        for endpoint in sorted(endpoints, key=lambda item: (item.ceph_zonegroup_name or item.name or "", item.id)):
            zonegroup = (endpoint.ceph_zonegroup_name or "").strip().lower()
            key = f"zg:{zonegroup}" if zonegroup else f"ep:{endpoint.id}"
            selected.setdefault(key, endpoint)
        return list(selected.values())

    def _normalized_account_name(self, project_name: str, endpoint: StorageEndpoint) -> str:
        base = self._slug(project_name)
        suffix = self._slug(endpoint.ceph_zonegroup_name or endpoint.name)
        value = f"{base}-{suffix}" if suffix and suffix not in base else base
        return value[:80].strip("-") or f"project-{endpoint.id}"

    def _unique_account_name(self, base_name: str) -> str:
        candidate = base_name
        counter = 2
        while self.db.query(S3Account).filter(func.lower(S3Account.name) == candidate.lower()).first():
            suffix = f"-{counter}"
            candidate = f"{base_name[: 80 - len(suffix)].strip('-')}{suffix}"
            counter += 1
        return candidate

    def _default_project_account_label(self, endpoint: Optional[StorageEndpoint]) -> str:
        if endpoint is None:
            return "Default"
        return endpoint.ceph_zonegroup_name or endpoint.name or f"Endpoint {endpoint.id}"

    @staticmethod
    def _slug(value: str) -> str:
        slug = re.sub(r"[^a-z0-9-]+", "-", (value or "").strip().lower())
        slug = re.sub(r"-+", "-", slug).strip("-")
        return slug or "project"


def get_projects_service(db: Session, accounts_service: Optional[S3AccountsService] = None) -> ProjectsService:
    return ProjectsService(db, accounts_service=accounts_service)
