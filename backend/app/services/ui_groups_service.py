# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, aliased

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
    UserUiGroup,
)
from app.models.ui_group import UiGroupCreate, UiGroupOut, UiGroupSummary, UiGroupUpdate
from app.models.user import (
    AccountMembership,
    LinkedS3Connection,
    LinkedS3User,
    ManagerToolAccess,
    UserSummary,
)
from app.utils.time import utcnow


ACCOUNT_ROLE_VALUES = {entry.value for entry in AccountRole}


class UiGroupsService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create_group(self, payload: UiGroupCreate) -> UiGroup:
        name = self._normalize_name(payload.name)
        if self.db.query(UiGroup).filter(func.lower(UiGroup.name) == name.lower()).first():
            raise ValueError("UI group already exists")
        manager_tool_access = payload.manager_tool_access or ManagerToolAccess()
        now = utcnow()
        group = UiGroup(
            name=name,
            description=self._normalize_description(payload.description),
            can_access_ceph_admin=bool(payload.can_access_ceph_admin),
            can_access_storage_ops=bool(payload.can_access_storage_ops),
            can_access_manager_bucket_compare=bool(manager_tool_access.bucket_compare),
            can_access_manager_bucket_integrity_check=bool(manager_tool_access.bucket_integrity_check),
            can_access_manager_bucket_migration=bool(manager_tool_access.bucket_migration),
            can_access_manager_ceph_s3_user_keys=bool(manager_tool_access.ceph_s3_user_keys),
            created_at=now,
            updated_at=now,
        )
        self.db.add(group)
        self.db.flush()
        self._set_user_links(group, payload.user_ids)
        self._set_account_links(group, payload.account_links)
        self._set_s3_user_links(group, payload.s3_user_ids)
        self._set_s3_connection_links(group, payload.s3_connection_ids)
        self.db.commit()
        self.db.refresh(group)
        return group

    def update_group(self, group_id: int, payload: UiGroupUpdate) -> UiGroup:
        group = self.db.query(UiGroup).filter(UiGroup.id == group_id).first()
        if not group:
            raise ValueError("UI group not found")
        if payload.name is not None:
            name = self._normalize_name(payload.name)
            existing = self.db.query(UiGroup).filter(func.lower(UiGroup.name) == name.lower()).first()
            if existing and existing.id != group.id:
                raise ValueError("UI group already exists")
            group.name = name
        if payload.description is not None:
            group.description = self._normalize_description(payload.description)
        if payload.can_access_ceph_admin is not None:
            group.can_access_ceph_admin = bool(payload.can_access_ceph_admin)
        if payload.can_access_storage_ops is not None:
            group.can_access_storage_ops = bool(payload.can_access_storage_ops)
        if payload.manager_tool_access is not None:
            group.can_access_manager_bucket_compare = bool(payload.manager_tool_access.bucket_compare)
            group.can_access_manager_bucket_integrity_check = bool(payload.manager_tool_access.bucket_integrity_check)
            group.can_access_manager_bucket_migration = bool(payload.manager_tool_access.bucket_migration)
            group.can_access_manager_ceph_s3_user_keys = bool(payload.manager_tool_access.ceph_s3_user_keys)
        if payload.user_ids is not None:
            self._set_user_links(group, payload.user_ids)
        if payload.account_links is not None:
            self._set_account_links(group, payload.account_links)
        if payload.s3_user_ids is not None:
            self._set_s3_user_links(group, payload.s3_user_ids)
        if payload.s3_connection_ids is not None:
            self._set_s3_connection_links(group, payload.s3_connection_ids)
        group.updated_at = utcnow()
        self.db.add(group)
        self.db.commit()
        self.db.refresh(group)
        return group

    def delete_group(self, group_id: int) -> None:
        group = self.db.query(UiGroup).filter(UiGroup.id == group_id).first()
        if not group:
            raise ValueError("UI group not found")
        self.db.delete(group)
        self.db.commit()

    def get_group(self, group_id: int) -> Optional[UiGroup]:
        return self.db.query(UiGroup).filter(UiGroup.id == group_id).first()

    def list_groups_minimal(self) -> list[UiGroupSummary]:
        rows = self.db.query(UiGroup.id, UiGroup.name).order_by(UiGroup.name.asc()).all()
        return [UiGroupSummary(id=row[0], name=row[1]) for row in rows]

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
                .outerjoin(connection, UiGroupS3Connection.s3_connection_id == connection.id)
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
            self.db.query(User.id, User.email, User.role)
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
            self.db.query(UiGroupS3User.s3_user_id)
            .filter(UiGroupS3User.group_id == group.id)
            .all()
        )
        s3_connection_rows = (
            self.db.query(UiGroupS3Connection.s3_connection_id)
            .filter(UiGroupS3Connection.group_id == group.id)
            .all()
        )
        s3_user_ids = sorted(row[0] for row in s3_user_rows)
        s3_connection_ids = sorted(row[0] for row in s3_connection_rows)
        s3_user_names = self._load_s3_user_names(s3_user_ids)
        s3_connection_names = self._load_s3_connection_names(s3_connection_ids)
        return UiGroupOut(
            id=group.id,
            name=group.name,
            description=group.description,
            can_access_ceph_admin=bool(group.can_access_ceph_admin),
            can_access_storage_ops=bool(group.can_access_storage_ops),
            manager_tool_access=ManagerToolAccess(
                bucket_compare=bool(group.can_access_manager_bucket_compare),
                bucket_integrity_check=bool(group.can_access_manager_bucket_integrity_check),
                bucket_migration=bool(group.can_access_manager_bucket_migration),
                ceph_s3_user_keys=bool(group.can_access_manager_ceph_s3_user_keys),
            ),
            user_ids=[row[0] for row in user_rows],
            user_details=[UserSummary(id=row[0], email=row[1], role=row[2]) for row in user_rows],
            accounts=[link.account_id for link in account_rows],
            account_links=[
                AccountMembership(
                    account_id=link.account_id,
                    account_admin=link.account_admin,
                    account_role=link.account_role,
                )
                for link in account_rows
            ],
            s3_users=s3_user_ids,
            s3_user_details=[
                LinkedS3User(id=s3_id, name=s3_user_names.get(s3_id) or f"S3 User #{s3_id}")
                for s3_id in s3_user_ids
            ],
            s3_connections=s3_connection_ids,
            s3_connection_details=[
                LinkedS3Connection(
                    id=conn_id,
                    name=(details[0] if details else f"Connection #{conn_id}"),
                    access_manager=(details[1] if details else None),
                    access_browser=(details[2] if details else None),
                )
                for conn_id in s3_connection_ids
                for details in [s3_connection_names.get(conn_id)]
            ],
            created_at=group.created_at,
            updated_at=group.updated_at,
        )

    def group_ids_grant_ceph_admin(self, group_ids: list[int] | None) -> bool:
        cleaned = self._clean_ids(group_ids or [])
        if not cleaned:
            return False
        return bool(
            self.db.query(UiGroup.id)
            .filter(UiGroup.id.in_(cleaned), UiGroup.can_access_ceph_admin.is_(True))
            .first()
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
            if link.account_role is not None and link.account_role not in ACCOUNT_ROLE_VALUES:
                raise ValueError("Invalid account role")
            cleaned[account_id] = AccountMembership(
                account_id=account_id,
                account_admin=bool(link.account_admin),
                account_role=link.account_role or AccountRole.PORTAL_NONE.value,
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
                row = UiGroupS3Account(group_id=group.id, account_id=account_id)
            row.account_admin = bool(payload.account_admin)
            row.account_role = payload.account_role or AccountRole.PORTAL_NONE.value
            row.updated_at = utcnow()
            self.db.add(row)

    def _set_s3_user_links(self, group: UiGroup, target_ids: list[int]) -> None:
        cleaned_ids = self._clean_ids(target_ids)
        self._ensure_s3_users_exist(cleaned_ids)
        existing = self.db.query(UiGroupS3User).filter(UiGroupS3User.group_id == group.id).all()
        existing_ids = {link.s3_user_id for link in existing}
        desired_ids = set(cleaned_ids)
        for s3_user_id in existing_ids - desired_ids:
            self.db.query(UiGroupS3User).filter(
                UiGroupS3User.group_id == group.id,
                UiGroupS3User.s3_user_id == s3_user_id,
            ).delete(synchronize_session=False)
        for s3_user_id in desired_ids - existing_ids:
            self.db.add(UiGroupS3User(group_id=group.id, s3_user_id=s3_user_id))

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

    def _normalize_description(self, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

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


def get_ui_groups_service(db: Session) -> UiGroupsService:
    return UiGroupsService(db)
