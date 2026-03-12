# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import AccountIAMUser, AccountRole, S3Connection, User, UserS3Account
from app.models.session import ManagerSessionPrincipal
from app.routers.dependencies import get_account_context, get_current_actor
from app.services.app_settings_service import load_app_settings
from app.services.connection_identity_service import ConnectionIdentityService
from app.utils.rgw import has_supervision_credentials, resolve_admin_uid

router = APIRouter(prefix="/manager", tags=["manager-context"])


class ManagerContext(BaseModel):
    access_mode: str
    context_kind: str = "account"
    iam_identity: Optional[str] = None
    can_switch_access: bool = False
    manager_stats_enabled: bool = False
    manager_stats_message: Optional[str] = None
    manager_browser_enabled: bool = True


def _manager_stats_state(account, actor) -> tuple[bool, Optional[str], Optional[str]]:
    connection_id = getattr(account, "s3_connection_id", None)
    if connection_id is not None:
        caps = getattr(account, "_manager_capabilities", None)
        if not caps or not caps.can_manage_buckets:
            return False, "Metrics are not available for this connection.", None
        source_connection = getattr(account, "_source_connection", None)
        if source_connection is None:
            return False, "Metrics are unavailable: connection context is incomplete.", None
        resolution = ConnectionIdentityService().resolve_metrics_identity(source_connection)
        if not resolution.eligible:
            return False, (resolution.reason or "Metrics are unavailable for this connection."), None
        if not has_supervision_credentials(account):
            return False, "Supervision credentials are not configured for this endpoint.", resolution.iam_identity
        if isinstance(actor, ManagerSessionPrincipal) and not actor.capabilities.can_view_traffic:
            return False, "Metrics are not available for this profile.", resolution.iam_identity
        settings = load_app_settings()
        if isinstance(actor, User) and not settings.manager.allow_manager_user_usage_stats:
            return False, "Metrics are not available for this profile.", resolution.iam_identity
        return True, None, resolution.iam_identity

    if not has_supervision_credentials(account):
        return False, None, None
    if getattr(account, "s3_user_id", None) is not None and not getattr(account, "rgw_user_uid", None):
        return False, None, None
    caps = getattr(account, "_manager_capabilities", None)
    if not caps or not caps.can_manage_buckets:
        return False, None, None
    if isinstance(actor, ManagerSessionPrincipal):
        return bool(actor.capabilities.can_view_traffic), None, None
    if isinstance(actor, User):
        if getattr(caps, "using_root_key", False):
            return True, None, None
        settings = load_app_settings()
        return bool(settings.manager.allow_manager_user_usage_stats), None, None
    return False, None, None


@router.get("/context", response_model=ManagerContext)
def get_manager_context(
    account=Depends(get_account_context),
    actor=Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> ManagerContext:
    s3_user_id = getattr(account, "s3_user_id", None)
    s3_connection_id = getattr(account, "s3_connection_id", None)
    caps = getattr(account, "_manager_capabilities", None)
    manager_stats_enabled, manager_stats_message, connection_iam_identity = _manager_stats_state(account, actor)
    access_mode = "portal"
    if isinstance(actor, ManagerSessionPrincipal):
        access_mode = "session"
    elif s3_connection_id is not None:
        access_mode = "connection"
    elif s3_user_id is not None:
        access_mode = "s3_user"
    elif caps and getattr(caps, "using_root_key", False):
        access_mode = "admin"

    iam_identity: Optional[str] = None
    can_switch_access = False
    manager_browser_enabled = True
    if s3_connection_id is not None:
        connection = (
            db.query(S3Connection.id, S3Connection.access_browser)
            .filter(S3Connection.id == s3_connection_id)
            .first()
        )
        manager_browser_enabled = bool(connection.access_browser) if connection else False
    if access_mode == "admin":
        iam_identity = resolve_admin_uid(getattr(account, "rgw_account_id", None), getattr(account, "rgw_user_uid", None))
    elif access_mode == "portal" and isinstance(actor, User):
        if hasattr(account, "id") and getattr(account, "id") and getattr(account, "id") > 0:
            link = (
                db.query(AccountIAMUser)
                .filter(AccountIAMUser.user_id == actor.id, AccountIAMUser.account_id == getattr(account, "id"))
                .first()
            )
            if link:
                iam_identity = link.iam_username or link.iam_user_id
    elif access_mode == "session":
        iam_identity = actor.user_uid or actor.account_id or actor.account_name
    elif access_mode == "s3_user":
        iam_identity = getattr(account, "rgw_user_uid", None)
    elif access_mode == "connection":
        iam_identity = connection_iam_identity

    if isinstance(actor, User) and access_mode in {"admin", "portal"}:
        account_id = getattr(account, "id", None)
        if account_id and account_id > 0:
            membership = (
                db.query(UserS3Account)
                .filter(UserS3Account.user_id == actor.id, UserS3Account.account_id == account_id)
                .first()
            )
            if membership:
                role = membership.account_role or AccountRole.PORTAL_USER.value
                allow_portal_manager_workspace = bool(load_app_settings().general.allow_portal_manager_workspace)
                can_switch_access = bool(
                    allow_portal_manager_workspace and membership.account_admin and role != AccountRole.PORTAL_NONE.value
                )

    return ManagerContext(
        access_mode=access_mode,
        context_kind=("connection" if access_mode == "connection" else "account"),
        iam_identity=iam_identity,
        can_switch_access=can_switch_access,
        manager_stats_enabled=manager_stats_enabled,
        manager_stats_message=manager_stats_message,
        manager_browser_enabled=manager_browser_enabled,
    )
