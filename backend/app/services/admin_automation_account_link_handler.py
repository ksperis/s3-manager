# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db import S3Account, User, UserS3Account
from app.models.admin_automation import AccountLinkApply, AdminAutomationItemResult
from app.services.admin_automation_results import AdminAutomationResultFactory
from app.services.audit_service import AuditService
from app.services.users_service import UsersService


class AdminAutomationAccountLinkHandler(AdminAutomationResultFactory):
    def __init__(self, db: Session, users: UsersService) -> None:
        self.db = db
        self.users = users

    def apply(
        self,
        item: AccountLinkApply,
        dry_run: bool,
        current_user: User,
        audit_service: AuditService,
    ) -> AdminAutomationItemResult:
        key = self._key(item)
        try:
            user = self._resolve_user(item)
            account = self._resolve_account(item)
            link = self._find_link(user.id, account.id)

            if item.state == "absent":
                if not link:
                    return self._skipped("account_link", key, dry_run=dry_run)
                if dry_run:
                    return self._deleted(
                        "account_link",
                        key,
                        link.id,
                        dry_run=dry_run,
                    )
                link_id = link.id
                removed_manager_role = link.manager_role
                removed_portal_role = link.portal_role
                self.users.unassign_user_from_account(user.id, account.id)
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="unassign_user_account",
                    entity_type="ui_user",
                    entity_id=str(user.id),
                    account_id=account.id,
                    metadata={
                        "assigned_user_id": user.id,
                        "removed_manager_role": removed_manager_role,
                        "removed_portal_role": removed_portal_role,
                    },
                )
                return self._deleted(
                    "account_link",
                    key,
                    link_id,
                    dry_run=dry_run,
                )

            desired_manager_role = item.manager_role
            desired_portal_role = item.portal_role
            if link:
                if (
                    desired_manager_role == link.manager_role
                    and desired_portal_role == link.portal_role
                ):
                    return self._skipped("account_link", key, dry_run=dry_run)
                diff = {
                    "manager_role": {
                        "from": link.manager_role,
                        "to": desired_manager_role,
                    },
                    "portal_role": {
                        "from": link.portal_role,
                        "to": desired_portal_role,
                    },
                }
                if dry_run:
                    return self._updated(
                        "account_link",
                        key,
                        link.id,
                        diff,
                        dry_run=dry_run,
                    )
                self.users.assign_user_to_account(
                    user.id,
                    account.id,
                    manager_role=desired_manager_role,
                    portal_role=desired_portal_role,
                )
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="assign_user_account",
                    entity_type="ui_user",
                    entity_id=str(user.id),
                    account_id=account.id,
                    metadata={
                        "assigned_user_id": user.id,
                        "manager_role": desired_manager_role,
                        "portal_role": desired_portal_role,
                    },
                )
                return self._updated(
                    "account_link",
                    key,
                    link.id,
                    diff,
                    dry_run=dry_run,
                )

            if dry_run:
                return self._created("account_link", key, dry_run=dry_run)
            self.users.assign_user_to_account(
                user.id,
                account.id,
                manager_role=desired_manager_role,
                portal_role=desired_portal_role,
            )
            created_link = self._find_link(user.id, account.id)
            if created_link is None:
                raise RuntimeError("Account link creation did not persist")
            audit_service.record_action(
                user=current_user,
                scope="admin",
                action="assign_user_account",
                entity_type="ui_user",
                entity_id=str(user.id),
                account_id=account.id,
                metadata={
                    "assigned_user_id": user.id,
                    "manager_role": desired_manager_role,
                    "portal_role": desired_portal_role,
                },
            )
            return self._created(
                "account_link",
                key,
                created_link.id,
                dry_run=dry_run,
            )
        except Exception as exc:  # noqa: BLE001
            return self._failed("account_link", key, exc, dry_run=dry_run)

    def _resolve_user(self, item: AccountLinkApply) -> User:
        ref = item.user
        if ref.id is not None:
            user = self.db.query(User).filter(User.id == ref.id).first()
        else:
            user = self.db.query(User).filter(User.email == ref.email).first()
        if not user:
            raise ValueError("UI user not found")
        return user

    def _resolve_account(self, item: AccountLinkApply) -> S3Account:
        ref = item.account
        if ref.id is not None:
            account = self.db.query(S3Account).filter(S3Account.id == ref.id).first()
        elif ref.rgw_account_id:
            account = (
                self.db.query(S3Account)
                .filter(S3Account.rgw_account_id == ref.rgw_account_id)
                .first()
            )
        else:
            account = self.db.query(S3Account).filter(S3Account.name == ref.name).first()
        if not account:
            raise ValueError("S3Account not found")
        return account

    def _find_link(self, user_id: int, account_id: int) -> UserS3Account | None:
        return (
            self.db.query(UserS3Account)
            .filter(
                UserS3Account.user_id == user_id,
                UserS3Account.account_id == account_id,
            )
            .first()
        )

    @staticmethod
    def _key(item: AccountLinkApply) -> str:
        if item.user.email:
            user_label = f"email={item.user.email}"
        else:
            user_label = f"id={item.user.id}"
        if item.account.name:
            account_label = f"name={item.account.name}"
        elif item.account.rgw_account_id:
            account_label = f"rgw_account_id={item.account.rgw_account_id}"
        else:
            account_label = f"id={item.account.id}"
        return f"user[{user_label}],account[{account_label}]"
