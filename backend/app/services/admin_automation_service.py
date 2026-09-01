# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db import User
from app.models.admin_automation import (
    AdminAutomationApplyRequest,
    AdminAutomationApplyResponse,
    AdminAutomationItemResult,
    AdminAutomationSummary,
)
from app.services.admin_automation_account_link_handler import (
    AdminAutomationAccountLinkHandler,
)
from app.services.admin_automation_connection_handler import AdminAutomationConnectionHandler
from app.services.admin_automation_results import AdminAutomationResultFactory
from app.services.admin_automation_s3_account_handler import (
    AdminAutomationS3AccountHandler,
)
from app.services.admin_automation_s3_user_handler import AdminAutomationS3UserHandler
from app.services.admin_automation_storage_endpoint_handler import (
    AdminAutomationStorageEndpointHandler,
)
from app.services.admin_automation_ui_user_handler import AdminAutomationUiUserHandler
from app.services.admin_automation_external_identity_handler import (
    AdminAutomationExternalIdentityHandler,
)
from app.services.audit_service import AuditService
from app.services.s3_accounts_service import S3AccountsService
from app.services.s3_connections_service import S3ConnectionsService
from app.services.s3_users_service import S3UsersService
from app.services.storage_endpoints_service import StorageEndpointsService
from app.services.users_service import UsersService


class AdminAutomationService(AdminAutomationResultFactory):
    def __init__(self, db: Session) -> None:
        self.db = db
        self.storage_endpoint_handler = AdminAutomationStorageEndpointHandler(
            db,
            StorageEndpointsService(db),
        )
        users = UsersService(db)
        self.ui_user_handler = AdminAutomationUiUserHandler(db, users)
        self.external_identity_handler = AdminAutomationExternalIdentityHandler(db)
        self.account_link_handler = AdminAutomationAccountLinkHandler(db, users)
        self.s3_account_handler = AdminAutomationS3AccountHandler(
            db,
            S3AccountsService(db),
        )
        self.s3_user_handler = AdminAutomationS3UserHandler(
            db,
            S3UsersService(db),
        )
        self.s3_connection_handler = AdminAutomationConnectionHandler(
            S3ConnectionsService(db),
        )

    def apply(
        self,
        payload: AdminAutomationApplyRequest,
        *,
        current_user: User,
        audit_service: AuditService,
    ) -> AdminAutomationApplyResponse:
        summary = AdminAutomationSummary()
        results: list[AdminAutomationItemResult] = []
        continue_on_error = bool(payload.continue_on_error)

        def record(result: AdminAutomationItemResult) -> None:
            results.append(result)
            if result.action == "created":
                summary.created += 1
            elif result.action == "updated":
                summary.updated += 1
            elif result.action == "deleted":
                summary.deleted += 1
            elif result.action == "skipped":
                summary.skipped += 1
            elif result.action == "failed":
                summary.failed += 1

        def should_stop() -> bool:
            return summary.failed > 0 and not continue_on_error

        for item in payload.storage_endpoints:
            record(
                self.storage_endpoint_handler.apply(
                    item,
                    payload.dry_run,
                    current_user,
                    audit_service,
                )
            )
            if should_stop():
                break

        if not should_stop():
            for item in payload.ui_users:
                record(self.ui_user_handler.apply(item, payload.dry_run, current_user, audit_service))
                if should_stop():
                    break

        if not should_stop():
            for item in payload.external_identities:
                record(
                    self.external_identity_handler.apply(
                        item,
                        payload.dry_run,
                        current_user,
                        audit_service,
                    )
                )
                if should_stop():
                    break

        if not should_stop():
            for item in payload.s3_accounts:
                record(
                    self.s3_account_handler.apply(
                        item,
                        payload.dry_run,
                        current_user,
                        audit_service,
                    )
                )
                if should_stop():
                    break

        if not should_stop():
            for item in payload.s3_users:
                record(
                    self.s3_user_handler.apply(
                        item,
                        payload.dry_run,
                        current_user,
                        audit_service,
                    )
                )
                if should_stop():
                    break

        if not should_stop():
            for item in payload.s3_connections:
                record(self.s3_connection_handler.apply(item, payload.dry_run, current_user, audit_service))
                if should_stop():
                    break

        if not should_stop():
            for item in payload.account_links:
                record(
                    self.account_link_handler.apply(
                        item,
                        payload.dry_run,
                        current_user,
                        audit_service,
                    )
                )
                if should_stop():
                    break

        changed = summary.created + summary.updated + summary.deleted > 0
        success = summary.failed == 0
        return AdminAutomationApplyResponse(
            changed=changed,
            success=success,
            summary=summary,
            results=results,
        )


def get_admin_automation_service(db: Session) -> AdminAutomationService:
    return AdminAutomationService(db)
