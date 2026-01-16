# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional
import logging

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, aliased
from sqlalchemy.orm.exc import DetachedInstanceError

from app.core.security import get_password_hash, verify_password
from app.db import AccountIAMUser, AccountRole, S3Account, S3Connection, User, UserS3Account, UserS3Connection, UserRole, S3User, UserS3User
from app.models.user import AccountMembership, LinkedS3Connection, LinkedS3User, UserCreate, UserOut, UserUpdate, UserSummary
from app.services.app_settings_service import load_app_settings

logger = logging.getLogger(__name__)


class UsersService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_email(self, email: str) -> Optional[User]:
        return self.db.query(User).filter(User.email == email).first()

    def get_by_id(self, user_id: int) -> Optional[User]:
        return self.db.query(User).filter(User.id == user_id).first()

    def create_super_admin(self, payload: UserCreate) -> User:
        existing = self.get_by_email(payload.email)
        if existing:
            raise ValueError("User already exists")
        user = User(
            email=payload.email,
            full_name=payload.full_name,
            display_name=payload.full_name,
            hashed_password=get_password_hash(payload.password),
            is_active=True,
            role=UserRole.UI_ADMIN.value,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        logger.debug("Created super admin user id=%s email=%s", user.id, user.email)
        return user

    def create_user(self, payload: UserCreate) -> User:
        existing = self.get_by_email(payload.email)
        if existing:
            raise ValueError("User already exists")
        role = payload.role or UserRole.UI_USER.value
        is_root = bool(payload.is_root)
        access_key, secret_key = self._validate_admin_credentials(
            role,
            self._clean_key(payload.rgw_access_key),
            self._clean_key(payload.rgw_secret_key),
        )
        user = User(
            email=payload.email,
            full_name=payload.full_name,
            display_name=payload.full_name,
            hashed_password=get_password_hash(payload.password),
            is_active=True,
            role=role,
            is_root=is_root,
            rgw_access_key=access_key,
            rgw_secret_key=secret_key,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        logger.debug("Created user id=%s email=%s role=%s", user.id, user.email, role)
        return user

    def update_user(self, user_id: int, payload: UserUpdate) -> User:
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            raise ValueError("User not found")
        fields_set = getattr(payload, "model_fields_set", getattr(payload, "__fields_set__", set()))
        new_role = payload.role or user.role
        if payload.email and payload.email != user.email:
            existing = self.get_by_email(payload.email)
            if existing and existing.id != user.id:
                raise ValueError("Email already in use")
            user.email = payload.email
        if payload.password:
            user.hashed_password = get_password_hash(payload.password)
        if payload.role:
            user.role = payload.role
        if payload.is_active is not None:
            user.is_active = payload.is_active
        if payload.is_root is not None:
            user.is_root = payload.is_root
        if user.role != UserRole.UI_ADMIN.value:
            user.rgw_access_key = None
            user.rgw_secret_key = None
        elif "rgw_access_key" in fields_set or "rgw_secret_key" in fields_set:
            normalized_access = self._clean_key(payload.rgw_access_key)
            normalized_secret = self._clean_key(payload.rgw_secret_key)
            if normalized_access is None and normalized_secret is None:
                user.rgw_access_key = None
                user.rgw_secret_key = None
            else:
                access_key, secret_key = self._validate_admin_credentials(
                    new_role,
                    normalized_access,
                    normalized_secret,
                )
                user.rgw_access_key = access_key
                user.rgw_secret_key = secret_key
        if payload.s3_user_ids is not None:
            self._set_s3_user_links(user, payload.s3_user_ids)
        if payload.s3_connection_ids is not None:
            self._set_s3_connection_links(user, payload.s3_connection_ids)
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        logger.debug("Updated user id=%s email=%s", user.id, user.email)
        return user

    def delete_user(self, user_id: int) -> None:
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            raise ValueError("User not found")
        # Remove account links first to satisfy NOT NULL constraints
        (
            self.db.query(AccountIAMUser)
            .filter(AccountIAMUser.user_id == user.id)
            .delete(synchronize_session=False)
        )
        (
            self.db.query(UserS3Account)
            .filter(UserS3Account.user_id == user.id)
            .delete(synchronize_session=False)
        )
        (
            self.db.query(UserS3User)
            .filter(UserS3User.user_id == user.id)
            .delete(synchronize_session=False)
        )
        (
            self.db.query(UserS3Connection)
            .filter(UserS3Connection.user_id == user.id)
            .delete(synchronize_session=False)
        )
        self.db.delete(user)
        self.db.commit()
        logger.debug("Deleted user id=%s email=%s", user.id, user.email)

    def list_users(self) -> list[User]:
        return self.db.query(User).all()

    def list_users_minimal(self) -> list[UserSummary]:
        rows = self.db.query(User.id, User.email).order_by(User.email.asc()).all()
        return [UserSummary(id=row[0], email=row[1]) for row in rows]

    def _load_s3_user_names(self, ids: list[int]) -> dict[int, str]:
        if not ids:
            return {}
        rows = self.db.query(S3User.id, S3User.name).filter(S3User.id.in_(ids)).all()
        return {row[0]: row[1] for row in rows}

    def _load_s3_connection_names(self, ids: list[int]) -> dict[int, str]:
        if not ids:
            return {}
        rows = self.db.query(S3Connection.id, S3Connection.name).filter(S3Connection.id.in_(ids)).all()
        return {row[0]: row[1] for row in rows}

    def paginate_users(
        self,
        page: int,
        page_size: int,
        search: Optional[str] = None,
        sort_field: str = "email",
        sort_direction: str = "asc",
    ) -> tuple[list[UserOut], int]:
        query = self.db.query(User)
        search_value = search.strip() if isinstance(search, str) else ""
        if search_value:
            linked_connection = aliased(S3Connection)
            owned_connection = aliased(S3Connection)
            pattern = f"%{search_value}%"
            query = (
                query.outerjoin(UserS3Account, User.id == UserS3Account.user_id)
                .outerjoin(S3Account, UserS3Account.account_id == S3Account.id)
                .outerjoin(UserS3User, User.id == UserS3User.user_id)
                .outerjoin(S3User, UserS3User.s3_user_id == S3User.id)
                .outerjoin(UserS3Connection, User.id == UserS3Connection.user_id)
                .outerjoin(linked_connection, UserS3Connection.s3_connection_id == linked_connection.id)
                .outerjoin(owned_connection, owned_connection.owner_user_id == User.id)
            )
            query = query.filter(
                or_(
                    User.email.ilike(pattern),
                    User.role.ilike(pattern),
                    func.coalesce(S3Account.name, "").ilike(pattern),
                    func.coalesce(S3Account.rgw_account_id, "").ilike(pattern),
                    func.coalesce(S3User.name, "").ilike(pattern),
                    func.coalesce(S3User.rgw_user_uid, "").ilike(pattern),
                    func.coalesce(linked_connection.name, "").ilike(pattern),
                    func.coalesce(owned_connection.name, "").ilike(pattern),
                )
            )
            query = query.distinct()
        sort_map = {
            "email": User.email,
            "role": User.role,
            "created_at": User.created_at,
            "last_login_at": User.last_login_at,
            "last_login": User.last_login_at,
        }
        order_column = sort_map.get(sort_field, User.email)
        if sort_direction == "desc":
            order_column = order_column.desc()
        if sort_field in {"last_login_at", "last_login"}:
            order_column = order_column.nulls_last()
        total_query = query.with_entities(func.count(func.distinct(User.id)))
        total = total_query.scalar() or 0
        offset = max(page - 1, 0) * page_size
        rows = query.order_by(order_column).offset(offset).limit(page_size).all()
        user_ids = [row.id for row in rows]
        s3_links_rows = (
            self.db.query(UserS3User.user_id, UserS3User.s3_user_id)
            .filter(UserS3User.user_id.in_(user_ids))
            .all()
        )
        s3_links: dict[int, list[int]] = {}
        s3_ids: set[int] = set()
        for user_id, s3_user_id in s3_links_rows:
            s3_links.setdefault(user_id, []).append(s3_user_id)
            s3_ids.add(s3_user_id)
        s3_labels = self._load_s3_user_names(sorted(s3_ids))
        connection_links_rows = (
            self.db.query(UserS3Connection.user_id, UserS3Connection.s3_connection_id)
            .filter(UserS3Connection.user_id.in_(user_ids))
            .all()
        )
        connection_links: dict[int, list[int]] = {}
        connection_ids: set[int] = set()
        for user_id, connection_id in connection_links_rows:
            connection_links.setdefault(user_id, []).append(connection_id)
            connection_ids.add(connection_id)
        connection_labels = self._load_s3_connection_names(sorted(connection_ids))
        outputs = [
            self.user_to_out(
                user,
                s3_user_labels=s3_labels,
                preloaded_s3_links=s3_links,
                s3_connection_labels=connection_labels,
                preloaded_connection_links=connection_links,
            )
            for user in rows
        ]
        return outputs, total

    def assign_user_to_account(
        self,
        user_id: int,
        account_id: int,
        account_root: bool = False,
        *,
        account_role: Optional[str] = None,
        role: Optional[str] = None,
        account_admin: Optional[bool] = None,
    ) -> User:
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            raise ValueError("User not found")
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise ValueError("S3Account not found")
        link = (
            self.db.query(UserS3Account)
            .filter(UserS3Account.user_id == user.id, UserS3Account.account_id == account.id)
            .first()
        )
        settings = load_app_settings()
        portal_enabled = bool(settings.general.portal_enabled)
        if not portal_enabled:
            if account_role and account_role != AccountRole.PORTAL_NONE.value:
                raise ValueError("Portal feature is disabled")
            if account_role is None and link:
                desired_account_role = link.account_role or AccountRole.PORTAL_NONE.value
            else:
                desired_account_role = AccountRole.PORTAL_NONE.value
        else:
            desired_account_role = account_role or (
                AccountRole.PORTAL_MANAGER.value
                if user.role == UserRole.UI_ADMIN.value
                else AccountRole.PORTAL_USER.value
            )
        if desired_account_role not in {role.value for role in AccountRole}:
            raise ValueError("Invalid account role")
        # Keep platform role untouched unless explicitly overridden
        if role and user.role != UserRole.UI_ADMIN.value:
            user.role = role
        if user.role == UserRole.UI_NONE.value:
            user.role = UserRole.UI_USER.value
        if not link:
            link = UserS3Account(
                user_id=user.id,
                account_id=account.id,
                is_root=bool(account_root),
                account_role=desired_account_role,
            )
        link.account_role = desired_account_role
        link.is_root = bool(account_root)
        link.account_admin = bool(account_admin if account_admin is not None else link.account_admin or account_root)
        link.can_manage_buckets = link.account_admin or desired_account_role in {
            AccountRole.PORTAL_MANAGER.value,
            AccountRole.PORTAL_USER.value,
        }
        link.can_manage_portal_users = link.account_admin or desired_account_role == AccountRole.PORTAL_MANAGER.value
        link.can_manage_iam = link.can_manage_portal_users or link.account_admin
        link.can_view_root_key = bool(link.account_admin or link.is_root or link.can_manage_portal_users or link.can_manage_iam)
        link.updated_at = datetime.utcnow()
        self.db.add(link)
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def authenticate(self, email: str, password: str) -> Optional[User]:
        user = self.get_by_email(email)
        if not user or not user.is_active or not user.hashed_password:
            return None
        if not verify_password(password, user.hashed_password):
            return None
        logger.debug("Authenticated user id=%s email=%s", user.id, user.email)
        return self.mark_last_login(user)

    def user_to_out(
        self,
        user: User,
        *,
        s3_user_labels: Optional[dict[int, str]] = None,
        preloaded_s3_links: Optional[dict[int, list[int]]] = None,
        s3_connection_labels: Optional[dict[int, str]] = None,
        preloaded_connection_links: Optional[dict[int, list[int]]] = None,
    ) -> UserOut:
        account_ids: list[int] = []
        account_links: list[AccountMembership] = []
        s3_user_ids: list[int] = []
        s3_connection_ids: list[int] = []
        try:
            if hasattr(user, "account_links") and user.account_links is not None:
                account_links = [
                    AccountMembership(
                        account_id=link.account_id,
                        account_role=link.account_role,
                        account_admin=link.account_admin,
                    )
                    for link in user.account_links
                ]
                account_ids = [link.account_id for link in user.account_links]
        except DetachedInstanceError:
            account_rows = (
                self.db.query(UserS3Account.account_id, UserS3Account.account_role, UserS3Account.account_admin)
                .filter(UserS3Account.user_id == user.id)
                .all()
            )
            account_links = [
                AccountMembership(account_id=row[0], account_role=row[1], account_admin=row[2]) for row in account_rows
            ]
            account_ids = [row[0] for row in account_rows]
        try:
            if hasattr(user, "s3_user_links") and user.s3_user_links is not None:
                s3_user_ids = [link.s3_user_id for link in user.s3_user_links]
        except DetachedInstanceError:
            s3_user_ids = [
                row[0]
                for row in self.db.query(UserS3User.s3_user_id).filter(UserS3User.user_id == user.id).all()
            ]
        try:
            if hasattr(user, "s3_connection_links") and user.s3_connection_links is not None:
                s3_connection_ids = [link.s3_connection_id for link in user.s3_connection_links]
        except DetachedInstanceError:
            s3_connection_ids = [
                row[0]
                for row in self.db.query(UserS3Connection.s3_connection_id).filter(UserS3Connection.user_id == user.id).all()
            ]
        if preloaded_s3_links is not None and user.id in preloaded_s3_links:
            s3_user_ids = preloaded_s3_links[user.id]
        if preloaded_connection_links is not None and user.id in preloaded_connection_links:
            s3_connection_ids = preloaded_connection_links[user.id]
        s3_user_names: dict[int, str]
        if s3_user_labels is not None:
            s3_user_names = s3_user_labels
        else:
            s3_user_names = self._load_s3_user_names(s3_user_ids)
        s3_connection_names: dict[int, str]
        if s3_connection_labels is not None:
            s3_connection_names = s3_connection_labels
        else:
            s3_connection_names = self._load_s3_connection_names(s3_connection_ids)
        s3_user_details = [
            LinkedS3User(id=s3_id, name=s3_user_names.get(s3_id) or f"S3 User #{s3_id}")
            for s3_id in s3_user_ids
        ]
        s3_connection_details = [
            LinkedS3Connection(id=conn_id, name=s3_connection_names.get(conn_id) or f"Connection #{conn_id}")
            for conn_id in s3_connection_ids
        ]
        return UserOut(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            display_name=user.display_name or user.full_name,
            picture_url=user.picture_url,
            is_active=user.is_active,
            is_admin=user.role == UserRole.UI_ADMIN.value,
            role=user.role,
            is_root=user.is_root,
            accounts=account_ids,
            account_links=account_links,
            has_rgw_credentials=bool(user.rgw_access_key and user.rgw_secret_key),
            s3_users=s3_user_ids,
            s3_user_details=s3_user_details,
            s3_connections=s3_connection_ids,
            s3_connection_details=s3_connection_details,
            auth_provider=user.auth_provider,
            last_login_at=user.last_login_at,
        )

    def mark_last_login(self, user: User) -> User:
        user.last_login_at = datetime.utcnow()
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def _clean_key(self, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    def _validate_admin_credentials(
        self,
        role: str,
        access_key: Optional[str],
        secret_key: Optional[str],
    ) -> tuple[Optional[str], Optional[str]]:
        if access_key or secret_key:
            if role != UserRole.UI_ADMIN.value:
                raise ValueError("RGW admin credentials can only be set for admin users")
            if not access_key or not secret_key:
                raise ValueError("Both RGW admin access and secret keys are required")
        else:
            access_key = None
            secret_key = None
        return access_key, secret_key

    def _set_s3_user_links(self, user: User, target_ids: list[int]) -> None:
        cleaned_ids = sorted({int(s3_id) for s3_id in target_ids if s3_id is not None})
        existing_links = (
            self.db.query(UserS3User)
            .filter(UserS3User.user_id == user.id)
            .all()
        )
        existing_ids = {link.s3_user_id for link in existing_links}
        desired_ids = set(cleaned_ids)
        to_remove = existing_ids - desired_ids
        to_add = desired_ids - existing_ids
        if to_remove:
            (
                self.db.query(UserS3User)
                .filter(
                    UserS3User.user_id == user.id,
                    UserS3User.s3_user_id.in_(to_remove),
                )
                .delete(synchronize_session=False)
            )
        if to_add:
            s3_users = self.db.query(S3User).filter(S3User.id.in_(to_add)).all()
            found_ids = {s3.id for s3 in s3_users}
            missing = to_add - found_ids
            if missing:
                missing_str = ", ".join(str(mid) for mid in sorted(missing))
                raise ValueError(f"S3 users not found: {missing_str}")
            for s3_user in s3_users:
                self.db.add(UserS3User(user_id=user.id, s3_user_id=s3_user.id))

    def _set_s3_connection_links(self, user: User, target_ids: list[int]) -> None:
        cleaned_ids = sorted({int(conn_id) for conn_id in target_ids if conn_id is not None})
        existing_links = (
            self.db.query(UserS3Connection)
            .filter(UserS3Connection.user_id == user.id)
            .all()
        )
        existing_ids = {link.s3_connection_id for link in existing_links}
        desired_ids = set(cleaned_ids)
        if desired_ids:
            connections = self.db.query(S3Connection).filter(S3Connection.id.in_(desired_ids)).all()
            found_ids = {conn.id for conn in connections}
            missing = desired_ids - found_ids
            if missing:
                missing_str = ", ".join(str(mid) for mid in sorted(missing))
                raise ValueError(f"S3 connections not found: {missing_str}")
            owned_ids = {conn.id for conn in connections if conn.owner_user_id == user.id}
            desired_ids -= owned_ids
        to_remove = existing_ids - desired_ids
        to_add = desired_ids - existing_ids
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
                    can_browser=True,
                    can_manager=True,
                )
            )

    def get_or_create_oidc_user(
        self,
        *,
        provider: str,
        subject: str,
        email: Optional[str],
        full_name: Optional[str],
        picture_url: Optional[str],
    ) -> tuple[User, bool]:
        normalized_provider = provider.lower()
        existing = (
            self.db.query(User)
            .filter(
                User.auth_provider == normalized_provider,
                User.auth_provider_subject == subject,
            )
            .first()
        )
        if existing:
            changed = False
            if full_name and existing.display_name != full_name and not existing.full_name:
                existing.display_name = full_name
                changed = True
            if picture_url and existing.picture_url != picture_url:
                existing.picture_url = picture_url
                changed = True
            if changed:
                self.db.add(existing)
                self.db.commit()
                self.db.refresh(existing)
            return existing, False

        if email:
            user = self.get_by_email(email)
            if user:
                user.auth_provider = normalized_provider
                user.auth_provider_subject = subject
                if full_name and not user.display_name:
                    user.display_name = full_name
                if picture_url:
                    user.picture_url = picture_url
                self.db.add(user)
                self.db.commit()
                self.db.refresh(user)
                logger.debug("Linked local user id=%s to OIDC provider=%s", user.id, normalized_provider)
                return user, False

        generated_email = email or f"{normalized_provider}-{subject}@oidc.local"
        new_user = User(
            email=generated_email,
            full_name=full_name,
            display_name=full_name,
            picture_url=picture_url,
            hashed_password=None,
            is_active=True,
            role=UserRole.UI_NONE.value,
            auth_provider=normalized_provider,
            auth_provider_subject=subject,
        )
        self.db.add(new_user)
        self.db.commit()
        self.db.refresh(new_user)
        logger.debug("Created OIDC user id=%s provider=%s", new_user.id, normalized_provider)
        return new_user, True


def get_users_service(db: Session) -> UsersService:
    return UsersService(db)
