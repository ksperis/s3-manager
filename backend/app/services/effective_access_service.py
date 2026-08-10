# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Central authorization policy for UI-user storage execution contexts."""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy.orm import Session, joinedload

from app.db import (
    AccountRole,
    S3Account,
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
    EffectiveAccountGroupSource,
    EffectiveAccountMembership,
    EffectiveAccountRoleProvenance,
    EffectiveUserAccess,
    LinkedS3Connection,
    LinkedS3User,
    LinkedUiGroup,
    ManagerToolAccess,
)
from app.models.access_context import EffectiveAccountGroupRole, EffectiveAccountLink
from app.services.association_names import load_s3_user_names, load_shared_s3_connection_names
from app.utils.account_roles import max_account_role
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.time import utcnow


MANAGER_TOOL_ROLES = {
    UserRole.UI_SUPERADMIN.value,
    UserRole.UI_ADMIN.value,
    UserRole.UI_USER.value,
}


@dataclass
class _AccountRoleAccumulator:
    account_id: int
    is_root: bool = False
    direct_role: str | None = None
    direct_allow_manager_browser_data_access: bool = False
    group_roles: list[tuple[int, str, str, bool]] = field(default_factory=list)

    def build(self) -> EffectiveAccountLink:
        direct_role = (
            AccountRole.ACCOUNT_ADMINISTRATOR.value
            if self.is_root
            else self.direct_role
        )
        role = max_account_role(direct_role, *(source[2] for source in self.group_roles))
        if role is None:
            raise ValueError("Account association has no canonical role")
        return EffectiveAccountLink(
            account_id=self.account_id,
            role=role,
            is_root=self.is_root,
            direct_role=direct_role,
            direct_determines_effective_role=direct_role == role,
            direct_allow_manager_browser_data_access=(
                self.direct_allow_manager_browser_data_access
            ),
            group_sources=tuple(
                EffectiveAccountGroupRole(
                    group_id=group_id,
                    group_name=group_name,
                    role=group_role,
                    determines_effective_role=group_role == role,
                    allow_manager_browser_data_access=allow_manager_browser_data_access,
                )
                for group_id, group_name, group_role, allow_manager_browser_data_access in sorted(
                    self.group_roles,
                    key=lambda source: (source[1].lower(), source[0]),
                )
            ),
        )


@dataclass
class ResolvedUserAccess:
    group_ids: list[int]
    group_details: list[LinkedUiGroup]
    account_links: list[EffectiveAccountLink]
    s3_user_ids: list[int]
    manager_browser_s3_user_ids: list[int]
    s3_connection_ids: list[int]
    can_access_ceph_admin: bool
    can_access_storage_ops: bool
    can_create_manual_private_connections: bool
    can_provision_managed_private_connections: bool
    has_owned_private_connections: bool
    manager_tool_access: ManagerToolAccess
    browser_advanced_features_enabled: bool

    @property
    def account_ids(self) -> list[int]:
        return [link.account_id for link in self.account_links]

    def account_link_for(self, account_id: int) -> EffectiveAccountLink | None:
        return next((link for link in self.account_links if link.account_id == account_id), None)

    def has_s3_user(self, s3_user_id: int) -> bool:
        return s3_user_id in set(self.s3_user_ids)

    def can_browse_s3_user(self, s3_user_id: int) -> bool:
        return s3_user_id in set(self.manager_browser_s3_user_ids)

class EffectiveAccessService:
    """Single source for role aggregation and executable UI-user contexts."""

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
        group_ids = [int(row[0]) for row in group_rows]
        group_names = {int(row[0]): str(row[1]) for row in group_rows}
        group_details = [LinkedUiGroup(id=row[0], name=row[1]) for row in group_rows]
        groups = self.db.query(UiGroup).filter(UiGroup.id.in_(group_ids)).all() if group_ids else []

        account_by_id: dict[int, _AccountRoleAccumulator] = {}
        direct_links = self.db.query(UserS3Account).filter(UserS3Account.user_id == user.id).all()
        for link in direct_links:
            accumulator = account_by_id.setdefault(
                int(link.account_id),
                _AccountRoleAccumulator(account_id=int(link.account_id)),
            )
            accumulator.is_root = bool(accumulator.is_root or link.is_root)
            accumulator.direct_role = (
                AccountRole.ACCOUNT_ADMINISTRATOR.value
                if link.is_root
                else str(link.role)
            )
            accumulator.direct_allow_manager_browser_data_access = bool(
                link.allow_manager_browser_data_access
            )

        if group_ids:
            group_links = (
                self.db.query(UiGroupS3Account)
                .filter(UiGroupS3Account.group_id.in_(group_ids))
                .all()
            )
            for link in group_links:
                accumulator = account_by_id.setdefault(
                    int(link.account_id),
                    _AccountRoleAccumulator(account_id=int(link.account_id)),
                )
                accumulator.group_roles.append(
                    (
                        int(link.group_id),
                        group_names.get(int(link.group_id), f"Group #{link.group_id}"),
                        str(link.role),
                        bool(link.allow_manager_browser_data_access),
                    )
                )

        direct_s3_user_rows = self.db.query(
            UserS3User.s3_user_id,
            UserS3User.allow_manager_browser_data_access,
        ).filter(UserS3User.user_id == user.id).all()
        s3_user_ids = {
            int(row[0])
            for row in direct_s3_user_rows
        }
        manager_browser_s3_user_ids = {
            int(row[0]) for row in direct_s3_user_rows if bool(row[1])
        }
        if group_ids:
            group_s3_user_rows = self.db.query(
                UiGroupS3User.s3_user_id,
                UiGroupS3User.allow_manager_browser_data_access,
            ).filter(UiGroupS3User.group_id.in_(group_ids)).all()
            s3_user_ids.update(int(row[0]) for row in group_s3_user_rows)
            manager_browser_s3_user_ids.update(
                int(row[0]) for row in group_s3_user_rows if bool(row[1])
            )

        shared_connection_ids = {
            int(row[0])
            for row in self.db.query(UserS3Connection.s3_connection_id)
            .join(S3Connection, S3Connection.id == UserS3Connection.s3_connection_id)
            .filter(UserS3Connection.user_id == user.id)
            .filter(
                S3Connection.is_shared.is_(True),
                S3Connection.is_temporary.is_(False),
            )
            .all()
        }
        if group_ids:
            shared_connection_ids.update(
                int(row[0])
                for row in self.db.query(UiGroupS3Connection.s3_connection_id)
                .join(S3Connection, S3Connection.id == UiGroupS3Connection.s3_connection_id)
                .filter(UiGroupS3Connection.group_id.in_(group_ids))
                .filter(
                    S3Connection.is_shared.is_(True),
                    S3Connection.is_temporary.is_(False),
                )
                .all()
            )

        role_supports_tools = user.role in MANAGER_TOOL_ROLES
        can_access_ceph_admin = (
            bool(user.can_access_ceph_admin)
            or any(bool(group.can_access_ceph_admin) for group in groups)
        ) and is_admin_ui_role(user.role)
        can_access_storage_ops = (
            bool(user.can_access_storage_ops)
            or any(bool(group.can_access_storage_ops) for group in groups)
        ) and role_supports_tools
        manager_tool_access = ManagerToolAccess(
            **{
                output_name: role_supports_tools
                and (
                    bool(getattr(user, user_field))
                    or any(bool(getattr(group, user_field)) for group in groups)
                )
                for output_name, user_field in {
                    "bucket_compare": "can_access_manager_bucket_compare",
                    "bucket_integrity_check": "can_access_manager_bucket_integrity_check",
                    "bucket_migration": "can_access_manager_bucket_migration",
                    "feature_rules": "can_access_manager_feature_rules",
                    "bucket_purge": "can_access_manager_bucket_purge",
                }.items()
            }
        )
        browser_advanced = bool(user.browser_advanced_features_enabled) or any(
            bool(group.browser_advanced_features_enabled) for group in groups
        )
        can_create_manual_private_connections = role_supports_tools and (
            bool(user.can_create_manual_private_connections)
            or any(bool(group.can_create_manual_private_connections) for group in groups)
        )
        can_provision_managed_private_connections = role_supports_tools and (
            bool(user.can_provision_managed_private_connections)
            or any(bool(group.can_provision_managed_private_connections) for group in groups)
        )
        has_owned_private_connections = (
            self.db.query(S3Connection.id)
            .filter(
                S3Connection.created_by_user_id == user.id,
                S3Connection.is_shared.is_(False),
                S3Connection.is_temporary.is_(False),
            )
            .first()
            is not None
        )

        return ResolvedUserAccess(
            group_ids=group_ids,
            group_details=group_details,
            account_links=sorted(
                (accumulator.build() for accumulator in account_by_id.values()),
                key=lambda link: link.account_id,
            ),
            s3_user_ids=sorted(s3_user_ids),
            manager_browser_s3_user_ids=sorted(manager_browser_s3_user_ids),
            s3_connection_ids=sorted(shared_connection_ids),
            can_access_ceph_admin=can_access_ceph_admin,
            can_access_storage_ops=can_access_storage_ops,
            can_create_manual_private_connections=can_create_manual_private_connections,
            can_provision_managed_private_connections=can_provision_managed_private_connections,
            has_owned_private_connections=has_owned_private_connections,
            manager_tool_access=manager_tool_access,
            browser_advanced_features_enabled=browser_advanced,
        )

    def list_workspace_connections(
        self,
        user: User,
        *,
        workspace: str,
        resolved: ResolvedUserAccess | None = None,
    ) -> list[S3Connection]:
        if workspace not in {"manager", "browser"}:
            raise ValueError("Unsupported workspace")
        effective = resolved or self.resolve_user(user)
        now = utcnow()
        query = self.db.query(S3Connection).filter(
            S3Connection.is_active.is_(True),
            S3Connection.is_temporary.is_(False),
            (S3Connection.expires_at.is_(None)) | (S3Connection.expires_at > now),
        )
        if workspace == "browser":
            return query.filter(
                S3Connection.is_shared.is_(False),
                S3Connection.created_by_user_id == user.id,
                S3Connection.access_browser.is_(True),
            ).all()
        return query.filter(
            S3Connection.access_manager.is_(True),
            S3Connection.remediation_required.is_(False),
            (
                (S3Connection.is_shared.is_(False))
                & (S3Connection.created_by_user_id == user.id)
            )
            | (
                (S3Connection.is_shared.is_(True))
                & (S3Connection.id.in_(effective.s3_connection_ids))
            ),
        ).all()

    def connection_is_allowed(
        self,
        user: User,
        connection: S3Connection,
        *,
        workspace: str,
        resolved: ResolvedUserAccess | None = None,
    ) -> bool:
        return any(
            candidate.id == connection.id
            for candidate in self.list_workspace_connections(user, workspace=workspace, resolved=resolved)
        )

    def manager_browser_connection_is_allowed(
        self,
        user: User,
        connection: S3Connection,
    ) -> bool:
        now = utcnow()
        return bool(
            not connection.is_shared
            and connection.created_by_user_id == user.id
            and connection.is_active
            and not connection.is_temporary
            and (connection.expires_at is None or connection.expires_at > now)
            and not connection.remediation_required
            and connection.access_manager
            and connection.access_browser
        )

    @staticmethod
    def portal_account_is_compatible(account: object) -> bool:
        endpoint = getattr(account, "storage_endpoint", None)
        return bool(
            getattr(account, "rgw_account_id", None)
            and endpoint is not None
            and str(getattr(endpoint, "provider", "")).strip().lower() == "ceph"
            and resolve_feature_flags(endpoint).iam_enabled
        )

    def list_portal_accounts(
        self,
        user: User,
        *,
        resolved: ResolvedUserAccess | None = None,
    ) -> list[S3Account]:
        effective = resolved or self.resolve_user(user)
        account_ids = [
            link.account_id
            for link in effective.account_links
            if link.portal_role is not None
        ]
        if not account_ids:
            return []
        accounts = (
            self.db.query(S3Account)
            .options(joinedload(S3Account.storage_endpoint))
            .filter(S3Account.id.in_(account_ids))
            .all()
        )
        return [account for account in accounts if self.portal_account_is_compatible(account)]

    def list_browser_portal_accounts(
        self,
        user: User,
        *,
        resolved: ResolvedUserAccess | None = None,
    ) -> list[tuple[S3Account, EffectiveAccountLink]]:
        """Return Portal identities explicitly exposed in standalone Browser."""
        from app.services.app_settings_service import load_app_settings
        from app.services.portal_service import PortalService

        settings = load_app_settings()
        if not (
            settings.general.browser_enabled
            and settings.general.browser_root_enabled
            and settings.general.portal_enabled
            and settings.general.browser_portal_enabled
        ):
            return []

        effective = resolved or self.resolve_user(user)
        links_by_account_id = {
            link.account_id: link
            for link in effective.account_links
            if link.portal_role is not None
        }
        if not links_by_account_id:
            return []

        portal_service = PortalService(self.db)
        return [
            (account, links_by_account_id[account.id])
            for account in self.list_portal_accounts(user, resolved=effective)
            if account.id in links_by_account_id
            and portal_service.get_effective_portal_settings(
                account,
                base_settings=settings.portal,
            ).browser_access_enabled
        ]

    @staticmethod
    def manager_account_allowed(role_or_link: object) -> bool:
        role = getattr(role_or_link, "role", role_or_link)
        return role == AccountRole.ACCOUNT_ADMINISTRATOR.value

    def to_user_effective_access(self, user: User) -> EffectiveUserAccess:
        resolved = self.resolve_user(user)
        s3_user_names = load_s3_user_names(self.db, resolved.s3_user_ids)
        shared_connection_names = load_shared_s3_connection_names(
            self.db,
            resolved.s3_connection_ids,
            exclude_temporary=False,
        )
        return EffectiveUserAccess(
            can_access_ceph_admin=resolved.can_access_ceph_admin,
            can_access_storage_ops=resolved.can_access_storage_ops,
            can_create_manual_private_connections=resolved.can_create_manual_private_connections,
            can_provision_managed_private_connections=resolved.can_provision_managed_private_connections,
            has_owned_private_connections=resolved.has_owned_private_connections,
            manager_tool_access=resolved.manager_tool_access,
            browser_advanced_features_enabled=resolved.browser_advanced_features_enabled,
            accounts=resolved.account_ids,
            account_links=[
                EffectiveAccountMembership(
                    account_id=link.account_id,
                    role=link.role,
                    allow_manager_browser_data_access=link.manager_browser_allowed,
                    provenance=EffectiveAccountRoleProvenance(
                        direct_role=link.direct_role,
                        direct_determines_effective_role=link.direct_determines_effective_role,
                        direct_allow_manager_browser_data_access=(
                            link.direct_allow_manager_browser_data_access
                        ),
                        groups=[
                            EffectiveAccountGroupSource(
                                group_id=source.group_id,
                                group_name=source.group_name,
                                role=source.role,
                                determines_effective_role=source.determines_effective_role,
                                allow_manager_browser_data_access=(
                                    source.allow_manager_browser_data_access
                                ),
                            )
                            for source in link.group_sources
                        ],
                    ),
                )
                for link in resolved.account_links
            ],
            s3_users=resolved.s3_user_ids,
            manager_browser_s3_users=resolved.manager_browser_s3_user_ids,
            s3_user_details=[
                LinkedS3User(id=s3_id, name=s3_user_names.get(s3_id) or f"S3 User #{s3_id}")
                for s3_id in resolved.s3_user_ids
            ],
            s3_connections=resolved.s3_connection_ids,
            s3_connection_details=[
                LinkedS3Connection(
                    id=conn_id,
                    name=(details if details else f"Connection #{conn_id}"),
                )
                for conn_id in resolved.s3_connection_ids
                for details in [shared_connection_names.get(conn_id)]
            ],
        )
