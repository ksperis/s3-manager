# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.db import (
    S3Connection,
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
from app.services.association_names import load_s3_user_names
from app.services.effective_access_service import EffectiveAccessService
from app.services.user_avatar_service import UserAvatarService


@dataclass(frozen=True)
class UserOutputPreload:
    account_links_by_user: dict[int, list[AccountMembershipDetail]]
    group_ids_by_user: dict[int, list[int]]
    group_names: dict[int, str]
    s3_user_links_by_user: dict[int, list[S3UserMembership]]
    s3_user_names: dict[int, str]
    connection_ids_by_user: dict[int, list[int]]
    connection_names: dict[int, str]


class UserOutputService:
    """Build the complete public user projection from direct and effective access."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def preload(self, users: list[User]) -> UserOutputPreload:
        user_ids = [int(user.id) for user in users]
        account_links_by_user: dict[int, list[AccountMembershipDetail]] = {
            user_id: [] for user_id in user_ids
        }
        group_ids_by_user: dict[int, list[int]] = {
            user_id: [] for user_id in user_ids
        }
        s3_user_links_by_user: dict[int, list[S3UserMembership]] = {
            user_id: [] for user_id in user_ids
        }
        connection_ids_by_user: dict[int, list[int]] = {
            user_id: [] for user_id in user_ids
        }
        if not user_ids:
            return UserOutputPreload(
                account_links_by_user=account_links_by_user,
                group_ids_by_user=group_ids_by_user,
                group_names={},
                s3_user_links_by_user=s3_user_links_by_user,
                s3_user_names={},
                connection_ids_by_user=connection_ids_by_user,
                connection_names={},
            )

        account_rows = (
            self.db.query(UserS3Account)
            .filter(UserS3Account.user_id.in_(user_ids))
            .order_by(UserS3Account.id.asc())
            .all()
        )
        for link in account_rows:
            account_links_by_user[int(link.user_id)].append(
                AccountMembershipDetail(
                    account_id=link.account_id,
                    role=link.role,
                    allow_manager_browser_data_access=bool(
                        link.allow_manager_browser_data_access
                    ),
                    is_root=bool(link.is_root),
                )
            )

        group_rows = (
            self.db.query(UserUiGroup, UiGroup.name)
            .join(UiGroup, UiGroup.id == UserUiGroup.group_id)
            .filter(UserUiGroup.user_id.in_(user_ids))
            .order_by(UserUiGroup.id.asc())
            .all()
        )
        group_names: dict[int, str] = {}
        for link, group_name in group_rows:
            group_id = int(link.group_id)
            group_ids_by_user[int(link.user_id)].append(group_id)
            group_names[group_id] = group_name

        s3_user_rows = (
            self.db.query(UserS3User)
            .filter(UserS3User.user_id.in_(user_ids))
            .order_by(UserS3User.id.asc())
            .all()
        )
        s3_user_ids: set[int] = set()
        for link in s3_user_rows:
            s3_user_id = int(link.s3_user_id)
            s3_user_ids.add(s3_user_id)
            s3_user_links_by_user[int(link.user_id)].append(
                S3UserMembership(
                    s3_user_id=s3_user_id,
                    allow_manager_browser_data_access=bool(
                        link.allow_manager_browser_data_access
                    ),
                )
            )

        connection_rows = (
            self.db.query(UserS3Connection, S3Connection.name)
            .join(
                S3Connection,
                S3Connection.id == UserS3Connection.s3_connection_id,
            )
            .filter(
                UserS3Connection.user_id.in_(user_ids),
                S3Connection.is_shared.is_(True),
            )
            .order_by(UserS3Connection.id.asc())
            .all()
        )
        connection_names: dict[int, str] = {}
        for link, connection_name in connection_rows:
            connection_id = int(link.s3_connection_id)
            connection_ids_by_user[int(link.user_id)].append(connection_id)
            connection_names[connection_id] = connection_name

        return UserOutputPreload(
            account_links_by_user=account_links_by_user,
            group_ids_by_user=group_ids_by_user,
            group_names=group_names,
            s3_user_links_by_user=s3_user_links_by_user,
            s3_user_names=load_s3_user_names(self.db, sorted(s3_user_ids)),
            connection_ids_by_user=connection_ids_by_user,
            connection_names=connection_names,
        )

    def to_out(
        self,
        user: User,
        *,
        preloaded: UserOutputPreload | None = None,
    ) -> UserOut:
        projection = preloaded or self.preload([user])
        user_id = int(user.id)
        account_links = projection.account_links_by_user.get(user_id, [])
        group_ids = projection.group_ids_by_user.get(user_id, [])
        s3_user_links = projection.s3_user_links_by_user.get(user_id, [])
        s3_user_ids = [link.s3_user_id for link in s3_user_links]
        s3_connection_ids = projection.connection_ids_by_user.get(user_id, [])
        s3_user_names = projection.s3_user_names
        s3_connection_names = projection.connection_names
        group_names = projection.group_names
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
            has_local_password=bool(user.hashed_password),
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
            last_login_at=user.last_login_at,
        )
