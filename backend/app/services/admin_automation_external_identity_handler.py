# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import ExternalIdentity, User, UserRole, is_superadmin_ui_role
from app.models.admin_automation import ExternalIdentityApply, AdminAutomationItemResult
from app.services.admin_automation_results import AdminAutomationResultFactory
from app.services.audit_service import AuditService
from app.services.external_identity_user_service import ExternalIdentityUserService


class AdminAutomationExternalIdentityHandler(AdminAutomationResultFactory):
    def __init__(self, db: Session) -> None:
        self.db = db

    def apply(
        self,
        item: ExternalIdentityApply,
        dry_run: bool,
        current_user: User,
        audit_service: AuditService,
    ) -> AdminAutomationItemResult:
        key = f"{item.match.provider_type}:{item.match.provider_id}"
        try:
            target = self._target(item)
            if target is None:
                raise ValueError("External identity target user not found")
            if not is_superadmin_ui_role(current_user.role) and target.role not in {
                UserRole.UI_USER.value,
                UserRole.UI_NONE.value,
            }:
                raise ValueError("Administrators can manage only standard users")
            identity = self._identity(item)
            if identity is not None and identity.user_id != target.id:
                raise ValueError("External identity subject belongs to another user")

            service = ExternalIdentityUserService(self.db)
            if item.state == "absent":
                if identity is None or identity.revoked_at is not None:
                    return self._skipped("external_identity", key, dry_run=dry_run)
                if dry_run:
                    return self._deleted("external_identity", key, identity.id, dry_run=True)
                service.revoke_identity(identity.id, reason="automation_identity_revoked")
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="automation_external_identity_revoked",
                    entity_type="external_identity",
                    entity_id=identity.id,
                    metadata={"provider_type": identity.provider_type, "provider_id": identity.provider_id},
                )
                return self._deleted("external_identity", key, identity.id, dry_run=False)

            if identity is not None and identity.revoked_at is None:
                return self._skipped("external_identity", key, dry_run=dry_run)
            if identity is not None and not item.restore:
                raise ValueError("External identity is revoked; explicit restoration is required")
            if dry_run:
                action = self._updated if identity is not None else self._created
                return action("external_identity", key, identity.id if identity else None, dry_run=True)
            spec = item.spec
            provisioned, _ = service.provision_identity(
                user=target,
                provider_type=item.match.provider_type,
                provider_id=item.match.provider_id,
                subject=item.match.subject,
                email=str(spec.email) if spec and spec.email else None,
                email_verified=bool(spec.email_verified) if spec else False,
                restore=item.restore,
                link_source="automation",
            )
            action_name = "automation_external_identity_restored" if identity is not None else "automation_external_identity_linked"
            audit_service.record_action(
                user=current_user,
                scope="admin",
                action=action_name,
                entity_type="external_identity",
                entity_id=provisioned.id,
                metadata={"provider_type": provisioned.provider_type, "provider_id": provisioned.provider_id},
            )
            if identity is not None:
                return self._updated("external_identity", key, provisioned.id, {"revoked": {"from": True, "to": False}}, dry_run=False)
            return self._created("external_identity", key, provisioned.id, dry_run=False)
        except Exception as exc:  # noqa: BLE001
            return self._failed("external_identity", key, exc, dry_run=dry_run)

    def _target(self, item: ExternalIdentityApply) -> User | None:
        if item.user.id is not None:
            return self.db.query(User).filter(User.id == item.user.id).first()
        return self.db.query(User).filter(func.lower(User.email) == str(item.user.email).lower()).first()

    def _identity(self, item: ExternalIdentityApply) -> ExternalIdentity | None:
        return self.db.query(ExternalIdentity).filter(
            ExternalIdentity.provider_type == item.match.provider_type,
            ExternalIdentity.provider_id == item.match.provider_id.strip().lower(),
            ExternalIdentity.subject == item.match.subject.strip(),
        ).first()
