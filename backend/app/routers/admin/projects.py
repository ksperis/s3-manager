# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.project import (
    PaginatedProjectsResponse,
    Project,
    ProjectCreate,
    ProjectProvisionAccountsRequest,
    ProjectProvisionAccountsResponse,
    ProjectSummary,
    ProjectUpdate,
)
from app.routers.dependencies import get_audit_logger, get_current_super_admin, get_optional_super_admin_rgw_client
from app.routers.http_errors import sanitize_error_detail
from app.services.audit_service import AuditService
from app.services.projects_service import ProjectsService, get_projects_service
from app.services.s3_accounts_service import get_s3_accounts_service

router = APIRouter(prefix="/admin/projects", tags=["admin-projects"])


def get_admin_projects_service(
    db: Session = Depends(get_db),
) -> ProjectsService:
    return get_projects_service(db)


def get_admin_projects_provisioning_service(
    db: Session = Depends(get_db),
    rgw_admin_client=Depends(get_optional_super_admin_rgw_client),
) -> ProjectsService:
    accounts_service = get_s3_accounts_service(db, rgw_admin_client=rgw_admin_client, allow_missing_admin=True)
    return get_projects_service(db, accounts_service=accounts_service)


@router.get("", response_model=PaginatedProjectsResponse)
def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: Optional[str] = Query(None),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    service: ProjectsService = Depends(get_admin_projects_service),
    _: User = Depends(get_current_super_admin),
) -> PaginatedProjectsResponse:
    return service.paginate_projects(
        page=page,
        page_size=page_size,
        search=search,
        sort_field=sort_by,
        sort_direction=sort_dir,
    )


@router.get("/minimal", response_model=list[ProjectSummary])
def list_projects_minimal(
    service: ProjectsService = Depends(get_admin_projects_service),
    _: User = Depends(get_current_super_admin),
) -> list[ProjectSummary]:
    return service.list_project_summaries()


@router.get("/{project_id}", response_model=Project)
def get_project(
    project_id: int,
    service: ProjectsService = Depends(get_admin_projects_service),
    _: User = Depends(get_current_super_admin),
) -> Project:
    try:
        return service.project_to_out(service.get_project(project_id))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=sanitize_error_detail(str(exc))) from exc


@router.post("", response_model=Project, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    service: ProjectsService = Depends(get_admin_projects_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> Project:
    try:
        created = service.create_project(payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="create_project",
            entity_type="project",
            entity_id=str(created.id),
            metadata={
                "name": created.name,
                "account_ids": [link.account_id for link in created.account_links],
                "user_ids": [link.user_id for link in created.user_links],
                "group_ids": [link.group_id for link in created.group_links],
            },
        )
        return created
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc


@router.put("/{project_id}", response_model=Project)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    service: ProjectsService = Depends(get_admin_projects_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> Project:
    try:
        updated = service.update_project(project_id, payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="update_project",
            entity_type="project",
            entity_id=str(project_id),
            metadata=payload.model_dump(exclude_unset=True, exclude_none=True),
        )
        return updated
    except ValueError as exc:
        detail = sanitize_error_detail(str(exc))
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.post("/{project_id}/provision-accounts", response_model=ProjectProvisionAccountsResponse)
def provision_project_accounts(
    project_id: int,
    payload: ProjectProvisionAccountsRequest,
    service: ProjectsService = Depends(get_admin_projects_provisioning_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ProjectProvisionAccountsResponse:
    try:
        result = service.provision_accounts_for_project(project_id, payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="provision_project_accounts",
            entity_type="project",
            entity_id=str(project_id),
            metadata={
                "endpoint_ids": payload.endpoint_ids,
                "created_account_ids": result.created_account_ids,
                "reused_endpoint_ids": result.reused_endpoint_ids,
            },
        )
        return result
    except ValueError as exc:
        detail = sanitize_error_detail(str(exc))
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: int,
    service: ProjectsService = Depends(get_admin_projects_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    try:
        service.delete_project(project_id)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="delete_project",
            entity_type="project",
            entity_id=str(project_id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=sanitize_error_detail(str(exc))) from exc
