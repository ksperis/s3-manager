# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.db import (
    AccountRole,
    S3Connection,
    S3User,
    UiGroup,
    UiGroupS3Account,
    UiGroupS3Connection,
    UiGroupS3User,
    User,
    UserRole,
    UserS3Account,
    UserS3Connection,
    UserS3User,
    UserUiGroup,
    is_admin_ui_role,
)
from app.models.user import (
    AccountMembership,
    EffectiveUserAccess,
    LinkedS3Connection,
    LinkedS3User,
    LinkedUiGroup,
    ManagerToolAccess,
)


MANAGER_TOOL_ROLES = {
    UserRole.UI_SUPERADMIN.value,
    UserRole.UI_ADMIN.value,
    UserRole.UI_USER.value,
}

_PORTAL_ROLE_RANK = {
    AccountRole.PORTAL_NONE.value: 0,
    AccountRole.PORTAL_USER.value: 1,
    AccountRole.PORTAL_MANAGER.value: 2,
}
_PORTAL_ROLE_BY_RANK = {
    rank: role
    for role, rank in _PORTAL_ROLE_RANK.items()
}


@dataclass(frozen=True)
class EffectiveAccountLink:
    account_id: int
    account_admin: bool = False
    is_root: bool = False
    account_role: str = AccountRole.PORTAL_NONE.value


@dataclass
class ResolvedUserAccess:
    group_ids: list[int]
    group_details: list[LinkedUiGroup]
    account_links: list[EffectiveAccountLink]
    s3_user_ids: list[int]
    s3_connection_ids: list[int]
    can_access_ceph_admin: bool
    can_access_storage_ops: bool
    manager_tool_access: ManagerToolAccess
    browser_advanced_features_enabled: bool

    @property
    def account_ids(self) -> list[int]:
        return [link.account_id for link in self.account_links]

    def account_link_for(self, account_id: int) -> EffectiveAccountLink | None:
        for link in self.account_links:
            if link.account_id == account_id:
                return link
        return None

    def has_s3_user(self, s3_user_id: int) -> bool:
        return s3_user_id in set(self.s3_user_ids)

    def has_s3_connection(self, connection_id: int) -> bool:
        return connection_id in set(self.s3_connection_ids)


