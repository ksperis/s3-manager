# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db_models import IamIdentity, PortalMembership, PortalRole, PortalRoleBinding, User
from app.models.portal_v2 import PortalMember, PortalMemberRoleUpdate
from app.routers.dependencies import get_audit_logger
from app.routers.portal.dependencies import PortalContext, require_portal_permission
from app.services.audit_service import AuditService


router = APIRouter()


@router.get("/members", response_model=list[PortalMember])
def list_portal_members(
    ctx: PortalContext = Depends(require_portal_permission("portal.members.view")),
    db: Session = Depends(get_db),
) -> list[PortalMember]:
    rows = (
        db.query(User.id, User.email, PortalMembership.role_key, IamIdentity.id)
        .join(PortalMembership, PortalMembership.user_id == User.id)
        .outerjoin(
            IamIdentity,
            and_(
                IamIdentity.user_id == User.id,
                IamIdentity.account_id == ctx.account.id,
                IamIdentity.is_enabled.is_(True),
            ),
        )
        .filter(PortalMembership.account_id == ctx.account.id)
        .order_by(User.email.asc())
        .all()
    )
    return [
        PortalMember(user_id=row[0], email=row[1], portal_role=row[2], external_enabled=bool(row[3]))
        for row in rows
    ]


@router.put("/members/{user_id}/role", response_model=PortalMember)
def update_portal_member_role(
    user_id: int,
    payload: PortalMemberRoleUpdate,
    ctx: PortalContext = Depends(require_portal_permission("portal.members.manage")),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_logger),
) -> PortalMember:
    membership = (
        db.query(PortalMembership)
        .filter(PortalMembership.user_id == user_id, PortalMembership.account_id == ctx.account.id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    role = db.query(PortalRole).filter(PortalRole.key == payload.role_key.value).first()
    if not role:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")

    previous = membership.role_key
    membership.role_key = payload.role_key.value
    db.add(membership)

    db.query(PortalRoleBinding).filter(
        PortalRoleBinding.user_id == user_id,
        PortalRoleBinding.account_id == ctx.account.id,
        PortalRoleBinding.bucket.is_(None),
        PortalRoleBinding.prefix.is_(None),
    ).delete()
    db.add(PortalRoleBinding(user_id=user_id, account_id=ctx.account.id, role_id=role.id))
    db.commit()

    target = db.query(User).filter(User.id == user_id).first()
    identity = (
        db.query(IamIdentity)
        .filter(IamIdentity.user_id == user_id, IamIdentity.account_id == ctx.account.id, IamIdentity.is_enabled.is_(True))
        .first()
    )
    audit.record_action(
        user=ctx.actor,
        scope="portal",
        action="update_member_role",
        surface="portal",
        workflow="members.update_role",
        entity_type="member",
        entity_id=str(user_id),
        account=ctx.account,
        executor_type="portal_api",
        executor_principal="portal",
        delta={"from_role": previous, "to_role": payload.role_key.value, "target_email": target.email if target else None},
    )
    return PortalMember(
        user_id=user_id,
        email=target.email if target else "unknown",
        portal_role=payload.role_key,
        external_enabled=bool(identity),
    )

