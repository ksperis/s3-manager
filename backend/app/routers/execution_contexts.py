# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, S3Connection, S3User, User, is_admin_ui_role
from app.models.execution_context import (
    ExecutionContext,
    WorkspaceAccess,
    WorkspaceAvailability,
)
from app.routers.dependencies import get_current_account_user
from app.services import app_settings_service
from app.services.effective_access_service import EffectiveAccessService
from app.services.mappers.execution_context import (
    account_execution_context_from_db,
    connection_execution_context_from_db,
    portal_account_execution_context_from_db,
    s3_user_execution_context_from_db,
)
from app.services.tags_service import TagsService

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/execution-contexts", response_model=list[ExecutionContext])
def list_execution_contexts(
    workspace: Optional[str] = Query(default=None, pattern="^(manager|browser)$"),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> list[ExecutionContext]:
    tags_service = TagsService(db)
    access_service = EffectiveAccessService(db)
    effective = access_service.resolve_user(user)
    links = effective.account_links
    account_ids = {link.account_id for link in links}
    accounts = (
        db.query(S3Account).filter(S3Account.id.in_(account_ids)).all()
        if account_ids
        else []
    )

    s3_ids = set(effective.s3_user_ids)
    s3_users = (
        db.query(S3User).filter(S3User.id.in_(s3_ids)).all()
        if s3_ids
        else []
    )

    connection_workspace = workspace or "manager"
    connections = access_service.list_workspace_connections(
        user,
        workspace=connection_workspace,
        resolved=effective,
    )

    results: list[ExecutionContext] = []
    account_by_id = {account.id: account for account in accounts}
    if workspace == "manager":
        for link in links:
            if not access_service.manager_account_allowed(link.role):
                continue
            account = account_by_id.get(link.account_id)
            if account is not None:
                results.append(
                    account_execution_context_from_db(
                        account,
                        tags_service=tags_service,
                        role=link.role,
                        manager_account_is_admin=True,
                    )
                )
    elif workspace is None:
        for account in accounts:
            results.append(
                account_execution_context_from_db(
                    account,
                    tags_service=tags_service,
                )
            )
    elif workspace == "browser":
        for account, link in access_service.list_browser_portal_accounts(
            user,
            resolved=effective,
        ):
            portal_role = link.portal_role
            if portal_role is None:  # pragma: no cover - filtered by the service
                continue
            results.append(
                portal_account_execution_context_from_db(
                    account,
                    tags_service=tags_service,
                    role=portal_role,
                    manager_account_is_admin=access_service.manager_account_allowed(link.role),
                )
            )
    if workspace in {None, "manager"}:
        for s3_user in s3_users:
            results.append(
                s3_user_execution_context_from_db(
                    s3_user,
                    tags_service=tags_service,
                )
            )

    for connection in connections:
        if workspace == "manager" and not bool(connection.access_manager):
            continue
        if workspace == "browser" and not bool(connection.access_browser):
            continue
        results.append(
            connection_execution_context_from_db(
                connection,
                tags_service=tags_service,
            )
        )
    return results


@router.get("/workspace-access", response_model=WorkspaceAccess)
def get_workspace_access(
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> WorkspaceAccess:
    settings = app_settings_service.load_app_settings().general
    service = EffectiveAccessService(db)
    effective = service.resolve_user(user)
    manager_count = sum(
        1 for link in effective.account_links if service.manager_account_allowed(link.role)
    ) + len(effective.s3_user_ids) + len(
        service.list_workspace_connections(user, workspace="manager", resolved=effective)
    )
    browser_count = len(
        service.list_workspace_connections(user, workspace="browser", resolved=effective)
    ) + len(service.list_browser_portal_accounts(user, resolved=effective))
    portal_count = len(service.list_portal_accounts(user, resolved=effective))
    admin_available = is_admin_ui_role(user.role)
    ceph_admin_available = bool(settings.ceph_admin_enabled and effective.can_access_ceph_admin)
    storage_ops_available = bool(
        settings.storage_ops_enabled and effective.can_access_storage_ops and manager_count
    )
    manager_available = bool(settings.manager_enabled and manager_count)
    browser_available = bool(settings.browser_enabled and settings.browser_root_enabled and browser_count)
    portal_available = bool(settings.portal_enabled and portal_count)
    if admin_available:
        default_workspace = "admin"
    elif manager_available:
        default_workspace = "manager"
    elif storage_ops_available:
        default_workspace = "storage-ops"
    elif portal_available:
        default_workspace = "portal"
    elif browser_available:
        default_workspace = "browser"
    elif ceph_admin_available:
        default_workspace = "ceph-admin"
    else:
        default_workspace = None
    return WorkspaceAccess(
        admin=WorkspaceAvailability(available=admin_available, context_count=1 if admin_available else 0),
        ceph_admin=WorkspaceAvailability(
            available=ceph_admin_available,
            context_count=1 if ceph_admin_available else 0,
        ),
        storage_ops=WorkspaceAvailability(
            available=storage_ops_available,
            context_count=manager_count if storage_ops_available else 0,
        ),
        manager=WorkspaceAvailability(available=manager_available, context_count=manager_count),
        browser=WorkspaceAvailability(available=browser_available, context_count=browser_count),
        portal=WorkspaceAvailability(available=portal_available, context_count=portal_count),
        default_workspace=default_workspace,
    )
