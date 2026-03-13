# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.db import AccountIAMUser, AccountRole, S3Account, User, UserS3Account, is_admin_ui_role
from app.models.bucket import Bucket, BucketCreate
from app.models.app_settings import PortalSettingsOverride, PortalSettings
from app.models.portal import (
    PortalAccessKey,
    PortalAccessKeyStatusChange,
    PortalAccountSettings,
    PortalEligibility,
    PortalIamComplianceReport,
    PortalState,
    PortalUsage,
    PortalUserCard,
)
from app.models.healthcheck import WorkspaceEndpointHealthOverviewResponse
from app.models.s3_account import S3Account as S3AccountSchema
from app.routers.dependencies import (
    AccountAccess,
    get_audit_logger,
    get_current_account_user,
    get_portal_account_access,
    require_portal_manager,
)
from app.routers.http_errors import raise_bad_gateway_from_runtime
from app.services.audit_service import AuditService
from app.services.portal_service import PortalService, get_portal_service
from app.services.s3_accounts_service import get_s3_accounts_service
from app.services.s3_client import BucketNotEmptyError
from app.services.healthcheck_service import HealthCheckService
from app.utils.storage_endpoint_features import (
    features_to_capabilities,
    normalize_features_config,
    resolve_feature_flags,
)
from app.services.rgw_iam import get_iam_service
from app.utils.s3_endpoint import resolve_s3_client_options, resolve_s3_endpoint
from app.services.traffic_service import TrafficService, TrafficWindow, WINDOW_RESOLUTION_LABELS, WINDOW_DELTAS
from app.services.rgw_admin import RGWAdminError
from app.services.users_service import UsersService, get_users_service
from app.db import UserRole
from pydantic import BaseModel
from app.services.billing_service import BillingService
from app.services.app_settings_service import load_app_settings
from app.models.billing import BillingSubjectDetail
router = APIRouter(prefix="/portal", tags=["portal"])
logger = logging.getLogger(__name__)
settings = get_settings()


