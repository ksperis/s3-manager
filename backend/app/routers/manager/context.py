# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.db_models import User
from app.models.session import ManagerSessionPrincipal
from app.routers.dependencies import get_account_context, get_current_actor
from app.services.app_settings_service import load_app_settings
from app.utils.rgw import has_supervision_credentials, resolve_admin_uid

router = APIRouter(prefix="/manager", tags=["manager-context"])


class ManagerContext(BaseModel):
    access_mode: str
    iam_identity: Optional[str] = None
    can_switch_access: bool = False
    manager_stats_enabled: bool = False


def _manager_stats_enabled(account, actor) -> bool:
    if not has_supervision_credentials(account):
        return False
    if getattr(account, "s3_user_id", None) is not None:
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
) -> ManagerContext:
    s3_user_id = getattr(account, "s3_user_id", None)
    caps = getattr(account, "_manager_capabilities", None)
    access_mode = "admin"
    if isinstance(actor, ManagerSessionPrincipal):
        access_mode = "session"
    elif s3_user_id is not None or (hasattr(account, "id") and getattr(account, "id") < 0):
        access_mode = "s3_user"

    iam_identity: Optional[str] = None
    if access_mode == "admin":
        iam_identity = resolve_admin_uid(getattr(account, "rgw_account_id", None), getattr(account, "rgw_user_uid", None))
    elif access_mode == "session":
        iam_identity = actor.user_uid or actor.account_id or actor.account_name
    elif access_mode == "s3_user":
        iam_identity = getattr(account, "rgw_user_uid", None)

    return ManagerContext(
        access_mode=access_mode,
        iam_identity=iam_identity,
        can_switch_access=False,
        manager_stats_enabled=_manager_stats_enabled(account, actor),
    )
