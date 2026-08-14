# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import DetachedInstanceError

from app.db import (
    UiGroup,
    User,
    UserS3Account,
    UserS3Connection,
    UserS3User,
    UserUiGroup,
    is_admin_ui_role,
)
from app.models.user import (
    AccountMembershipDetail,
    LinkedS3Connection,
    LinkedS3User,
    LinkedUiGroup,
    ManagerToolAccess,
    S3UserMembership,
    UiPreferences,
    UserOut,
)
from app.services.association_names import (
    load_s3_user_names,
    load_shared_s3_connection_names,
)
from app.services.effective_access_service import EffectiveAccessService
from app.services.user_avatar_service import UserAvatarService


class UserOutputService:
    """Build the complete public user projection from direct and effective access."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def to_out(
        self,
        user: User,
        *,
        s3_user_labels: Optional[dict[int, str]] = None,
        preloaded_s3_links: Optional[dict[int, list[int]]] = None,
        s3_connection_labels: Optional[dict[int, str]] = None,
        preloaded_connection_links: Optional[dict[int, list[int]]] = None,
    ) -> UserOut:
        account_links = self._account_links(user)
        group_ids = self._group_ids(user)
        s3_user_ids, s3_user_links = self._s3_user_links(user)
        s3_connection_ids = self._s3_connection_ids(user)

        if preloaded_s3_links is not None and user.id in preloaded_s3_links:
            s3_user_ids = preloaded_s3_links[user.id]
            existing_permissions = {
                link.s3_user_id: link.allow_manager_browser_data_access
                for link in s3_user_links
            }
            s3_user_links = [
                S3UserMembership(
                    s3_user_id=s3_user_id,
                    allow_manager_browser_data_access=existing_permissions.get(
                        s3_user_id,
                        False,
                    ),
                )
                for s3_user_id in s3_user_ids
            ]
        if (
            preloaded_connection_links is not None
            and user.id in preloaded_connection_links
        ):
            s3_connection_ids = preloaded_connection_links[user.id]

        s3_user_names = (
            s3_user_labels
            if s3_user_labels is not None
            else load_s3_user_names(self.db, s3_user_ids)
        )
        s3_connection_names = (
            s3_connection_labels
            if s3_connection_labels is not None
            else load_shared_s3_connection_names(self.db, s3_connection_ids)
        )
        s3_user_details = [
            LinkedS3User(
                id=s3_user_id,
                name=s3_user_names.get(s3_user_id)
                or f"S3 User #{s3_user_id}",
            )
            for s3_user_id in s3_user_ids
        ]
        visible_connection_ids = [
            connection_id
            for connection_id in s3_connection_ids
            if connection_id in s3_connection_names
        ]
        s3_connection_details = [
            LinkedS3Connection(
                id=connection_id,
                name=s3_connection_names[connection_id],
            )
            for connection_id in visible_connection_ids
        ]
        group_names = self._group_names(group_ids)
        group_details = [
            LinkedUiGroup(
                id=group_id,
                name=group_names.get(group_id) or f"Group #{group_id}",
            )
            for group_id in group_ids
        ]

        return UserOut(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            display_name=user.display_name or user.full_name,
            picture_url=user.picture_url,
            avatar=UserAvatarService(self.db).descriptor(user),
            is_active=user.is_active,
            is_admin=is_admin_ui_role(user.role),
            role=user.role,
            is_root=user.is_root,
            can_access_ceph_admin=bool(user.can_access_ceph_admin),
            can_access_storage_ops=bool(user.can_access_storage_ops),
            can_create_manual_private_connections=bool(
                user.can_create_manual_private_connections
            ),
            can_provision_managed_private_connections=bool(
                user.can_provision_managed_private_connections
            ),
            manager_tool_access=ManagerToolAccess(
                bucket_compare=bool(user.can_access_manager_bucket_compare),
                bucket_integrity_check=bool(
                    user.can_access_manager_bucket_integrity_check
                ),
                bucket_migration=bool(user.can_access_manager_bucket_migration),
                feature_rules=bool(user.can_access_manager_feature_rules),
                bucket_purge=bool(user.can_access_manager_bucket_purge),
            ),
            browser_advanced_features_enabled=bool(
                user.browser_advanced_features_enabled
            ),
            ui_language=user.ui_language,
            quota_alerts_enabled=bool(user.quota_alerts_enabled),
            quota_alerts_global_watch=bool(user.quota_alerts_global_watch),
            ui_preferences=UiPreferences.model_validate_json(
                user.ui_preferences_json
            ),
            account_links=account_links,
            group_details=group_details,
            s3_user_links=s3_user_links,
            s3_user_details=s3_user_details,
            s3_connection_details=s3_connection_details,
            effective_access=EffectiveAccessService(
                self.db
            ).to_user_effective_access(user),
            auth_provider=user.auth_provider,
            last_login_at=user.last_login_at,
        )

    def _account_links(self, user: User) -> list[AccountMembershipDetail]:
        try:
            links = getattr(user, "account_links", None)
            if links is not None:
                return [
                    AccountMembershipDetail(
                        account_id=link.account_id,
                        role=link.role,
                        allow_manager_browser_data_access=bool(
                            link.allow_manager_browser_data_access
                        ),
                        is_root=bool(link.is_root),
                    )
                    for link in links
                ]
        except DetachedInstanceError:
            pass
        rows = (
            self.db.query(
                UserS3Account.account_id,
                UserS3Account.role,
                UserS3Account.allow_manager_browser_data_access,
                UserS3Account.is_root,
            )
            .filter(UserS3Account.user_id == user.id)
            .all()
        )
        return [
            AccountMembershipDetail(
                account_id=row[0],
                role=row[1],
                allow_manager_browser_data_access=bool(row[2]),
                is_root=bool(row[3]),
            )
            for row in rows
        ]

    def _group_ids(self, user: User) -> list[int]:
        try:
            links = getattr(user, "ui_group_links", None)
            if links is not None:
                return [link.group_id for link in links]
        except DetachedInstanceError:
            pass
        return [
            row[0]
            for row in self.db.query(UserUiGroup.group_id)
            .filter(UserUiGroup.user_id == user.id)
            .all()
        ]

    def _s3_user_links(
        self,
        user: User,
    ) -> tuple[list[int], list[S3UserMembership]]:
        try:
            links = getattr(user, "s3_user_links", None)
            if links is not None:
                return (
                    [link.s3_user_id for link in links],
                    [
                        S3UserMembership(
                            s3_user_id=link.s3_user_id,
                            allow_manager_browser_data_access=bool(
                                link.allow_manager_browser_data_access
                            ),
                        )
                        for link in links
                    ],
                )
        except DetachedInstanceError:
            pass
        rows = (
            self.db.query(UserS3User)
            .filter(UserS3User.user_id == user.id)
            .all()
        )
        return (
            [row.s3_user_id for row in rows],
            [
                S3UserMembership(
                    s3_user_id=row.s3_user_id,
                    allow_manager_browser_data_access=bool(
                        row.allow_manager_browser_data_access
                    ),
                )
                for row in rows
            ],
        )

    def _s3_connection_ids(self, user: User) -> list[int]:
        try:
            links = getattr(user, "s3_connection_links", None)
            if links is not None:
                return [link.s3_connection_id for link in links]
        except DetachedInstanceError:
            pass
        return [
            row[0]
            for row in self.db.query(UserS3Connection.s3_connection_id)
            .filter(UserS3Connection.user_id == user.id)
            .all()
        ]

    def _group_names(self, group_ids: list[int]) -> dict[int, str]:
        if not group_ids:
            return {}
        rows = (
            self.db.query(UiGroup.id, UiGroup.name)
            .filter(UiGroup.id.in_(group_ids))
            .all()
        )
        return {row[0]: row[1] for row in rows}