@router.get("/accounts", response_model=list[S3AccountSchema])
def list_portal_accounts(
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> list[S3AccountSchema]:
    quota_service = get_s3_accounts_service(db, allow_missing_admin=True)
    links = (
        db.query(UserS3Account)
        .filter(
            UserS3Account.user_id == user.id,
            UserS3Account.account_role.in_([AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value]),
        )
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
        endpoint = acc.storage_endpoint
        # Only show accounts eligible for portal workflows.
        if not acc.rgw_account_id:
            continue
        if endpoint and not resolve_feature_flags(endpoint).iam_enabled:
            continue
        root_link = None
        if is_admin_ui_role(user.role):
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
        quota_max_size_gb, quota_max_objects = quota_service.get_account_quota(acc)
        results.append(
            S3AccountSchema(
                id=str(acc.id),
                name=acc.name,
                rgw_account_id=acc.rgw_account_id,
                quota_max_size_gb=quota_max_size_gb,
                quota_max_objects=quota_max_objects,
                root_user_email=root_link[0] if root_link else None,
                root_user_id=root_link[1] if root_link else None,
                storage_endpoint_id=endpoint.id if endpoint else None,
                storage_endpoint_name=endpoint.name if endpoint else None,
                storage_endpoint_url=endpoint.endpoint_url if endpoint else None,
                storage_endpoint_capabilities=(
                    features_to_capabilities(normalize_features_config(endpoint.provider, endpoint.features_config))
                    if endpoint
                    else None
                ),
            )
        )
    return results


@router.get("/eligibility", response_model=PortalEligibility)
def portal_eligibility(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalEligibility:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    eligible, reasons = service.check_eligibility(actor, access)
    return PortalEligibility(eligible=eligible, reasons=reasons)


@router.post("/bootstrap", response_model=PortalState)
def portal_bootstrap(
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalState:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    eligible, reasons = service.check_eligibility(actor, access)
    if not eligible:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="; ".join(reasons) or "Portal not available")
    try:
        state = service.bootstrap_portal_identity(actor, access)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="bootstrap_portal_identity",
            entity_type="iam_user",
            entity_id=str(access.account.id),
            account=access.account,
            metadata={
                "iam_username": state.iam_user.iam_username,
                "just_created": bool(state.just_created),
                "iam_provisioned": bool(state.iam_provisioned),
            },
        )
        return state
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/state", response_model=PortalState)
def portal_state(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalState:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    eligible, reasons = service.check_eligibility(actor, access)
    if not eligible:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="; ".join(reasons) or "Portal not available")
    try:
        return service.get_state(actor, access)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/usage", response_model=PortalUsage)
def portal_usage(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalUsage:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    endpoint = getattr(access.account, "storage_endpoint", None)
    if endpoint and not resolve_feature_flags(endpoint).metrics_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage metrics are disabled for this endpoint")
    try:
        return service.get_usage(actor, access)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/endpoint-health", response_model=WorkspaceEndpointHealthOverviewResponse)
def portal_endpoint_health(
    access: AccountAccess = Depends(get_portal_account_access),
    db: Session = Depends(get_db),
) -> WorkspaceEndpointHealthOverviewResponse:
    app_settings = load_app_settings()
    if not app_settings.general.endpoint_status_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Endpoint Status feature is disabled.")
    account = access.account
    endpoint_id = getattr(account, "storage_endpoint_id", None)
    if endpoint_id is None:
        return WorkspaceEndpointHealthOverviewResponse(
            generated_at=utcnow().isoformat(),
            incident_highlight_minutes=max(1, int(settings.healthcheck_incident_recent_minutes or 720)),
            endpoint_count=0,
            up_count=0,
            degraded_count=0,
            down_count=0,
            unknown_count=0,
            endpoints=[],
            incidents=[],
        )
    service = HealthCheckService(db)
    return WorkspaceEndpointHealthOverviewResponse(
        **service.build_workspace_health_overview(endpoint_id=int(endpoint_id))
    )


@router.get("/billing/me", response_model=BillingSubjectDetail)
def portal_billing_me(
    month: str = Query(..., description="YYYY-MM"),
    access: AccountAccess = Depends(get_portal_account_access),
    db: Session = Depends(get_db),
) -> BillingSubjectDetail:
    app_settings = load_app_settings()
    if not app_settings.general.billing_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Billing is disabled")
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    account = access.account
    if account.storage_endpoint_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Storage endpoint is not configured")
    service = BillingService(db)
    try:
        return service.subject_detail(month, account.storage_endpoint_id, "account", account.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/buckets", response_model=list[Bucket])
def portal_buckets(
    search: Optional[str] = Query(None, description="Filter buckets by name"),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[Bucket]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        buckets = service.get_state(actor, access).buckets
        if search:
            term = search.strip().lower()
            if term:
                buckets = [bucket for bucket in buckets if term in bucket.name.lower()]
        return buckets
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/users", response_model=list[PortalUserCard])
def list_portal_bucket_users(
    bucket_name: str,
    access: AccountAccess = Depends(require_portal_manager),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalUserCard]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    roles = [UserRole.UI_USER.value, UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value]
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
    results: list[PortalUserCard] = []
    try:
        for user_obj, account_role, iam_username in rows:
            role_value = account_role or AccountRole.PORTAL_NONE.value
            if role_value not in {AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value}:
                continue
            buckets = service.list_existing_user_bucket_access(user_obj, access.account, role_value)
            if bucket_name not in buckets:
                continue
            results.append(
                PortalUserCard(
                    id=user_obj.id,
                    email=user_obj.email,
                    role=role_value,
                    iam_username=iam_username,
                    iam_only=False,
                )
            )
        return results
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


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
    portal_settings = service.get_effective_portal_settings(access.account)
    allow_portal_user_create = portal_settings.allow_portal_user_bucket_create
    is_manager = access.capabilities.can_manage_buckets
    is_portal_user = access.role == AccountRole.PORTAL_USER.value
    if not (is_manager or (allow_portal_user_create and is_portal_user)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket creation not allowed for this role.")
    try:
        versioning = payload.versioning if payload.versioning is not None else portal_settings.bucket_defaults.versioning
        defaults_applied = bool(is_manager or (allow_portal_user_create and is_portal_user))
        bucket = service.create_bucket(
            actor,
            access,
            payload.name,
            versioning=versioning,
            portal_settings=portal_settings,
        )
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="create_bucket",
            entity_type="bucket",
            entity_id=payload.name,
            account=access.account,
            metadata={
                "versioning": bool(versioning and defaults_applied),
                "lifecycle": bool(portal_settings.bucket_defaults.enable_lifecycle and defaults_applied),
                "cors": bool(portal_settings.bucket_defaults.enable_cors and defaults_applied),
                "defaults_applied": defaults_applied,
            },
        )
        return bucket
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.delete("/buckets/{bucket_name}")
def delete_portal_bucket(
    bucket_name: str,
    force: bool = Query(False, description="Set to true to delete all objects before deleting the bucket"),
    access: AccountAccess = Depends(require_portal_manager),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
):
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        service.delete_bucket(actor, access, bucket_name, force=force)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="delete_bucket",
            entity_type="bucket",
            entity_id=bucket_name,
            account=access.account,
            metadata={"force": force},
        )
        return {"message": f"Bucket '{bucket_name}' deleted"}
    except BucketNotEmptyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


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
        raise_bad_gateway_from_runtime(exc)


@router.post("/access-keys", response_model=PortalAccessKey, status_code=status.HTTP_201_CREATED)
def create_portal_access_key(
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalAccessKey:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    portal_settings = service.get_effective_portal_settings(access.account)
    if access.role == AccountRole.PORTAL_USER.value and not portal_settings.allow_portal_user_access_key_create:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access key management not allowed for this role.")
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
        raise_bad_gateway_from_runtime(exc)


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
        raise_bad_gateway_from_runtime(exc)


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
        raise_bad_gateway_from_runtime(exc)


@router.delete("/access-keys/{access_key_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_portal_access_key(
    access_key_id: str,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> None:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    portal_settings = service.get_effective_portal_settings(access.account)
    if access.role == AccountRole.PORTAL_USER.value and not portal_settings.allow_portal_user_access_key_create:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access key management not allowed for this role.")
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
        raise_bad_gateway_from_runtime(exc)


@router.get("/traffic")
def portal_traffic(
    window: TrafficWindow = Query(TrafficWindow.WEEK),
    bucket: Optional[str] = Query(None),
    access: AccountAccess = Depends(get_portal_account_access),
    portal_service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> dict:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    account = access.account
    endpoint = getattr(account, "storage_endpoint", None)
    if endpoint and not resolve_feature_flags(endpoint).usage_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage logs are disabled for this endpoint")
    if not access.capabilities.can_manage_buckets:
        requested_bucket = (bucket or "").strip()
        if not requested_bucket:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Bucket filter is required for this role.",
            )
        allowed_buckets = set(portal_service.list_existing_user_bucket_access(actor, account, access.role))
        if requested_bucket not in allowed_buckets:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket access not allowed for this role.")
        bucket = requested_bucket
    try:
        traffic_service = TrafficService(account)
    except ValueError as exc:
        raise_bad_gateway_from_runtime(exc)
    try:
        return traffic_service.get_traffic(window=window, bucket=bucket)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RGWAdminError as exc:
        raise HTTPException(status_code=502, detail=f"Unable to fetch traffic logs: {exc}") from exc


@router.get("/settings", response_model=PortalSettings)
def portal_public_settings(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalSettings:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    return service.get_effective_portal_settings(access.account)


@router.get("/account-settings", response_model=PortalAccountSettings, response_model_exclude_unset=True)
def portal_account_settings(
    access: AccountAccess = Depends(require_portal_manager),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalAccountSettings:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    return service.get_portal_account_settings(access.account)


@router.put("/account-settings", response_model=PortalAccountSettings, response_model_exclude_unset=True)
def update_portal_account_settings(
    payload: PortalSettingsOverride,
    access: AccountAccess = Depends(require_portal_manager),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalAccountSettings:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.update_portal_manager_override(access.account, payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.get("/iam-compliance", response_model=PortalIamComplianceReport)
def portal_iam_compliance(
    access: AccountAccess = Depends(require_portal_manager),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalIamComplianceReport:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.check_iam_compliance(access.account)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/iam-compliance/apply", response_model=PortalIamComplianceReport)
def portal_apply_iam_compliance(
    access: AccountAccess = Depends(require_portal_manager),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalIamComplianceReport:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.apply_iam_compliance(access.account)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/users", response_model=list[PortalUserCard])
def list_portal_ui_users(
    access: AccountAccess = Depends(require_portal_manager),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
) -> list[PortalUserCard]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    roles = [UserRole.UI_USER.value, UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value]
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
        role_value = account_role or AccountRole.PORTAL_NONE.value
        results.append(
            PortalUserCard(
                id=user_obj.id,
                email=user_obj.email,
                role=role_value,
                iam_username=iam_username,
                iam_only=False,
            )
        )
    iam_only_cards: list[PortalUserCard] = []
    try:
        access_key, secret_key = access.account.effective_rgw_credentials()
        if access_key and secret_key:
            endpoint, region, _, verify_tls = resolve_s3_client_options(access.account)
            iam_service = get_iam_service(
                access_key,
                secret_key,
                endpoint=endpoint,
                region=region,
                verify_tls=verify_tls,
            )
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
    if is_admin_ui_role(target.role):
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
        raise_bad_gateway_from_runtime(exc)
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
    account_role = link.account_role or AccountRole.PORTAL_NONE.value
    try:
        buckets = service.list_existing_user_bucket_access(target, access.account, account_role)
        return PortalUserBuckets(buckets=buckets)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/users/{user_id}/buckets", response_model=PortalUserBuckets)
def grant_portal_user_bucket(
    user_id: int,
    payload: PortalUserBucketGrant,
    access: AccountAccess = Depends(require_portal_manager),
    audit_service: AuditService = Depends(get_audit_logger),
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
    account_role = link.account_role or AccountRole.PORTAL_NONE.value
    if account_role not in {AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User has no portal role for bucket permissions")
    try:
        buckets = service.grant_bucket_access(target, access.account, account_role, payload.bucket)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="grant_bucket_access",
            entity_type="iam_user",
            entity_id=str(target.id),
            account=access.account,
            metadata={"bucket": payload.bucket},
        )
        return PortalUserBuckets(buckets=buckets)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.delete("/users/{user_id}/buckets/{bucket}", response_model=PortalUserBuckets)
def revoke_portal_user_bucket(
    user_id: int,
    bucket: str,
    access: AccountAccess = Depends(require_portal_manager),
    audit_service: AuditService = Depends(get_audit_logger),
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
    account_role = link.account_role or AccountRole.PORTAL_NONE.value
    if account_role not in {AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User has no portal role for bucket permissions")
    try:
        buckets = service.revoke_bucket_access(target, access.account, account_role, bucket)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="revoke_bucket_access",
            entity_type="iam_user",
            entity_id=str(target.id),
            account=access.account,
            metadata={"bucket": bucket},
        )
        return PortalUserBuckets(buckets=buckets)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


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
    if is_admin_ui_role(target.role):
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
        raise_bad_gateway_from_runtime(exc)
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
    if is_admin_ui_role(target.role):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove this user")
    if actor.id == target.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers cannot remove their own account access")
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
        raise_bad_gateway_from_runtime(exc)
    users_service.db.delete(link)
    users_service.db.commit()
