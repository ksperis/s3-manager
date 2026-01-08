# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db_models import IamIdentity, PortalMembership, S3Account, S3AccountKind, User
from app.models.portal_v2 import PortalAccountListItem, PortalEndpointCapabilities
from app.routers.dependencies import get_current_account_user
from app.utils.storage_endpoint_features import resolve_feature_flags


router = APIRouter()


@router.get("/accounts", response_model=list[PortalAccountListItem])
def list_portal_accounts(
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> list[PortalAccountListItem]:
    memberships = (
        db.query(PortalMembership)
        .join(S3Account, S3Account.id == PortalMembership.account_id)
        .filter(PortalMembership.user_id == user.id, S3Account.kind == S3AccountKind.IAM_ACCOUNT.value)
        .all()
    )
    if not memberships:
        return []
    account_ids = [m.account_id for m in memberships]
    accounts = db.query(S3Account).filter(S3Account.id.in_(account_ids)).all()
    accounts_by_id = {a.id: a for a in accounts}

    identity_rows = (
        db.query(IamIdentity.account_id)
        .filter(IamIdentity.user_id == user.id, IamIdentity.is_enabled.is_(True))
        .all()
    )
    external_enabled_ids = {row[0] for row in identity_rows if row and row[0]}

    results: list[PortalAccountListItem] = []
    for membership in memberships:
        account = accounts_by_id.get(membership.account_id)
        if not account:
            continue
        endpoint = getattr(account, "storage_endpoint", None)
        flags = resolve_feature_flags(endpoint) if endpoint else None
        sts_enabled = bool(flags.sts_enabled) if flags else False
        presign_enabled = bool(getattr(endpoint, "presign_enabled", True)) if endpoint else True
        allow_external_access = bool(getattr(endpoint, "allow_external_access", False)) if endpoint else False
        max_session_duration = int(getattr(endpoint, "max_session_duration", 3600) or 3600) if endpoint else 3600
        allowed_packages = getattr(endpoint, "allowed_packages", None) if endpoint else None
        if not isinstance(allowed_packages, list):
            allowed_packages = []

        external_enabled = membership.account_id in external_enabled_ids
        access_mode = "external_enabled" if external_enabled else "portal_only"
        integrated_mode = "sts" if sts_enabled else "presigned"

        results.append(
            PortalAccountListItem(
                id=account.id,
                name=account.name,
                portal_role=membership.role_key,
                access_mode=access_mode,
                integrated_mode=integrated_mode,
                storage_endpoint_id=endpoint.id if endpoint else None,
                storage_endpoint_name=endpoint.name if endpoint else None,
                storage_endpoint_url=endpoint.endpoint_url if endpoint else None,
                endpoint=PortalEndpointCapabilities(
                    sts_enabled=sts_enabled,
                    presign_enabled=presign_enabled,
                    allow_external_access=allow_external_access,
                    max_session_duration=max_session_duration,
                    allowed_packages=[p for p in allowed_packages if isinstance(p, str) and p.strip()],
                ),
                external_enabled=external_enabled,
            )
        )

    results.sort(key=lambda item: item.name.lower())
    return results

