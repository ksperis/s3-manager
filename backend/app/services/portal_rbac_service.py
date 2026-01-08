# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db_models import PortalMembership, PortalPermission, PortalRole, PortalRoleBinding, PortalRolePermission


class PortalRbacService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_role_key(self, *, user_id: int, account_id: int) -> str | None:
        membership = (
            self.db.query(PortalMembership)
            .filter(PortalMembership.user_id == user_id, PortalMembership.account_id == account_id)
            .first()
        )
        if not membership:
            return None
        return membership.role_key

    def permissions_for_role(self, *, role_key: str) -> set[str]:
        rows = (
            self.db.query(PortalPermission.key)
            .join(PortalRolePermission, PortalRolePermission.permission_id == PortalPermission.id)
            .join(PortalRole, PortalRole.id == PortalRolePermission.role_id)
            .filter(PortalRole.key == role_key)
            .all()
        )
        return {row[0] for row in rows if row and row[0]}

    def permissions_for_user(self, *, user_id: int, account_id: int) -> set[str]:
        rows = (
            self.db.query(PortalPermission.key)
            .join(PortalRolePermission, PortalRolePermission.permission_id == PortalPermission.id)
            .join(PortalRole, PortalRole.id == PortalRolePermission.role_id)
            .join(PortalRoleBinding, PortalRoleBinding.role_id == PortalRole.id)
            .filter(
                PortalRoleBinding.user_id == user_id,
                PortalRoleBinding.account_id == account_id,
                PortalRoleBinding.bucket.is_(None),
                PortalRoleBinding.prefix.is_(None),
            )
            .all()
        )
        permissions = {row[0] for row in rows if row and row[0]}
        if permissions:
            return permissions
        role_key = self.get_role_key(user_id=user_id, account_id=account_id)
        if not role_key:
            return set()
        return self.permissions_for_role(role_key=role_key)


def get_portal_rbac_service(db: Session) -> PortalRbacService:
    return PortalRbacService(db)

