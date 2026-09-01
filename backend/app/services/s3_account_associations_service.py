# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from sqlalchemy.orm import Session

from app.db import (
    S3Account,
    UiGroup,
    UiGroupS3Account,
    User,
    UserRole,
    UserS3Account,
    UserUiGroup,
    is_admin_ui_role,
)
from app.models.s3_account import AccountGroupLink, AccountUserLink, S3AccountUpdate
from app.utils.time import utcnow


class S3AccountAssociationsService:
    """Validate and synchronize an S3 account's direct associations."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def affected_portal_user_ids(
        self,
        account: S3Account,
        payload: S3AccountUpdate,
    ) -> set[int]:
        user_ids: set[int] = set()
        if payload.user_links is not None:
            user_ids.update(
                int(user_id)
                for (user_id,) in (
                    self.db.query(UserS3Account.user_id)
                    .filter(UserS3Account.account_id == account.id)
                    .all()
                )
            )
            user_ids.update(int(link.user_id) for link in payload.user_links)
        if payload.group_links is not None:
            group_ids = {
                int(group_id)
                for (group_id,) in (
                    self.db.query(UiGroupS3Account.group_id)
                    .filter(UiGroupS3Account.account_id == account.id)
                    .all()
                )
            }
            group_ids.update(int(link.group_id) for link in payload.group_links)
            if group_ids:
                user_ids.update(
                    int(user_id)
                    for (user_id,) in (
                        self.db.query(UserUiGroup.user_id)
                        .filter(UserUiGroup.group_id.in_(group_ids))
                        .all()
                    )
                )
        return user_ids

    def set_user_links(
        self,
        account: S3Account,
        links: list[AccountUserLink],
    ) -> None:
        cleaned = {int(link.user_id): link for link in links}

        users_by_id: dict[int, User] = {}
        if cleaned:
            users = self.db.query(User).filter(User.id.in_(cleaned)).all()
            users_by_id = {int(user.id): user for user in users}
            missing = set(cleaned) - set(users_by_id)
            if missing:
                raise ValueError(f"User not found: {min(missing)}")

        existing = (
            self.db.query(UserS3Account)
            .filter(UserS3Account.account_id == account.id)
            .all()
        )
        existing_by_user = {int(link.user_id): link for link in existing}
        desired_ids = set(cleaned)
        for user_id in set(existing_by_user) - desired_ids:
            self.db.delete(existing_by_user[user_id])

        for user_id, link in cleaned.items():
            row = existing_by_user.get(user_id)
            if row is None:
                user = users_by_id[user_id]
                if not is_admin_ui_role(user.role):
                    user.role = UserRole.UI_USER.value
                    self.db.add(user)
                row = UserS3Account(
                    user_id=user_id,
                    account_id=account.id,
                    manager_role=link.manager_role,
                    portal_role=link.portal_role,
                    allow_manager_browser_data_access=bool(
                        link.allow_manager_browser_data_access
                    ),
                )
            row.manager_role = link.manager_role
            row.portal_role = link.portal_role
            row.allow_manager_browser_data_access = bool(
                link.allow_manager_browser_data_access
            )
            row.updated_at = utcnow()
            self.db.add(row)

    def set_group_links(
        self,
        account: S3Account,
        links: list[AccountGroupLink],
    ) -> None:
        cleaned = {int(link.group_id): link for link in links}

        if cleaned:
            found_ids = {
                int(group_id)
                for (group_id,) in (
                    self.db.query(UiGroup.id)
                    .filter(UiGroup.id.in_(cleaned))
                    .all()
                )
            }
            missing = set(cleaned) - found_ids
            if missing:
                missing_str = ", ".join(str(group_id) for group_id in sorted(missing))
                raise ValueError(f"UI groups not found: {missing_str}")

        existing = (
            self.db.query(UiGroupS3Account)
            .filter(UiGroupS3Account.account_id == account.id)
            .all()
        )
        existing_by_group = {int(link.group_id): link for link in existing}
        desired_ids = set(cleaned)
        for group_id in set(existing_by_group) - desired_ids:
            self.db.delete(existing_by_group[group_id])
        for group_id, link in cleaned.items():
            row = existing_by_group.get(group_id)
            if row is None:
                row = UiGroupS3Account(
                    group_id=group_id,
                    account_id=account.id,
                    manager_role=link.manager_role,
                    portal_role=link.portal_role,
                    allow_manager_browser_data_access=bool(
                        link.allow_manager_browser_data_access
                    ),
                )
            row.manager_role = link.manager_role
            row.portal_role = link.portal_role
            row.allow_manager_browser_data_access = bool(
                link.allow_manager_browser_data_access
            )
            row.updated_at = utcnow()
            self.db.add(row)
