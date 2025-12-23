# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db_models import AccountIAMUser, AccountRole, S3Account, User, UserS3Account
from app.models.bucket import Bucket, BucketCreate
from app.models.portal import PortalAccessKey, PortalAccessKeyStatusChange, PortalState, PortalUsage, PortalUserCard
from app.models.s3_account import S3Account as S3AccountSchema
from app.routers.dependencies import (
    AccountAccess,
    get_account_access,
    get_audit_logger,
    get_current_account_user,
    get_portal_account_access,
    get_portal_account_context,
    require_portal_buckets,
    require_portal_manager,
)
from app.services.audit_service import AuditService
from app.services.portal_service import PortalService, get_portal_service
from app.services.rgw_iam import get_iam_service
from app.services.traffic_service import TrafficService, TrafficWindow, WINDOW_RESOLUTION_LABELS, WINDOW_DELTAS
from app.services.rgw_admin import RGWAdminError
from app.services.users_service import UsersService, get_users_service
from app.services.app_settings_service import load_app_settings
from app.db_models import UserRole
from pydantic import BaseModel

router = APIRouter(prefix="/portal", tags=["portal"])
logger = logging.getLogger(__name__)


@router.get("/accounts", response_model=list[S3AccountSchema])
def list_portal_accounts(
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> list[S3AccountSchema]:
    links = (
        db.query(UserS3Account)
        .filter(UserS3Account.user_id == user.id)
        .all()
    )
    account_ids = {l.account_id for l in links}
    accounts = (
        db.query(S3Account).filter(S3Account.id.in_(account_ids)).all()
        if account_ids
        else []
    )
    results: list[S3AccountSchema] = []
    for acc in accounts:
        root_link = (
            db.query(UserS3Account)
            .filter(
                UserS3Account.account_id == acc.id,
                UserS3Account.is_root.is_(True),
            )
            .join(User)
            .with_entities(User.email, User.id)
            .first()
        )
        results.append(
            S3AccountSchema(
                id=str(acc.id),
                name=acc.name,
                rgw_account_id=acc.rgw_account_id,
                quota_max_size_gb=acc.quota_max_size_gb,
                quota_max_objects=acc.quota_max_objects,
                root_user_email=root_link[0] if root_link else None,
                root_user_id=root_link[1] if root_link else None,
            )
        )
    return results


@router.get("/state", response_model=PortalState)
def portal_state(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalState:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.get_state(actor, access)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/usage", response_model=PortalUsage)
def portal_usage(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalUsage:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.get_usage(actor, access)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets", response_model=list[Bucket])
def portal_buckets(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[Bucket]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.get_state(actor, access).buckets
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/buckets/{bucket_name}/stats", response_model=Bucket)
def portal_bucket_stats(
    bucket_name: str,
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> Bucket:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.get_bucket_stats(actor, access, bucket_name)
    except RuntimeError as exc:
        detail = str(exc)
        if "autorisé" in detail.lower():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail) from exc
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail) from exc


@router.post("/buckets", response_model=Bucket, status_code=status.HTTP_201_CREATED)
def create_portal_bucket(
    payload: BucketCreate,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> Bucket:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    settings = load_app_settings()
    allow_portal_user_create = settings.portal.allow_portal_user_bucket_create
    is_manager = access.capabilities.can_manage_buckets
    is_portal_user = access.role == AccountRole.PORTAL_USER.value
    if not (is_manager or (allow_portal_user_create and is_portal_user)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket creation not allowed for this role.")
    use_root = bool(allow_portal_user_create and is_portal_user and not is_manager)
    try:
        bucket = service.create_bucket(actor, access, payload.name, payload.versioning, use_root=use_root)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="create_bucket",
            entity_type="bucket",
            entity_id=payload.name,
            account=access.account,
            metadata={"versioning": payload.versioning if hasattr(payload, "versioning") else False},
        )
        return bucket
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/access-keys", response_model=list[PortalAccessKey])
def list_portal_access_keys(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalAccessKey]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.list_access_keys(actor, access)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/access-keys", response_model=PortalAccessKey, status_code=status.HTTP_201_CREATED)
def create_portal_access_key(
    access: AccountAccess = Depends(require_portal_buckets),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalAccessKey:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        key = service.create_access_key(actor, access)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="create_access_key",
            entity_type="iam_user",
            entity_id=str(access.account.id),
            account=access.account,
            metadata={"access_key_id": key.access_key_id},
        )
        return key
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/access-keys/portal/rotate", response_model=PortalAccessKey, status_code=status.HTTP_201_CREATED)
def rotate_portal_access_key(
    access: AccountAccess = Depends(require_portal_manager),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalAccessKey:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        key = service.rotate_portal_key(actor, access)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="rotate_portal_access_key",
            entity_type="iam_user",
            entity_id=str(access.account.id),
            account=access.account,
            metadata={"access_key_id": key.access_key_id},
        )
        return key
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/access-keys/portal", response_model=PortalAccessKey)
def get_active_portal_access_key(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalAccessKey:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.get_portal_access_key(actor, access)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/access-keys/{access_key_id}/status", response_model=PortalAccessKey)
def update_portal_access_key_status(
    access_key_id: str,
    payload: PortalAccessKeyStatusChange,
    access: AccountAccess = Depends(require_portal_manager),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalAccessKey:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        key = service.update_access_key_status(actor, access, access_key_id, payload.active)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="update_access_key_status",
            entity_type="iam_user",
            entity_id=str(access.account.id),
            account=access.account,
            metadata={"access_key_id": access_key_id, "active": payload.active},
        )
        return key
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/access-keys/{access_key_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_portal_access_key(
    access_key_id: str,
    access: AccountAccess = Depends(require_portal_manager),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> None:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        service.delete_access_key(actor, access, access_key_id)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="delete_access_key",
            entity_type="iam_user",
            entity_id=str(access.account.id),
            account=access.account,
            metadata={"access_key_id": access_key_id},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/traffic")
def portal_traffic(
    window: TrafficWindow = Query(TrafficWindow.DAY),
    bucket: Optional[str] = Query(None),
    account: S3Account = Depends(get_portal_account_context),
    access: AccountAccess = Depends(get_portal_account_access),
) -> dict:
    try:
        service = TrafficService(account)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    try:
        return service.get_traffic(window=window, bucket=bucket)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RGWAdminError as exc:
        raise HTTPException(status_code=502, detail=f"Unable to fetch traffic logs: {exc}") from exc


@router.get("/settings", response_model=dict)
def portal_public_settings(_: User = Depends(get_current_account_user)) -> dict:
    return load_app_settings().portal.model_dump()


@router.get("/users", response_model=list[PortalUserCard])
def list_portal_ui_users(
    access: AccountAccess = Depends(get_account_access),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
) -> list[PortalUserCard]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    roles = [UserRole.UI_USER.value, UserRole.UI_ADMIN.value]
    rows = (
        users_service.db.query(User, UserS3Account.account_role, AccountIAMUser.iam_username)  # type: ignore[attr-defined]
        .join(UserS3Account, UserS3Account.user_id == User.id)
        .outerjoin(
            AccountIAMUser,
            (AccountIAMUser.user_id == User.id) & (AccountIAMUser.account_id == access.account.id),
        )
        .filter(UserS3Account.account_id == access.account.id)
        .filter(User.role.in_(roles))
        .all()
    )
    linked_iam_usernames = {
        row.iam_username
        for row in users_service.db.query(AccountIAMUser.iam_username).filter(AccountIAMUser.account_id == access.account.id)
        if row.iam_username
    }
    results: list[PortalUserCard] = []
    for user_obj, account_role, iam_username in rows:
        results.append(
            PortalUserCard(
                id=user_obj.id,
                email=user_obj.email,
                role=account_role or user_obj.role,
                iam_username=iam_username,
                iam_only=False,
            )
        )
    iam_only_cards: list[PortalUserCard] = []
    try:
        access_key, secret_key = access.account.effective_rgw_credentials()
        if access_key and secret_key:
            iam_service = get_iam_service(access_key, secret_key)
            iam_users = iam_service.list_users()
            for iam_user in iam_users:
                name = iam_user.name
                if not name:
                    continue
                if name in linked_iam_usernames:
                    continue
                iam_only_cards.append(
                    PortalUserCard(
                        id=None,
                        email=name,
                        role="iam_only",
                        iam_username=name,
                        iam_only=True,
                    )
                )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Unable to list orphan IAM users for portal account %s: %s", access.account.id, exc)
    return [*results, *iam_only_cards]


class PortalUserCreate(BaseModel):
    email: str


class PortalUserUpdate(BaseModel):
    account_role: AccountRole


class PortalUserBucketGrant(BaseModel):
    bucket: str


class PortalUserBuckets(BaseModel):
    buckets: list[str]


@router.post("/users", response_model=PortalUserCard, status_code=status.HTTP_201_CREATED)
def add_portal_ui_user(
    payload: PortalUserCreate,
    access: AccountAccess = Depends(require_portal_manager),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalUserCard:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    target = users_service.get_by_email(payload.email)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if target.role == UserRole.UI_ADMIN.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot assign this user")
    users_service.assign_user_to_account(
        target.id,
        access.account.id,
        account_root=False,
        account_role=AccountRole.PORTAL_USER.value,
    )
    link = (
        users_service.db.query(UserS3Account)
        .filter(UserS3Account.user_id == target.id, UserS3Account.account_id == access.account.id)
        .first()
    )
    assigned_role = link.account_role if link else target.role
    try:
        service.provision_portal_user(target, access.account, assigned_role)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    refreshed_link = (
        users_service.db.query(AccountIAMUser)
        .filter(AccountIAMUser.user_id == target.id, AccountIAMUser.account_id == access.account.id)
        .first()
    )
    return PortalUserCard(
        id=target.id,
        email=target.email,
        role=assigned_role,
        iam_username=refreshed_link.iam_username if refreshed_link else None,
        iam_only=False,
    )


@router.get("/users/{user_id}/buckets", response_model=PortalUserBuckets)
def list_portal_user_buckets(
    user_id: int,
    access: AccountAccess = Depends(require_portal_manager),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalUserBuckets:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    target = users_service.get_by_id(user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    link = (
        users_service.db.query(UserS3Account)
        .filter(UserS3Account.user_id == target.id, UserS3Account.account_id == access.account.id)
        .first()
    )
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not linked to this account")
    account_role = link.account_role or AccountRole.PORTAL_USER.value
    try:
        buckets = service.list_user_bucket_access(target, access.account, account_role)
        return PortalUserBuckets(buckets=buckets)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/users/{user_id}/buckets", response_model=PortalUserBuckets)
def grant_portal_user_bucket(
    user_id: int,
    payload: PortalUserBucketGrant,
    access: AccountAccess = Depends(require_portal_manager),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalUserBuckets:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    target = users_service.get_by_id(user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    link = (
        users_service.db.query(UserS3Account)
        .filter(UserS3Account.user_id == target.id, UserS3Account.account_id == access.account.id)
        .first()
    )
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not linked to this account")
    account_role = link.account_role or AccountRole.PORTAL_USER.value
    try:
        buckets = service.grant_bucket_access(target, access.account, account_role, payload.bucket)
        return PortalUserBuckets(buckets=buckets)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/users/{user_id}/buckets/{bucket}", response_model=PortalUserBuckets)
def revoke_portal_user_bucket(
    user_id: int,
    bucket: str,
    access: AccountAccess = Depends(require_portal_manager),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalUserBuckets:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    target = users_service.get_by_id(user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    link = (
        users_service.db.query(UserS3Account)
        .filter(UserS3Account.user_id == target.id, UserS3Account.account_id == access.account.id)
        .first()
    )
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not linked to this account")
    account_role = link.account_role or AccountRole.PORTAL_USER.value
    try:
        buckets = service.revoke_bucket_access(target, access.account, account_role, bucket)
        return PortalUserBuckets(buckets=buckets)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/users/{user_id}", response_model=PortalUserCard)
def update_portal_ui_user_role(
    user_id: int,
    payload: PortalUserUpdate,
    access: AccountAccess = Depends(require_portal_manager),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalUserCard:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    target = users_service.get_by_id(user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if target.role == UserRole.UI_ADMIN.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot assign this user")
    if actor.id == target.id and payload.account_role == AccountRole.PORTAL_USER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Managers cannot remove their own manager rights",
        )
    users_service.assign_user_to_account(
        target.id,
        access.account.id,
        account_root=False,
        account_role=payload.account_role.value,
    )
    link = (
        users_service.db.query(UserS3Account)
        .filter(UserS3Account.user_id == target.id, UserS3Account.account_id == access.account.id)
        .first()
    )
    assigned_role = link.account_role if link else target.role
    try:
        service.provision_portal_user(target, access.account, assigned_role)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    refreshed_link = (
        users_service.db.query(AccountIAMUser)
        .filter(AccountIAMUser.user_id == target.id, AccountIAMUser.account_id == access.account.id)
        .first()
    )
    return PortalUserCard(
        id=target.id,
        email=target.email,
        role=assigned_role,
        iam_username=refreshed_link.iam_username if refreshed_link else None,
        iam_only=False,
    )


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_portal_ui_user(
    user_id: int,
    access: AccountAccess = Depends(require_portal_manager),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> None:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    target = users_service.get_by_id(user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    link = (
        users_service.db.query(UserS3Account)
        .filter(UserS3Account.user_id == target.id, UserS3Account.account_id == access.account.id, UserS3Account.is_root.is_(False))
        .first()
    )
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not linked to this account")
    try:
        service.remove_portal_user(target, access.account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    users_service.db.delete(link)
    users_service.db.commit()
