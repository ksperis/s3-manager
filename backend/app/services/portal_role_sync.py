# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy.orm import Session

from app.db import AccountRole, S3Account, User
from app.services.effective_access_service import EffectiveAccessService
from app.services.portal_ownership import require_no_private_storage_space_ownership


PortalRoleMap = dict[tuple[int, int], str | None]
_ROLE_RANK = {
    None: 0,
    AccountRole.PORTAL_USER.value: 1,
    AccountRole.PORTAL_MANAGER.value: 2,
}


def capture_effective_portal_roles(
    db: Session,
    *,
    user_ids: Iterable[int],
    account_ids: Iterable[int],
) -> PortalRoleMap:
    users = db.query(User).filter(User.id.in_(sorted(set(user_ids)))).all()
    resolved_by_user = {
        int(user.id): EffectiveAccessService(db).resolve_user(user)
        for user in users
    }
    roles: PortalRoleMap = {}
    for user_id, resolved in resolved_by_user.items():
        for account_id in sorted(set(account_ids)):
            link = resolved.account_link_for(account_id)
            roles[(user_id, account_id)] = link.portal_role if link else None
    return roles


def sync_portal_role_downgrades(
    db: Session,
    *,
    before: PortalRoleMap,
    after: PortalRoleMap,
) -> None:
    from app.services.portal_service import PortalService

    service = PortalService(db)
    for (user_id, account_id), previous_role in before.items():
        next_role = after.get((user_id, account_id))
        if _ROLE_RANK[next_role] >= _ROLE_RANK[previous_role]:
            continue
        if next_role is None:
            require_no_private_storage_space_ownership(db, user_id=user_id, account_id=account_id)
        user = db.query(User).filter(User.id == user_id).one()
        account = db.query(S3Account).filter(S3Account.id == account_id).one()
        service.sync_existing_portal_user_access(user, account, next_role)


def sync_portal_role_promotions(
    db: Session,
    *,
    before: PortalRoleMap,
    after: PortalRoleMap,
) -> None:
    from app.services.portal_service import PortalService

    service = PortalService(db)
    for (user_id, account_id), next_role in after.items():
        previous_role = before.get((user_id, account_id))
        if _ROLE_RANK[next_role] <= _ROLE_RANK[previous_role]:
            continue
        user = db.query(User).filter(User.id == user_id).one()
        account = db.query(S3Account).filter(S3Account.id == account_id).one()
        service.sync_existing_portal_user_access(user, account, next_role)
