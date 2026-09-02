# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from sqlalchemy.orm import Session

from app.db import (
    S3User,
    UiGroup,
    UiGroupS3User,
    User,
    UserRole,
    UserS3User,
    is_admin_ui_role,
)
from app.models.s3_user import S3UserGroupLink, S3UserUserLink
from app.services.ui_group_avatar_service import UiGroupAvatarService
from app.services.user_avatar_service import UserAvatarService


class S3UserAssociationsService:
    """Load, validate, and synchronize an S3 user's UI associations."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def replace_links(
        self,
        s3_user: S3User,
        *,
        user_links: list[S3UserUserLink] | None,
        group_links: list[S3UserGroupLink] | None,
    ) -> None:
        desired_users = (
            None
            if user_links is None
            else {
                int(link.user_id): bool(
                    link.allow_manager_browser_data_access
                )
                for link in user_links
            }
        )
        desired_groups = (
            None
            if group_links is None
            else {
                int(link.group_id): bool(
                    link.allow_manager_browser_data_access
                )
                for link in group_links
            }
        )

        users_by_id = self._load_desired_users(desired_users)
        self._ensure_desired_groups_exist(desired_groups)

        if desired_users is not None:
            self._replace_user_links(s3_user, desired_users, users_by_id)
        if desired_groups is not None:
            self._replace_group_links(s3_user, desired_groups)

    def _load_desired_users(
        self,
        desired: dict[int, bool] | None,
    ) -> dict[int, User]:
        if not desired:
            return {}
        users = self.db.query(User).filter(User.id.in_(desired)).all()
        users_by_id = {int(user.id): user for user in users}
        missing = set(desired) - set(users_by_id)
        if missing:
            missing_ids = ", ".join(str(user_id) for user_id in sorted(missing))
            raise ValueError(f"Users not found: {missing_ids}")
        return users_by_id

    def _ensure_desired_groups_exist(
        self,
        desired: dict[int, bool] | None,
    ) -> None:
        if not desired:
            return
        found_ids = {
            int(group_id)
            for (group_id,) in (
                self.db.query(UiGroup.id)
                .filter(UiGroup.id.in_(desired))
                .all()
            )
        }
        missing = set(desired) - found_ids
        if missing:
            missing_ids = ", ".join(str(group_id) for group_id in sorted(missing))
            raise ValueError(f"UI groups not found: {missing_ids}")

    def _replace_user_links(
        self,
        s3_user: S3User,
        desired: dict[int, bool],
        users_by_id: dict[int, User],
    ) -> None:
        existing = (
            self.db.query(UserS3User)
            .filter(UserS3User.s3_user_id == s3_user.id)
            .all()
        )
        existing_by_user = {int(link.user_id): link for link in existing}
        for user_id in set(existing_by_user) - set(desired):
            self.db.delete(existing_by_user[user_id])
        for user_id, allow_browser in desired.items():
            row = existing_by_user.get(user_id)
            if row is None:
                user = users_by_id[user_id]
                if (
                    user.role != UserRole.UI_USER.value
                    and not is_admin_ui_role(user.role)
                ):
                    user.role = UserRole.UI_USER.value
                    self.db.add(user)
                row = UserS3User(user_id=user_id, s3_user_id=s3_user.id)
            row.allow_manager_browser_data_access = allow_browser
            self.db.add(row)

    def _replace_group_links(
        self,
        s3_user: S3User,
        desired: dict[int, bool],
    ) -> None:
        existing = (
            self.db.query(UiGroupS3User)
            .filter(UiGroupS3User.s3_user_id == s3_user.id)
            .all()
        )
        existing_by_group = {int(link.group_id): link for link in existing}
        for group_id in set(existing_by_group) - set(desired):
            self.db.delete(existing_by_group[group_id])
        for group_id, allow_browser in desired.items():
            row = existing_by_group.get(group_id)
            if row is None:
                row = UiGroupS3User(
                    group_id=group_id,
                    s3_user_id=s3_user.id,
                )
            row.allow_manager_browser_data_access = allow_browser
            self.db.add(row)

    def load_links(
        self,
        s3_user_ids: list[int],
    ) -> tuple[
        dict[int, list[S3UserUserLink]],
        dict[int, list[S3UserGroupLink]],
    ]:
        return (
            self._load_user_links(s3_user_ids),
            self._load_group_links(s3_user_ids),
        )

    def _load_user_links(
        self,
        s3_user_ids: list[int],
    ) -> dict[int, list[S3UserUserLink]]:
        if not s3_user_ids:
            return {}
        rows = (
            self.db.query(
                UserS3User.s3_user_id,
                User,
                UserS3User.allow_manager_browser_data_access,
            )
            .join(User, User.id == UserS3User.user_id)
            .filter(UserS3User.s3_user_id.in_(s3_user_ids))
            .order_by(UserS3User.s3_user_id.asc(), User.email.asc(), User.id.asc())
            .all()
        )
        links_by_s3_user: dict[int, list[S3UserUserLink]] = {}
        avatar_service = UserAvatarService(self.db)
        for s3_user_id, user, allow_browser in rows:
            normalized_s3_user_id = int(s3_user_id)
            links_by_s3_user.setdefault(normalized_s3_user_id, []).append(
                S3UserUserLink(
                    user_id=int(user.id),
                    user_email=user.email,
                    user_full_name=user.full_name,
                    user_avatar=avatar_service.descriptor(user),
                    allow_manager_browser_data_access=bool(allow_browser),
                )
            )
        return links_by_s3_user

    def _load_group_links(
        self,
        s3_user_ids: list[int],
    ) -> dict[int, list[S3UserGroupLink]]:
        if not s3_user_ids:
            return {}
        rows = (
            self.db.query(
                UiGroupS3User.s3_user_id,
                UiGroup,
                UiGroupS3User.allow_manager_browser_data_access,
            )
            .join(UiGroup, UiGroup.id == UiGroupS3User.group_id)
            .filter(UiGroupS3User.s3_user_id.in_(s3_user_ids))
            .order_by(
                UiGroupS3User.s3_user_id.asc(),
                UiGroup.name.asc(),
                UiGroup.id.asc(),
            )
            .all()
        )
        links_by_s3_user: dict[int, list[S3UserGroupLink]] = {}
        avatar_service = UiGroupAvatarService(self.db)
        for s3_user_id, group, allow_browser in rows:
            normalized_s3_user_id = int(s3_user_id)
            links_by_s3_user.setdefault(normalized_s3_user_id, []).append(
                S3UserGroupLink(
                    group_id=int(group.id),
                    group_name=group.name,
                    group_avatar=avatar_service.descriptor(group),
                    allow_manager_browser_data_access=bool(allow_browser),
                )
            )
        return links_by_s3_user
