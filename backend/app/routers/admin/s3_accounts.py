# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account as S3AccountDb, User
from app.models.app_settings import PortalSettingsAdminUpdate, PortalSettingsOverride
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
    get_audit_service,
    get_current_super_admin,
)
from app.services.s3_accounts_service import S3AccountsService, get_s3_accounts_service
from app.services.audit_service import AuditService
from app.services.portal_service import get_portal_service
from app.services.rgw_admin import RGWAdminError
from app.services.tags_service import serialize_tag_summaries
from app.core.sensitive_data import sanitize_error_detail
from app.utils.http_errors import raise_http_exception_from_exception

router = APIRouter(prefix="/admin/accounts", tags=["admin-accounts"])
logger = logging.getLogger(__name__)


def _account_stable_id(account: S3Account) -> int:
    if account.db_id is not None:
        return int(account.db_id)
    try:
        return int(account.id)
    except (TypeError, ValueError):
        return 0


def _account_name_key(account: S3Account) -> tuple[str, str, int]:
    name = account.name or ""
    return (name.lower(), name, _account_stable_id(account))


def _account_rgw_key(account: S3Account) -> tuple[str, int]:
    value = account.rgw_account_id or account.id or ""
    return (str(value).lower(), _account_stable_id(account))


def get_admin_accounts_service(
    db: Session = Depends(get_db),
) -> S3AccountsService:
    return get_s3_accounts_service(db)


@router.get("", response_model=PaginatedS3AccountsResponse)
def list_accounts(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: Optional[str] = Query(None),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    include_quota: bool = Query(False, description="Include RGW quota information (slower)."),
    include_rgw_details: bool = Query(False, description="Include RGW user and topic details (slower)."),
    service: S3AccountsService = Depends(get_admin_accounts_service),
    _: User = Depends(get_current_super_admin),
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
            or any(search_value in (tag.label or "").lower() for tag in (acc.tags or []))
            or any(
                search_value in (link.user_email or "").lower()
                or search_value in (link.user_full_name or "").lower()
                for link in (acc.user_links or [])
            )
            or any(search_value in (link.group_name or "").lower() for link in (acc.group_links or []))
        ]
    else:
        filtered = accounts
    requested_sort = sort_by if sort_by in {"name", "rgw_account_id"} else "name"
    descending = sort_dir.lower() == "desc"
    if requested_sort == "name":
        filtered.sort(key=_account_name_key, reverse=descending)
    else:
        filtered.sort(key=_account_rgw_key, reverse=descending)
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
    service: S3AccountsService = Depends(get_admin_accounts_service),
    _: User = Depends(get_current_super_admin),
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
    _: User = Depends(get_current_super_admin),
) -> S3Account:
    try:
        return service.get_account_detail(account_id, include_usage=include_usage)
    except ValueError as exc:
        detail = sanitize_error_detail(str(exc))
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.get("/{account_id}/portal-settings", response_model=PortalAccountSettings, response_model_exclude_unset=True)
def get_account_portal_settings(
    account_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_super_admin),
) -> PortalAccountSettings:
    account = db.query(S3AccountDb).filter(S3AccountDb.id == account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Account not found")
    service = get_portal_service(db)
    return service.get_portal_account_settings(account)


@router.put("/{account_id}/portal-settings", response_model=PortalAccountSettings, response_model_exclude_unset=True)
def update_account_portal_settings(
    account_id: int,
    payload: PortalSettingsAdminUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> PortalAccountSettings:
    account = db.query(S3AccountDb).filter(S3AccountDb.id == account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Account not found")
    service = get_portal_service(db)
    override_fields = payload.model_fields_set - {"delegated_to_portal_managers"}
    if not override_fields and "delegated_to_portal_managers" in payload.model_fields_set:
        override = service.get_portal_account_settings(account).admin_override
    else:
        override = PortalSettingsOverride.model_validate(
            payload.model_dump(
                exclude={"delegated_to_portal_managers"},
                exclude_unset=True,
                exclude_none=False,
            )
        )
    try:
        updated = service.update_admin_portal_settings_override(
            account,
            override,
            delegated_to_portal_managers=payload.delegated_to_portal_managers,
        )
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    audit_service.record_action(
        user=current_user,
        scope="admin",
        action="update_account_portal_settings",
        entity_type="account",
        entity_id=str(account_id),
        account_id=account_id,
        account_name=account.name,
        metadata={
            "admin_override": override.model_dump(exclude_unset=True, exclude_none=False),
            "delegated_to_portal_managers": updated.delegated_to_portal_managers,
        },
    )
    return updated


@router.post("", response_model=S3Account, status_code=status.HTTP_201_CREATED)
def create_account(
    payload: S3AccountCreate,
    service: S3AccountsService = Depends(get_admin_accounts_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
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
                "tags": serialize_tag_summaries(created.tags),
            },
        )
        return created
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc


@router.post("/import", response_model=list[S3Account])
def import_accounts(
    payload: list[S3AccountImport],
    service: S3AccountsService = Depends(get_admin_accounts_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc


@router.put("/{account_id}", response_model=S3Account)
def update_account(
    account_id: int,
    payload: S3AccountUpdate,
    service: S3AccountsService = Depends(get_admin_accounts_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
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
        detail = sanitize_error_detail(str(exc))
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    account_id: int,
    delete_rgw: bool = Query(False, description="Also delete the RGW tenant backing this account"),
    service: S3AccountsService = Depends(get_admin_accounts_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
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
            metadata={"delete_rgw": delete_rgw, "account_id": account_id},
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=sanitize_error_detail(str(exc))) from exc


@router.post("/{account_id}/unlink", status_code=status.HTTP_204_NO_CONTENT)
def unlink_account(
    account_id: int,
    service: S3AccountsService = Depends(get_admin_accounts_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
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
            metadata={"account_id": account_id},
        )
    except ValueError as exc:
        detail = sanitize_error_detail(str(exc))
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc
