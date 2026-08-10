# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, aliased

from app.db import (
    S3Account,
    S3Connection,
    S3User,
    UiGroup,
    UiGroupS3Account,
    UiGroupS3Connection,
    UiGroupS3User,
    User,
    UserUiGroup,
)
from app.models.ui_group import LinkedS3Account, UiGroupCreate, UiGroupOut, UiGroupSummary, UiGroupUpdate
from app.models.user import (
    AccountMembership,
    LinkedS3Connection,
    LinkedS3User,
    ManagerToolAccess,
    S3UserMembership,
    UserSummary,
)
from app.services.ui_group_avatar_service import UiGroupAvatarService
from app.services.user_avatar_service import UserAvatarService
from app.services.association_names import load_s3_user_names, load_shared_s3_connection_names
from app.services.portal_role_sync import (
    capture_effective_portal_roles,
    sync_portal_role_downgrades,
    sync_portal_role_promotions,
)
from app.utils.normalize import normalize_optional_string
from app.utils.time import utcnow
from app.utils.account_roles import require_account_role

class UiGroupsService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create_group(self, payload: UiGroupCreate) -> UiGroup:
        name = self._normalize_name(payload.name)
        if self.db.query(UiGroup).filter(func.lower(UiGroup.name) == name.lower()).first():
            raise ValueError("UI group already exists")
        affected_user_ids = {int(user_id) for user_id in payload.user_ids}
        affected_account_ids = {int(link.account_id) for link in payload.account_links}
        portal_roles_before = capture_effective_portal_roles(
            self.db,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
        )
        manager_tool_access = payload.manager_tool_access or ManagerToolAccess()
        now = utcnow()
        group = UiGroup(
            name=name,
            description=normalize_optional_string(payload.description),
            can_access_ceph_admin=bool(payload.can_access_ceph_admin),
            can_access_storage_ops=bool(payload.can_access_storage_ops),
            can_create_manual_private_connections=bool(payload.can_create_manual_private_connections),
            can_provision_managed_private_connections=bool(payload.can_provision_managed_private_connections),
            can_access_manager_bucket_compare=bool(manager_tool_access.bucket_compare),
            can_access_manager_bucket_integrity_check=bool(manager_tool_access.bucket_integrity_check),
            can_access_manager_bucket_migration=bool(manager_tool_access.bucket_migration),
            can_access_manager_feature_rules=bool(manager_tool_access.feature_rules),
            can_access_manager_bucket_purge=bool(manager_tool_access.bucket_purge),
            browser_advanced_features_enabled=bool(payload.browser_advanced_features_enabled),
            created_at=now,
            updated_at=now,
        )
        self.db.add(group)
        self.db.flush()
        UiGroupAvatarService(self.db).set_choice(group, payload.avatar_source, payload.avatar_icon)
        self._set_user_links(group, payload.user_ids)
        self._set_account_links(group, payload.account_links)
        if payload.s3_user_links is not None:
            self._set_s3_user_links(group, payload.s3_user_links)
        else:
            self._set_s3_user_ids(group, payload.s3_user_ids or [])
        self._set_s3_connection_links(group, payload.s3_connection_ids)
        self.db.flush()
        portal_roles_after = capture_effective_portal_roles(
            self.db,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
        )
        sync_portal_role_downgrades(self.db, before=portal_roles_before, after=portal_roles_after)
        self.db.commit()
        sync_portal_role_promotions(self.db, before=portal_roles_before, after=portal_roles_after)
        self.db.refresh(group)
        return group

    def update_group(self, group_id: int, payload: UiGroupUpdate) -> UiGroup:
        group = self.db.query(UiGroup).filter(UiGroup.id == group_id).first()
        if not group:
            raise ValueError("UI group not found")
        existing_user_ids = {
            row[0]
            for row in self.db.query(UserUiGroup.user_id).filter(UserUiGroup.group_id == group.id).all()
        }
        existing_account_ids = {
            row[0]
            for row in self.db.query(UiGroupS3Account.account_id).filter(UiGroupS3Account.group_id == group.id).all()
        }
        affected_user_ids = existing_user_ids | {
            int(user_id) for user_id in (payload.user_ids or [])
        }
        affected_account_ids = existing_account_ids | {
            int(link.account_id) for link in (payload.account_links or [])
        }
        portal_roles_before = capture_effective_portal_roles(
            self.db,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
        )
        if payload.name is not None:
            name = self._normalize_name(payload.name)
            existing = self.db.query(UiGroup).filter(func.lower(UiGroup.name) == name.lower()).first()
            if existing and existing.id != group.id:
                raise ValueError("UI group already exists")
            group.name = name
        if payload.description is not None:
            group.description = normalize_optional_string(payload.description)
        if payload.avatar_source is not None:
            UiGroupAvatarService(self.db).set_choice(group, payload.avatar_source, payload.avatar_icon)
        if payload.can_access_ceph_admin is not None:
            group.can_access_ceph_admin = bool(payload.can_access_ceph_admin)
        if payload.can_access_storage_ops is not None:
            group.can_access_storage_ops = bool(payload.can_access_storage_ops)
        if payload.can_create_manual_private_connections is not None:
            group.can_create_manual_private_connections = bool(payload.can_create_manual_private_connections)
        if payload.can_provision_managed_private_connections is not None:
            group.can_provision_managed_private_connections = bool(payload.can_provision_managed_private_connections)
        if payload.manager_tool_access is not None:
            group.can_access_manager_bucket_compare = bool(payload.manager_tool_access.bucket_compare)
            group.can_access_manager_bucket_integrity_check = bool(payload.manager_tool_access.bucket_integrity_check)
            group.can_access_manager_bucket_migration = bool(payload.manager_tool_access.bucket_migration)
            group.can_access_manager_feature_rules = bool(payload.manager_tool_access.feature_rules)
            group.can_access_manager_bucket_purge = bool(payload.manager_tool_access.bucket_purge)
        if payload.browser_advanced_features_enabled is not None:
            group.browser_advanced_features_enabled = bool(payload.browser_advanced_features_enabled)
        if payload.user_ids is not None:
            self._set_user_links(group, payload.user_ids)
        if payload.account_links is not None:
            self._set_account_links(group, payload.account_links)
        if payload.s3_user_links is not None:
            self._set_s3_user_links(group, payload.s3_user_links)
        elif payload.s3_user_ids is not None:
            self._set_s3_user_ids(group, payload.s3_user_ids)
        if payload.s3_connection_ids is not None:
            self._set_s3_connection_links(group, payload.s3_connection_ids)
        group.updated_at = utcnow()
        self.db.add(group)
        self.db.flush()
        portal_roles_after = capture_effective_portal_roles(
            self.db,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
        )
        try:
            sync_portal_role_downgrades(self.db, before=portal_roles_before, after=portal_roles_after)
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        sync_portal_role_promotions(self.db, before=portal_roles_before, after=portal_roles_after)
        self.db.refresh(group)
        return group

    def delete_group(self, group_id: int) -> None:
        group = self.db.query(UiGroup).filter(UiGroup.id == group_id).first()
        if not group:
            raise ValueError("UI group not found")
        affected_user_ids = {
            row[0]
            for row in self.db.query(UserUiGroup.user_id).filter(UserUiGroup.group_id == group.id).all()
        }
        affected_account_ids = {
            row[0]
            for row in self.db.query(UiGroupS3Account.account_id).filter(UiGroupS3Account.group_id == group.id).all()
        }
        portal_roles_before = capture_effective_portal_roles(
            self.db,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
        )
        self.db.delete(group)
        self.db.flush()
        portal_roles_after = capture_effective_portal_roles(
            self.db,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
        )
        try:
            sync_portal_role_downgrades(self.db, before=portal_roles_before, after=portal_roles_after)
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

    def get_group(self, group_id: int) -> Optional[UiGroup]:
        return self.db.query(UiGroup).filter(UiGroup.id == group_id).first()

    def list_groups_minimal(self) -> list[UiGroupSummary]:
        rows = self.db.query(UiGroup).order_by(UiGroup.name.asc()).all()
        avatar_service = UiGroupAvatarService(self.db)
        return [UiGroupSummary(id=row.id, name=row.name, avatar=avatar_service.descriptor(row)) for row in rows]

    def paginate_groups(
        self,
        *,
        page: int,
        page_size: int,
        search: Optional[str] = None,
        sort_field: str = "name",
        sort_direction: str = "asc",
    ) -> tuple[list[UiGroupOut], int]:
        query = self.db.query(UiGroup)
        search_value = search.strip() if isinstance(search, str) else ""
        if search_value:
            member = aliased(User)
            account = aliased(S3Account)
            s3_user = aliased(S3User)
            connection = aliased(S3Connection)
            pattern = f"%{search_value}%"
            query = (
                query.outerjoin(UserUiGroup, UiGroup.id == UserUiGroup.group_id)
                .outerjoin(member, UserUiGroup.user_id == member.id)
                .outerjoin(UiGroupS3Account, UiGroup.id == UiGroupS3Account.group_id)
                .outerjoin(account, UiGroupS3Account.account_id == account.id)
                .outerjoin(UiGroupS3User, UiGroup.id == UiGroupS3User.group_id)
                .outerjoin(s3_user, UiGroupS3User.s3_user_id == s3_user.id)
                .outerjoin(UiGroupS3Connection, UiGroup.id == UiGroupS3Connection.group_id)
                .outerjoin(
                    connection,
                    and_(
                        UiGroupS3Connection.s3_connection_id == connection.id,
                        connection.is_shared.is_(True),
                        connection.is_temporary.is_(False),
                    ),
                )
                .filter(
                    or_(
                        UiGroup.name.ilike(pattern),
                        func.coalesce(UiGroup.description, "").ilike(pattern),
                        func.coalesce(member.email, "").ilike(pattern),
                        func.coalesce(account.name, "").ilike(pattern),
                        func.coalesce(account.rgw_account_id, "").ilike(pattern),
                        func.coalesce(s3_user.name, "").ilike(pattern),
                        func.coalesce(s3_user.rgw_user_uid, "").ilike(pattern),
                        func.coalesce(connection.name, "").ilike(pattern),
                    )
                )
                .distinct()
            )
        sort_map = {
            "name": UiGroup.name,
            "created_at": UiGroup.created_at,
            "updated_at": UiGroup.updated_at,
        }
        order_column = sort_map.get(sort_field, UiGroup.name)
        if sort_direction == "desc":
            order_column = order_column.desc()
        total = query.with_entities(func.count(func.distinct(UiGroup.id))).scalar() or 0
        offset = max(page - 1, 0) * page_size
        rows = query.order_by(order_column).offset(offset).limit(page_size).all()
        return [self.group_to_out(group) for group in rows], total

    def group_to_out(self, group: UiGroup) -> UiGroupOut:
        user_rows = (
            self.db.query(User)
            .join(UserUiGroup, UserUiGroup.user_id == User.id)
            .filter(UserUiGroup.group_id == group.id)
            .order_by(User.email.asc())
            .all()
        )
        account_rows = (
            self.db.query(UiGroupS3Account)
            .filter(UiGroupS3Account.group_id == group.id)
            .order_by(UiGroupS3Account.account_id.asc())
            .all()
        )
        s3_user_rows = (
            self.db.query(UiGroupS3User)
            .filter(UiGroupS3User.group_id == group.id)
            .all()
        )
        s3_connection_rows = (
            self.db.query(UiGroupS3Connection.s3_connection_id)
            .join(S3Connection, S3Connection.id == UiGroupS3Connection.s3_connection_id)
            .filter(
                UiGroupS3Connection.group_id == group.id,
                S3Connection.is_shared.is_(True),
                S3Connection.is_temporary.is_(False),
            )
            .all()
        )
        s3_user_ids = sorted(row.s3_user_id for row in s3_user_rows)
        s3_connection_ids = sorted(row[0] for row in s3_connection_rows)
        account_ids = sorted(link.account_id for link in account_rows)
        account_names = self._load_account_names(account_ids)
        s3_user_names = load_s3_user_names(self.db, s3_user_ids)
        s3_connection_names = load_shared_s3_connection_names(
            self.db,
            s3_connection_ids,
            exclude_temporary=True,
        )
        return UiGroupOut(
            id=group.id,
            name=group.name,
            description=group.description,
            avatar=UiGroupAvatarService(self.db).descriptor(group),
            can_access_ceph_admin=bool(group.can_access_ceph_admin),
            can_access_storage_ops=bool(group.can_access_storage_ops),
            can_create_manual_private_connections=bool(group.can_create_manual_private_connections),
            can_provision_managed_private_connections=bool(group.can_provision_managed_private_connections),
            manager_tool_access=ManagerToolAccess(
                bucket_compare=bool(group.can_access_manager_bucket_compare),
                bucket_integrity_check=bool(group.can_access_manager_bucket_integrity_check),
                bucket_migration=bool(group.can_access_manager_bucket_migration),
                feature_rules=bool(group.can_access_manager_feature_rules),
                bucket_purge=bool(group.can_access_manager_bucket_purge),
            ),
            browser_advanced_features_enabled=bool(group.browser_advanced_features_enabled),
            user_ids=[row.id for row in user_rows],
            user_details=[
                UserSummary(
                    id=row.id,
                    email=row.email,
                    full_name=row.full_name,
                    display_name=row.display_name or row.full_name,
                    avatar=UserAvatarService(self.db).descriptor(row),
                    role=row.role,
                )
                for row in user_rows
            ],
            accounts=account_ids,
            account_details=[
                LinkedS3Account(
                    id=account_id,
                    name=(details[0] if details else f"Account #{account_id}"),
                    rgw_account_id=(details[1] if details else None),
                )
                for account_id in account_ids
                for details in [account_names.get(account_id)]
            ],
            account_links=[
                AccountMembership(
                    account_id=link.account_id,
                    role=link.role,
                    allow_manager_browser_data_access=bool(
                        link.allow_manager_browser_data_access
                    ),
                )
                for link in account_rows
            ],
            s3_users=s3_user_ids,
            s3_user_links=[
                S3UserMembership(
                    s3_user_id=row.s3_user_id,
                    allow_manager_browser_data_access=bool(
                        row.allow_manager_browser_data_access
                    ),
                )
                for row in s3_user_rows
            ],
            s3_user_details=[
                LinkedS3User(id=s3_id, name=s3_user_names.get(s3_id) or f"S3 User #{s3_id}")
                for s3_id in s3_user_ids
            ],
            s3_connections=s3_connection_ids,
            s3_connection_details=[
                LinkedS3Connection(
                    id=conn_id,
                    name=(details if details else f"Connection #{conn_id}"),
                )
                for conn_id in s3_connection_ids
                for details in [s3_connection_names.get(conn_id)]
            ],
            created_at=group.created_at,
            updated_at=group.updated_at,
        )

    def _set_user_links(self, group: UiGroup, target_ids: list[int]) -> None:
        cleaned_ids = self._clean_ids(target_ids)
        self._ensure_users_exist(cleaned_ids)
        existing = self.db.query(UserUiGroup).filter(UserUiGroup.group_id == group.id).all()
        existing_ids = {link.user_id for link in existing}
        desired_ids = set(cleaned_ids)
        self._delete_removed_user_links(group.id, existing_ids - desired_ids)
        for user_id in desired_ids - existing_ids:
            self.db.add(UserUiGroup(user_id=user_id, group_id=group.id))

    def _set_account_links(self, group: UiGroup, links: list[AccountMembership]) -> None:
        cleaned: dict[int, AccountMembership] = {}
        for link in links:
            account_id = int(link.account_id)
            cleaned[account_id] = AccountMembership(
                account_id=account_id,
                role=require_account_role(link.role),
                allow_manager_browser_data_access=bool(
                    link.allow_manager_browser_data_access
                ),
            )
        self._ensure_accounts_exist(sorted(cleaned))
        existing = self.db.query(UiGroupS3Account).filter(UiGroupS3Account.group_id == group.id).all()
        existing_by_id = {link.account_id: link for link in existing}
        desired_ids = set(cleaned)
        for account_id in set(existing_by_id) - desired_ids:
            self.db.delete(existing_by_id[account_id])
        for account_id, payload in cleaned.items():
            row = existing_by_id.get(account_id)
            if row is None:
                row = UiGroupS3Account(
                    group_id=group.id,
                    account_id=account_id,
                    role=payload.role,
                    allow_manager_browser_data_access=bool(
                        payload.allow_manager_browser_data_access
                    ),
                )
            row.role = require_account_role(payload.role)
            row.allow_manager_browser_data_access = bool(
                payload.allow_manager_browser_data_access
            )
            row.updated_at = utcnow()
            self.db.add(row)

    def _set_s3_user_ids(self, group: UiGroup, target_ids: list[int]) -> None:
        existing = {
            int(link.s3_user_id): bool(link.allow_manager_browser_data_access)
            for link in self.db.query(UiGroupS3User).filter(UiGroupS3User.group_id == group.id).all()
        }
        self._set_s3_user_links(
            group,
            [
                S3UserMembership(
                    s3_user_id=int(s3_user_id),
                    allow_manager_browser_data_access=existing.get(int(s3_user_id), False),
                )
                for s3_user_id in target_ids
            ],
        )

    def _set_s3_user_links(self, group: UiGroup, links: list[S3UserMembership]) -> None:
        cleaned = {int(link.s3_user_id): link for link in links}
        cleaned_ids = sorted(cleaned)
        self._ensure_s3_users_exist(cleaned_ids)
        existing = self.db.query(UiGroupS3User).filter(UiGroupS3User.group_id == group.id).all()
        existing_by_id = {link.s3_user_id: link for link in existing}
        existing_ids = set(existing_by_id)
        desired_ids = set(cleaned_ids)
        for s3_user_id in existing_ids - desired_ids:
            self.db.query(UiGroupS3User).filter(
                UiGroupS3User.group_id == group.id,
                UiGroupS3User.s3_user_id == s3_user_id,
            ).delete(synchronize_session=False)
        for s3_user_id in desired_ids - existing_ids:
            self.db.add(
                UiGroupS3User(
                    group_id=group.id,
                    s3_user_id=s3_user_id,
                    allow_manager_browser_data_access=bool(
                        cleaned[s3_user_id].allow_manager_browser_data_access
                    ),
                )
            )
        for s3_user_id in desired_ids & existing_ids:
            row = existing_by_id[s3_user_id]
            row.allow_manager_browser_data_access = bool(
                cleaned[s3_user_id].allow_manager_browser_data_access
            )
            self.db.add(row)

    def _set_s3_connection_links(self, group: UiGroup, target_ids: list[int]) -> None:
        cleaned_ids = self._clean_ids(target_ids)
        if cleaned_ids:
            connections = self.db.query(S3Connection).filter(S3Connection.id.in_(cleaned_ids)).all()
            found_ids = {conn.id for conn in connections}
            missing = set(cleaned_ids) - found_ids
            if missing:
                missing_str = ", ".join(str(mid) for mid in sorted(missing))
                raise ValueError(f"S3 connections not found: {missing_str}")
            non_shared_ids = sorted(conn.id for conn in connections if not bool(conn.is_shared))
            if non_shared_ids:
                non_shared_str = ", ".join(str(cid) for cid in non_shared_ids)
                raise ValueError(f"Only shared S3 connections can be linked: {non_shared_str}")
        existing = self.db.query(UiGroupS3Connection).filter(UiGroupS3Connection.group_id == group.id).all()
        existing_ids = {link.s3_connection_id for link in existing}
        desired_ids = set(cleaned_ids)
        for connection_id in existing_ids - desired_ids:
            self.db.query(UiGroupS3Connection).filter(
                UiGroupS3Connection.group_id == group.id,
                UiGroupS3Connection.s3_connection_id == connection_id,
            ).delete(synchronize_session=False)
        for connection_id in desired_ids - existing_ids:
            self.db.add(UiGroupS3Connection(group_id=group.id, s3_connection_id=connection_id))

    def _clean_ids(self, ids: list[int]) -> list[int]:
        return sorted({int(item) for item in ids if item is not None})

    def _normalize_name(self, value: str) -> str:
        name = str(value or "").strip()
        if not name:
            raise ValueError("UI group name is required")
        return name

    def _ensure_users_exist(self, ids: list[int]) -> None:
        if not ids:
            return
        found = {row[0] for row in self.db.query(User.id).filter(User.id.in_(ids)).all()}
        missing = set(ids) - found
        if missing:
            missing_str = ", ".join(str(mid) for mid in sorted(missing))
            raise ValueError(f"Users not found: {missing_str}")

    def _ensure_accounts_exist(self, ids: list[int]) -> None:
        if not ids:
            return
        found = {row[0] for row in self.db.query(S3Account.id).filter(S3Account.id.in_(ids)).all()}
        missing = set(ids) - found
        if missing:
            missing_str = ", ".join(str(mid) for mid in sorted(missing))
            raise ValueError(f"S3 accounts not found: {missing_str}")

    def _ensure_s3_users_exist(self, ids: list[int]) -> None:
        if not ids:
            return
        found = {row[0] for row in self.db.query(S3User.id).filter(S3User.id.in_(ids)).all()}
        missing = set(ids) - found
        if missing:
            missing_str = ", ".join(str(mid) for mid in sorted(missing))
            raise ValueError(f"S3 users not found: {missing_str}")

    def _delete_removed_user_links(self, group_id: int, user_ids: set[int]) -> None:
        if not user_ids:
            return
        self.db.query(UserUiGroup).filter(
            UserUiGroup.group_id == group_id,
            UserUiGroup.user_id.in_(user_ids),
        ).delete(synchronize_session=False)

    def _load_account_names(self, ids: list[int]) -> dict[int, tuple[str, Optional[str]]]:
        if not ids:
            return {}
        rows = (
            self.db.query(S3Account.id, S3Account.name, S3Account.rgw_account_id)
            .filter(S3Account.id.in_(ids))
            .all()
        )
        return {row[0]: (row[1], row[2]) for row in rows}

def get_ui_groups_service(db: Session) -> UiGroupsService:
    return UiGroupsService(db)
