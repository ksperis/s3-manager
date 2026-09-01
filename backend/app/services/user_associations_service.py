# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from sqlalchemy.orm import Session

from app.db import (
    S3Account,
    S3Connection,
    S3User,
    UiGroup,
    UiGroupS3Account,
    User,
    UserRole,
    UserS3Account,
    UserS3Connection,
    UserS3User,
    UserUiGroup,
)
from app.models.user import AccountMembership, S3UserMembership, UserUpdate
from app.utils.time import utcnow


class UserAssociationsService:
    """Validate and synchronize a UI user's direct associations."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def affected_portal_account_ids(
        self,
        user: User,
        payload: UserUpdate,
    ) -> list[int]:
        if payload.account_links is None and payload.group_ids is None:
            return []
        account_ids = {
            int(account_id)
            for (account_id,) in (
                self.db.query(UserS3Account.account_id)
                .filter(UserS3Account.user_id == user.id)
                .all()
            )
        }
        account_ids.update(
            int(link.account_id)
            for link in (payload.account_links or [])
        )
        if payload.group_ids is not None:
            existing_group_ids = {
                int(group_id)
                for (group_id,) in (
                    self.db.query(UserUiGroup.group_id)
                    .filter(UserUiGroup.user_id == user.id)
                    .all()
                )
            }
            affected_group_ids = existing_group_ids | {
                int(group_id) for group_id in payload.group_ids
            }
            if affected_group_ids:
                account_ids.update(
                    int(account_id)
                    for (account_id,) in (
                        self.db.query(UiGroupS3Account.account_id)
                        .filter(
                            UiGroupS3Account.group_id.in_(
                                affected_group_ids,
                            )
                        )
                        .all()
                    )
                )
        return sorted(account_ids)

    def set_account_links(
        self,
        user: User,
        links: list[AccountMembership],
    ) -> None:
        cleaned = {int(link.account_id): link for link in links}
        if cleaned:
            found_ids = {
                int(account_id)
                for (account_id,) in (
                    self.db.query(S3Account.id)
                    .filter(S3Account.id.in_(cleaned))
                    .all()
                )
            }
            missing = set(cleaned) - found_ids
            if missing:
                missing_str = ", ".join(
                    str(account_id) for account_id in sorted(missing)
                )
                raise ValueError(f"S3 accounts not found: {missing_str}")
        existing = (
            self.db.query(UserS3Account)
            .filter(UserS3Account.user_id == user.id)
            .all()
        )
        existing_by_account = {
            int(link.account_id): link for link in existing
        }
        desired_ids = set(cleaned)
        for account_id, row in existing_by_account.items():
            if account_id not in desired_ids:
                self.db.delete(row)
        for account_id, link in cleaned.items():
            row = existing_by_account.get(account_id)
            if row is None:
                row = UserS3Account(
                    user_id=user.id,
                    account_id=account_id,
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
        if desired_ids and user.role == UserRole.UI_NONE.value:
            user.role = UserRole.UI_USER.value

    def set_s3_user_links(
        self,
        user: User,
        links: list[S3UserMembership],
    ) -> None:
        cleaned = {int(link.s3_user_id): link for link in links}
        existing_links = (
            self.db.query(UserS3User)
            .filter(UserS3User.user_id == user.id)
            .all()
        )
        existing_by_id = {
            int(link.s3_user_id): link for link in existing_links
        }
        existing_ids = set(existing_by_id)
        desired_ids = set(cleaned)
        to_remove = existing_ids - desired_ids
        to_add = desired_ids - existing_ids
        if to_add:
            s3_users = (
                self.db.query(S3User)
                .filter(S3User.id.in_(to_add))
                .all()
            )
            found_ids = {int(s3_user.id) for s3_user in s3_users}
            missing = to_add - found_ids
            if missing:
                missing_str = ", ".join(
                    str(s3_user_id) for s3_user_id in sorted(missing)
                )
                raise ValueError(f"S3 users not found: {missing_str}")
            for s3_user in s3_users:
                self.db.add(
                    UserS3User(
                        user_id=user.id,
                        s3_user_id=s3_user.id,
                        allow_manager_browser_data_access=bool(
                            cleaned[s3_user.id].allow_manager_browser_data_access
                        ),
                    )
                )
        if to_remove:
            (
                self.db.query(UserS3User)
                .filter(
                    UserS3User.user_id == user.id,
                    UserS3User.s3_user_id.in_(to_remove),
                )
                .delete(synchronize_session=False)
            )
        for s3_user_id in desired_ids & existing_ids:
            row = existing_by_id[s3_user_id]
            row.allow_manager_browser_data_access = bool(
                cleaned[s3_user_id].allow_manager_browser_data_access
            )
            self.db.add(row)

    def set_s3_connection_links(
        self,
        user: User,
        target_ids: list[int],
    ) -> None:
        cleaned_ids = {
            int(connection_id)
            for connection_id in target_ids
            if connection_id is not None
        }
        existing_links = (
            self.db.query(UserS3Connection)
            .filter(UserS3Connection.user_id == user.id)
            .all()
        )
        existing_ids = {
            int(link.s3_connection_id) for link in existing_links
        }
        if cleaned_ids:
            connections = (
                self.db.query(S3Connection)
                .filter(S3Connection.id.in_(cleaned_ids))
                .all()
            )
            found_ids = {int(connection.id) for connection in connections}
            missing = cleaned_ids - found_ids
            if missing:
                missing_str = ", ".join(
                    str(connection_id)
                    for connection_id in sorted(missing)
                )
                raise ValueError(
                    f"S3 connections not found: {missing_str}"
                )
            non_shared_ids = sorted(
                int(connection.id)
                for connection in connections
                if not bool(connection.is_shared)
            )
            if non_shared_ids:
                non_shared_str = ", ".join(
                    str(connection_id) for connection_id in non_shared_ids
                )
                raise ValueError(
                    "Only shared S3 connections can be linked: "
                    f"{non_shared_str}"
                )
        to_remove = existing_ids - cleaned_ids
        to_add = cleaned_ids - existing_ids
        if to_remove:
            (
                self.db.query(UserS3Connection)
                .filter(
                    UserS3Connection.user_id == user.id,
                    UserS3Connection.s3_connection_id.in_(to_remove),
                )
                .delete(synchronize_session=False)
            )
        for connection_id in to_add:
            self.db.add(
                UserS3Connection(
                    user_id=user.id,
                    s3_connection_id=connection_id,
                )
            )

    def set_group_links(self, user: User, target_ids: list[int]) -> None:
        cleaned_ids = {
            int(group_id)
            for group_id in target_ids
            if group_id is not None
        }
        existing_links = (
            self.db.query(UserUiGroup)
            .filter(UserUiGroup.user_id == user.id)
            .all()
        )
        existing_ids = {int(link.group_id) for link in existing_links}
        if cleaned_ids:
            groups = (
                self.db.query(UiGroup)
                .filter(UiGroup.id.in_(cleaned_ids))
                .all()
            )
            found_ids = {int(group.id) for group in groups}
            missing = cleaned_ids - found_ids
            if missing:
                missing_str = ", ".join(
                    str(group_id) for group_id in sorted(missing)
                )
                raise ValueError(f"UI groups not found: {missing_str}")
        to_remove = existing_ids - cleaned_ids
        to_add = cleaned_ids - existing_ids
        if to_remove:
            (
                self.db.query(UserUiGroup)
                .filter(
                    UserUiGroup.user_id == user.id,
                    UserUiGroup.group_id.in_(to_remove),
                )
                .delete(synchronize_session=False)
            )
        for group_id in to_add:
            self.db.add(UserUiGroup(user_id=user.id, group_id=group_id))

    def groups_grant_ceph_admin(
        self,
        group_ids: list[int] | None,
    ) -> bool:
        cleaned_ids = {
            int(group_id)
            for group_id in (group_ids or [])
            if group_id is not None
        }
        if not cleaned_ids:
            return False
        return bool(
            self.db.query(UiGroup.id)
            .filter(
                UiGroup.id.in_(cleaned_ids),
                UiGroup.can_access_ceph_admin.is_(True),
            )
            .first()
        )


def get_user_associations_service(db: Session) -> UserAssociationsService:
    return UserAssociationsService(db)
