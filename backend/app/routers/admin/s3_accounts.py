# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account as S3AccountDb, User
from app.models.app_settings import PortalSettingsOverride
from app.models.portal import PortalAccountSettings
from app.models.s3_account import (
    PaginatedS3AccountsResponse,
    S3Account,
    S3AccountCreate,
    S3AccountImport,
    S3AccountSummary,
    S3AccountUpdate,
)
from app.routers.dependencies import (
    get_audit_logger,
    get_current_super_admin,
    get_optional_super_admin_rgw_client,
    get_super_admin_rgw_client,
)
from app.services.s3_accounts_service import S3AccountsService, get_s3_accounts_service
from app.services.portal_service import get_portal_service
from app.services.audit_service import AuditService
from app.services.rgw_admin import RGWAdminError

router = APIRouter(prefix="/admin/accounts", tags=["admin-accounts"])
logger = logging.getLogger(__name__)


def get_admin_accounts_service(
    db: Session = Depends(get_db),
    rgw_admin_client=Depends(get_super_admin_rgw_client),
) -> S3AccountsService:
    return get_s3_accounts_service(db, rgw_admin_client=rgw_admin_client)

def get_admin_accounts_listing_service(
    db: Session = Depends(get_db),
    rgw_admin_client=Depends(get_optional_super_admin_rgw_client),
) -> S3AccountsService:
    return get_s3_accounts_service(db, rgw_admin_client=rgw_admin_client, allow_missing_admin=True)


def get_admin_accounts_import_service(
    db: Session = Depends(get_db),
    rgw_admin_client=Depends(get_optional_super_admin_rgw_client),
) -> S3AccountsService:
    return get_s3_accounts_service(db, rgw_admin_client=rgw_admin_client, allow_missing_admin=True)


@router.get("", response_model=PaginatedS3AccountsResponse)
def list_accounts(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: Optional[str] = Query(None),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    include_quota: bool = Query(False, description="Include RGW quota information (slower)."),
    include_rgw_details: bool = Query(False, description="Include RGW user and topic details (slower)."),
    service: S3AccountsService = Depends(get_admin_accounts_listing_service),
    _: dict = Depends(get_current_super_admin),
) -> PaginatedS3AccountsResponse:
    accounts = service.list_accounts(
        include_usage_stats=False,
        include_quota=include_quota,
        include_rgw_details=include_rgw_details,
    )
    search_value = search.strip().lower() if isinstance(search, str) else ""
    if search_value:
        filtered = [
            acc
            for acc in accounts
            if search_value in (acc.name or "").lower()
            or search_value in (acc.rgw_account_id or acc.rgw_user_uid or acc.id or "").lower()
        ]
    else:
        filtered = accounts
    sort_map = {
        "name": lambda acc: (acc.name or "").lower(),
        "rgw_account_id": lambda acc: (acc.rgw_account_id or acc.id or "").lower(),
    }
    key_fn = sort_map.get(sort_by, sort_map["name"])
    filtered.sort(key=key_fn, reverse=sort_dir == "desc")
    total = len(filtered)
    start = max(page - 1, 0) * page_size
    end = start + page_size
    items = filtered[start:end]
    has_next = end < total
    return PaginatedS3AccountsResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=has_next,
    )


@router.get("/minimal", response_model=list[S3AccountSummary])
def list_accounts_minimal(
    service: S3AccountsService = Depends(get_admin_accounts_listing_service),
    _: dict = Depends(get_current_super_admin),
) -> list[S3AccountSummary]:
    return service.list_accounts_minimal()


@router.get("/{account_id}", response_model=S3Account)
def get_account(
    account_id: int,
    include_usage: bool = Query(
        False,
        description="Include RGW usage stats (slower, triggers bucket listing).",
    ),
    service: S3AccountsService = Depends(get_admin_accounts_service),
    _: dict = Depends(get_current_super_admin),
) -> S3Account:
    try:
        return service.get_account_detail(account_id, include_usage=include_usage)
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.get("/{account_id}/portal-settings", response_model=PortalAccountSettings, response_model_exclude_unset=True)
def get_account_portal_settings(
    account_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_super_admin),
) -> PortalAccountSettings:
    account = db.query(S3AccountDb).filter(S3AccountDb.id == account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Account not found")
    service = get_portal_service(db)
    return service.get_portal_account_settings(account)


@router.put("/{account_id}/portal-settings", response_model=PortalAccountSettings, response_model_exclude_unset=True)
def update_account_portal_settings(
    account_id: int,
    payload: PortalSettingsOverride,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_super_admin),
) -> PortalAccountSettings:
    account = db.query(S3AccountDb).filter(S3AccountDb.id == account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Account not found")
    service = get_portal_service(db)
    return service.update_admin_portal_settings_override(account, payload)

@router.post("", response_model=S3Account, status_code=status.HTTP_201_CREATED)
def create_account(
    payload: S3AccountCreate,
    service: S3AccountsService = Depends(get_admin_accounts_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> S3Account:
    try:
        logger.debug("Creating account %s", payload.name)
        created = service.create_account_with_manager(payload)
        db_account_id = int(created.db_id) if created.db_id is not None else None
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="create_account",
            entity_type="account",
            entity_id=created.id,
            account_id=db_account_id,
            account_name=created.name,
            metadata={
                "quota_max_size_gb": created.quota_max_size_gb,
                "quota_max_objects": created.quota_max_objects,
            },
        )
        return created
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/import", response_model=list[S3Account])
def import_accounts(
    payload: list[S3AccountImport],
    service: S3AccountsService = Depends(get_admin_accounts_import_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> list[S3Account]:
    try:
        logger.debug("Importing %d accounts", len(payload))
        imported = service.import_accounts(payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="import_accounts",
            entity_type="account",
            entity_id=None,
            metadata={"count": len(imported)},
        )
        return imported
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.put("/{account_id}", response_model=S3Account)
def update_account(
    account_id: int,
    payload: S3AccountUpdate,
    service: S3AccountsService = Depends(get_admin_accounts_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> S3Account:
    try:
        logger.debug("Updating account %s", account_id)
        updated = service.update_account(account_id, payload)
        db_account_id = int(updated.db_id) if updated.db_id is not None else account_id
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="update_account",
            entity_type="account",
            entity_id=str(account_id),
            account_id=db_account_id,
            account_name=updated.name,
            metadata=payload.model_dump(exclude_none=True),
        )
        return updated
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    account_id: int,
    delete_rgw: bool = Query(False, description="Also delete the RGW tenant backing this account"),
    service: S3AccountsService = Depends(get_admin_accounts_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    try:
        logger.debug("Deleting account %s", account_id)
        service.delete_account(account_id, delete_rgw=delete_rgw)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="delete_account",
            entity_type="account",
            entity_id=str(account_id),
            account_id=account_id,
            metadata={"delete_rgw": delete_rgw},
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{account_id}/unlink", status_code=status.HTTP_204_NO_CONTENT)
def unlink_account(
    account_id: int,
    service: S3AccountsService = Depends(get_admin_accounts_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    try:
        logger.debug("Unlinking account %s", account_id)
        service.unlink_account(account_id)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="unlink_account",
            entity_type="account",
            entity_id=str(account_id),
            account_id=account_id,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc
