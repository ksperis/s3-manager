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
from app.utils.rgw import has_supervision_credentials, resolve_admin_uid

router = APIRouter(prefix="/manager", tags=["manager-context"])


class ManagerContext(BaseModel):
    access_mode: str
    context_kind: str = "account"
    iam_identity: Optional[str] = None
    can_switch_access: bool = False
    manager_stats_enabled: bool = False
    manager_browser_enabled: bool = True


def _manager_stats_enabled(account, actor) -> bool:
    if not has_supervision_credentials(account):
        return False
    if getattr(account, "s3_user_id", None) is not None and not getattr(account, "rgw_user_uid", None):
        return False
    caps = getattr(account, "_manager_capabilities", None)
    if not caps or not caps.can_manage_buckets:
        return False
    if isinstance(actor, ManagerSessionPrincipal):
        return bool(actor.capabilities.can_view_traffic)
    if isinstance(actor, User):
        if getattr(caps, "using_root_key", False):
            return True
        settings = load_app_settings()
        return bool(settings.manager.allow_manager_user_usage_stats)
    return False


@router.get("/context", response_model=ManagerContext)
def get_manager_context(
    account=Depends(get_account_context),
    actor=Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> ManagerContext:
    s3_user_id = getattr(account, "s3_user_id", None)
    s3_connection_id = getattr(account, "s3_connection_id", None)
    caps = getattr(account, "_manager_capabilities", None)
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
        # For external platforms we generally do not have an IAM identity to show,
        # so we expose the access key id as a stable identifier.
        iam_identity = getattr(account, "rgw_access_key", None)

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
        manager_stats_enabled=_manager_stats_enabled(account, actor),
        manager_browser_enabled=manager_browser_enabled,
    )