class EffectiveAccessService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def resolve_user(self, user: User) -> ResolvedUserAccess:
        group_rows = (
            self.db.query(UiGroup.id, UiGroup.name)
            .join(UserUiGroup, UserUiGroup.group_id == UiGroup.id)
            .filter(UserUiGroup.user_id == user.id)
            .order_by(UiGroup.name.asc(), UiGroup.id.asc())
            .all()
        )
        group_ids = [row[0] for row in group_rows]
        group_details = [LinkedUiGroup(id=row[0], name=row[1]) for row in group_rows]
        groups = self.db.query(UiGroup).filter(UiGroup.id.in_(group_ids)).all() if group_ids else []

        account_by_id: dict[int, EffectiveAccountLink] = {}
        direct_account_links = (
            self.db.query(UserS3Account)
            .filter(UserS3Account.user_id == user.id)
            .all()
        )
        for link in direct_account_links:
            self._merge_account_link(
                account_by_id,
                account_id=link.account_id,
                account_admin=bool(link.account_admin or link.is_root),
                is_root=bool(link.is_root),
                account_role=link.account_role,
            )

        if group_ids:
            group_account_links = (
                self.db.query(UiGroupS3Account)
                .filter(UiGroupS3Account.group_id.in_(group_ids))
                .all()
            )
            for link in group_account_links:
                self._merge_account_link(
                    account_by_id,
                    account_id=link.account_id,
                    account_admin=bool(link.account_admin),
                    is_root=False,
                    account_role=link.account_role,
                )

        s3_user_ids = {
            row[0]
            for row in self.db.query(UserS3User.s3_user_id)
            .filter(UserS3User.user_id == user.id)
            .all()
        }
        if group_ids:
            s3_user_ids.update(
                row[0]
                for row in self.db.query(UiGroupS3User.s3_user_id)
                .filter(UiGroupS3User.group_id.in_(group_ids))
                .all()
            )

        s3_connection_ids = {
            row[0]
            for row in self.db.query(UserS3Connection.s3_connection_id)
            .filter(UserS3Connection.user_id == user.id)
            .all()
        }
        if group_ids:
            s3_connection_ids.update(
                row[0]
                for row in self.db.query(UiGroupS3Connection.s3_connection_id)
                .filter(UiGroupS3Connection.group_id.in_(group_ids))
                .all()
            )

        role_supports_manager_tools = user.role in MANAGER_TOOL_ROLES
        can_access_ceph_admin = (
            bool(user.can_access_ceph_admin) or any(bool(group.can_access_ceph_admin) for group in groups)
        ) and is_admin_ui_role(user.role)
        can_access_storage_ops = (
            bool(user.can_access_storage_ops) or any(bool(group.can_access_storage_ops) for group in groups)
        ) and role_supports_manager_tools
        manager_tool_access = ManagerToolAccess(
            bucket_compare=role_supports_manager_tools
            and (
                bool(user.can_access_manager_bucket_compare)
                or any(bool(group.can_access_manager_bucket_compare) for group in groups)
            ),
            bucket_integrity_check=role_supports_manager_tools
            and (
                bool(user.can_access_manager_bucket_integrity_check)
                or any(bool(group.can_access_manager_bucket_integrity_check) for group in groups)
            ),
            bucket_migration=role_supports_manager_tools
            and (
                bool(user.can_access_manager_bucket_migration)
                or any(bool(group.can_access_manager_bucket_migration) for group in groups)
            ),
            feature_rules=role_supports_manager_tools
            and (
                bool(user.can_access_manager_feature_rules)
                or any(bool(group.can_access_manager_feature_rules) for group in groups)
            ),
            bucket_quota=role_supports_manager_tools
            and (
                bool(user.can_access_manager_bucket_quota)
                or any(bool(group.can_access_manager_bucket_quota) for group in groups)
            ),
            ceph_s3_user_keys=role_supports_manager_tools
            and (
                bool(user.can_access_manager_ceph_s3_user_keys)
                or any(bool(group.can_access_manager_ceph_s3_user_keys) for group in groups)
            ),
        )
        browser_advanced_features_enabled = bool(user.browser_advanced_features_enabled) or any(
            bool(group.browser_advanced_features_enabled) for group in groups
        )

        return ResolvedUserAccess(
            group_ids=group_ids,
            group_details=group_details,
            account_links=sorted(account_by_id.values(), key=lambda link: link.account_id),
            s3_user_ids=sorted(s3_user_ids),
            s3_connection_ids=sorted(s3_connection_ids),
            can_access_ceph_admin=can_access_ceph_admin,
            can_access_storage_ops=can_access_storage_ops,
            manager_tool_access=manager_tool_access,
            browser_advanced_features_enabled=browser_advanced_features_enabled,
        )

    def to_user_effective_access(self, user: User) -> EffectiveUserAccess:
        resolved = self.resolve_user(user)
        s3_user_names = self._load_s3_user_names(resolved.s3_user_ids)
        s3_connection_names = self._load_s3_connection_names(resolved.s3_connection_ids)
        return EffectiveUserAccess(
            can_access_ceph_admin=resolved.can_access_ceph_admin,
            can_access_storage_ops=resolved.can_access_storage_ops,
            manager_tool_access=resolved.manager_tool_access,
            browser_advanced_features_enabled=resolved.browser_advanced_features_enabled,
            accounts=resolved.account_ids,
            account_links=[
                AccountMembership(
                    account_id=link.account_id,
                    account_admin=link.account_admin,
                    account_role=link.account_role,
                )
                for link in resolved.account_links
            ],
            s3_users=resolved.s3_user_ids,
            s3_user_details=[
                LinkedS3User(id=s3_id, name=s3_user_names.get(s3_id) or f"S3 User #{s3_id}")
                for s3_id in resolved.s3_user_ids
            ],
            s3_connections=resolved.s3_connection_ids,
            s3_connection_details=[
                LinkedS3Connection(
                    id=conn_id,
                    name=(details[0] if details else f"Connection #{conn_id}"),
                    access_manager=(details[1] if details else None),
                    access_browser=(details[2] if details else None),
                )
                for conn_id in resolved.s3_connection_ids
                for details in [s3_connection_names.get(conn_id)]
            ],
        )

    def _merge_account_link(
        self,
        account_by_id: dict[int, EffectiveAccountLink],
        *,
        account_id: int,
        account_admin: bool,
        is_root: bool,
        account_role: str | None,
    ) -> None:
        current = account_by_id.get(account_id)
        next_role = self._max_portal_role(current.account_role if current else None, account_role)
        account_by_id[account_id] = EffectiveAccountLink(
            account_id=account_id,
            account_admin=bool(account_admin or (current.account_admin if current else False)),
            is_root=bool(is_root or (current.is_root if current else False)),
            account_role=next_role,
        )

    def _max_portal_role(self, left: str | None, right: str | None) -> str:
        left_rank = _PORTAL_ROLE_RANK.get(left or AccountRole.PORTAL_NONE.value, 0)
        right_rank = _PORTAL_ROLE_RANK.get(right or AccountRole.PORTAL_NONE.value, 0)
        return _PORTAL_ROLE_BY_RANK.get(max(left_rank, right_rank), AccountRole.PORTAL_NONE.value)

    def _load_s3_user_names(self, ids: list[int]) -> dict[int, str]:
        if not ids:
            return {}
        rows = self.db.query(S3User.id, S3User.name).filter(S3User.id.in_(ids)).all()
        return {row[0]: row[1] for row in rows}

    def _load_s3_connection_names(self, ids: list[int]) -> dict[int, tuple[str, bool, bool]]:
        if not ids:
            return {}
        rows = (
            self.db.query(
                S3Connection.id,
                S3Connection.name,
                S3Connection.access_manager,
                S3Connection.access_browser,
            )
            .filter(S3Connection.id.in_(ids))
            .all()
        )
        return {row[0]: (row[1], bool(row[2]), bool(row[3])) for row in rows}
