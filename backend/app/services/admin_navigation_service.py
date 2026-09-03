# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import (
    ExternalIdentityLinkRequest,
    PortalAdminRequest,
    User,
    is_superadmin_ui_role,
)
from app.models.admin_navigation import AdminPendingRequestCounts
from app.services.identity_security_policy import STANDARD_UI_ROLES
from app.utils.time import utcnow


class AdminNavigationService:
    @staticmethod
    def pending_request_counts(db: Session, actor: User) -> AdminPendingRequestCounts:
        identity_query = (
            db.query(func.count(ExternalIdentityLinkRequest.id))
            .join(User, User.id == ExternalIdentityLinkRequest.user_id)
            .filter(
                ExternalIdentityLinkRequest.status == "pending",
                ExternalIdentityLinkRequest.expires_at > utcnow(),
            )
        )
        if not is_superadmin_ui_role(actor.role):
            identity_query = identity_query.filter(User.role.in_(STANDARD_UI_ROLES))

        portal_count = (
            db.query(func.count(PortalAdminRequest.id))
            .filter(PortalAdminRequest.status == "pending")
            .scalar()
            or 0
        )
        return AdminPendingRequestCounts(
            identity_link_requests=int(identity_query.scalar() or 0),
            portal_requests=int(portal_count),
        )
