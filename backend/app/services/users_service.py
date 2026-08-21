# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
import logging
from typing import Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, aliased

from app.core.security import (
    consume_dummy_password_hash,
    get_password_hash,
    verify_and_update_password,
    verify_password,
)
from app.db import (
    AccountIAMUser,
    ApiToken,
    AuditLog,
    BucketMigration,
    AuthSession,
    RefreshToken,
    S3Account,
    S3Connection,
    S3User,
    TagDefinition,
    UiGroup,
    User,
    UserRole,
    UserS3Account,
    UserS3Connection,
    UserS3User,
    UserUiGroup,
    is_admin_ui_role,
)
from app.models.user import (
    ManagerToolAccess,
    UiPreferences,
    UserAvatarPreference,
    UserCreate,
    UserOut,
    UserSummary,
    UserUpdate,
    validate_password_policy,
)
from app.services.external_identity_user_service import ExternalIdentityUserService
from app.services.portal_ownership import require_no_private_storage_space_ownership
from app.services.portal_role_sync import (
    capture_effective_portal_roles,
    sync_portal_role_downgrades,
    sync_portal_role_promotions,
)
from app.services.user_associations_service import UserAssociationsService
from app.services.user_avatar_service import UserAvatarService
from app.services.user_output_service import UserOutputService
from app.utils.account_roles import require_account_role
from app.utils.time import utcnow
from app.utils.tagging import TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN, TAG_DOMAIN_BUCKET_UI_STORAGE_OPS

logger = logging.getLogger(__name__)


MANAGER_TOOL_ROLES = {
    UserRole.UI_SUPERADMIN.value,
    UserRole.UI_ADMIN.value,
    UserRole.UI_USER.value,
}
MANAGER_ROLE_SCOPED_FIELDS = (
    "can_access_storage_ops",
    "can_create_manual_private_connections",
    "can_provision_managed_private_connections",
)
MANAGER_TOOL_COLUMNS = {
    "bucket_compare": "can_access_manager_bucket_compare",
    "bucket_integrity_check": "can_access_manager_bucket_integrity_check",
    "bucket_migration": "can_access_manager_bucket_migration",
    "feature_rules": "can_access_manager_feature_rules",
    "bucket_purge": "can_access_manager_bucket_purge",
}


def _dump_ui_preferences(preferences: UiPreferences) -> str:
    return json.dumps(
        preferences.model_dump(exclude_none=True),
        ensure_ascii=True,
        sort_keys=True,
    )


def _manager_tool_column_values(access: ManagerToolAccess, *, enabled: bool) -> dict[str, bool]:
    return {
        column: enabled and bool(getattr(access, field))
        for field, column in MANAGER_TOOL_COLUMNS.items()
    }


class UsersService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_email(self, email: str) -> Optional[User]:
        return self.db.query(User).filter(User.email == email).first()

    def get_by_email_case_insensitive(self, email: str) -> Optional[User]:
        normalized = str(email or "").strip().lower()
        if not normalized:
            return None
        return self.db.query(User).filter(func.lower(User.email) == normalized).first()

    def get_by_id(self, user_id: int) -> Optional[User]:
        return self.db.query(User).filter(User.id == user_id).first()

    def create_super_admin(self, payload: UserCreate) -> User:
        existing = self.get_by_email(payload.email)
        if existing:
            raise ValueError("User already exists")
        validate_password_policy(payload.password)
        user = User(
            email=payload.email,
            full_name=payload.full_name,
            display_name=payload.full_name,
            hashed_password=get_password_hash(payload.password),
            is_active=True,
            role=UserRole.UI_SUPERADMIN.value,
            can_access_ceph_admin=False,
            can_access_storage_ops=False,
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
        validate_password_policy(payload.password)
        role = payload.role or UserRole.UI_USER.value
        is_root = bool(payload.is_root)
        can_access_ceph_admin = bool(payload.can_access_ceph_admin) if is_admin_ui_role(role) else False
        can_access_storage_ops = (
            bool(payload.can_access_storage_ops)
            if role in MANAGER_TOOL_ROLES
            else False
        )
        manager_tool_access = payload.manager_tool_access or ManagerToolAccess()
        manager_tools_supported = role in MANAGER_TOOL_ROLES
        user = User(
            email=payload.email,
            full_name=payload.full_name,
            display_name=payload.full_name,
            hashed_password=get_password_hash(payload.password),
            is_active=True,
            role=role,
            is_root=is_root,
            can_access_ceph_admin=can_access_ceph_admin,
            can_access_storage_ops=can_access_storage_ops,
            can_create_manual_private_connections=(
                bool(payload.can_create_manual_private_connections) if manager_tools_supported else False
            ),
            can_provision_managed_private_connections=(
                bool(payload.can_provision_managed_private_connections) if manager_tools_supported else False
            ),
            browser_advanced_features_enabled=bool(payload.browser_advanced_features_enabled),
            **_manager_tool_column_values(manager_tool_access, enabled=manager_tools_supported),
        )
        self.db.add(user)
        self.db.flush()
        if payload.group_ids is not None:
            UserAssociationsService(self.db).set_group_links(
                user,
                payload.group_ids,
            )
        self.db.commit()
        self.db.refresh(user)
        logger.debug("Created user id=%s email=%s role=%s", user.id, user.email, role)
        return user

    def _apply_identity_updates(self, user: User, payload: UserUpdate) -> bool:
        security_changed = False
        if payload.email and payload.email != user.email:
            existing = self.get_by_email(payload.email)
            if existing and existing.id != user.id:
                raise ValueError("Email already in use")
            user.email = payload.email
            security_changed = True
        if "full_name" in payload.model_fields_set:
            normalized_name = (payload.full_name or "").strip()
            user.full_name = normalized_name or None
            user.display_name = normalized_name or None
        if payload.password:
            validate_password_policy(payload.password)
            user.hashed_password = get_password_hash(payload.password)
            security_changed = True
        return security_changed

    @staticmethod
    def _apply_role_updates(user: User, payload: UserUpdate) -> tuple[str, bool]:
        security_changed = False
        next_role = payload.role or user.role
        if payload.role:
            security_changed = payload.role != user.role
            user.role = payload.role
        if payload.is_active is not None:
            security_changed = security_changed or payload.is_active != user.is_active
            user.is_active = payload.is_active
        if payload.is_root is not None:
            user.is_root = payload.is_root
        return next_role, security_changed

    @staticmethod
    def _apply_access_updates(user: User, payload: UserUpdate, *, role: str) -> None:
        admin_role = is_admin_ui_role(role)
        if payload.can_access_ceph_admin is not None or not admin_role:
            user.can_access_ceph_admin = bool(payload.can_access_ceph_admin) if admin_role else False

        manager_role = role in MANAGER_TOOL_ROLES
        for field in MANAGER_ROLE_SCOPED_FIELDS:
            requested = getattr(payload, field)
            if requested is not None or not manager_role:
                setattr(user, field, bool(requested) if manager_role else False)

        if payload.manager_tool_access is not None or not manager_role:
            values = _manager_tool_column_values(
                payload.manager_tool_access or ManagerToolAccess(),
                enabled=manager_role,
            )
            for column, value in values.items():
                setattr(user, column, value)

        if payload.browser_advanced_features_enabled is not None:
            user.browser_advanced_features_enabled = bool(payload.browser_advanced_features_enabled)
        if not admin_role:
            user.quota_alerts_global_watch = False

    @staticmethod
    def _apply_association_updates(
        user: User,
        payload: UserUpdate,
        associations: UserAssociationsService,
    ) -> None:
        if payload.account_links is not None:
            associations.set_account_links(user, payload.account_links)
        if payload.s3_user_links is not None:
            associations.set_s3_user_links(user, payload.s3_user_links)
        if payload.s3_connection_ids is not None:
            associations.set_s3_connection_links(user, payload.s3_connection_ids)
        if payload.group_ids is not None:
            associations.set_group_links(user, payload.group_ids)

    def update_user(self, user_id: int, payload: UserUpdate) -> User:
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            raise ValueError("User not found")
        associations = UserAssociationsService(self.db)
        affected_portal_account_ids = associations.affected_portal_account_ids(
            user,
            payload,
        )
        portal_roles_before = capture_effective_portal_roles(
            self.db,
            user_ids=[user.id],
            account_ids=affected_portal_account_ids,
        )
        security_changed = self._apply_identity_updates(user, payload)
        next_role, role_security_changed = self._apply_role_updates(user, payload)
        security_changed = security_changed or role_security_changed
        self._apply_access_updates(user, payload, role=next_role)
        self._apply_association_updates(user, payload, associations)
        if security_changed:
            user.auth_version += 1
        self.db.add(user)
        self.db.flush()
        portal_roles_after = capture_effective_portal_roles(
            self.db,
            user_ids=[user.id],
            account_ids=affected_portal_account_ids,
        )
        sync_portal_role_downgrades(self.db, before=portal_roles_before, after=portal_roles_after)
        self.db.commit()
        sync_portal_role_promotions(self.db, before=portal_roles_before, after=portal_roles_after)
        self.db.refresh(user)
        if security_changed:
            from app.services.auth_session_service import AuthSessionService

            AuthSessionService(self.db).revoke_all_for_user(
                user,
                "user_security_changed",
                increment_version=False,
            )
        logger.debug("Updated user id=%s email=%s", user.id, user.email)
        return user

    def update_current_user(
        self,
        user: User,
        *,
        full_name: Optional[str] = None,
        ui_language: Optional[str] = None,
        update_ui_language: bool = False,
        quota_alerts_enabled: Optional[bool] = None,
        update_quota_alerts_enabled: bool = False,
        quota_alerts_global_watch: Optional[bool] = None,
        update_quota_alerts_global_watch: bool = False,
        ui_preferences: Optional[UiPreferences] = None,
        update_ui_preferences: bool = False,
        avatar_preference: Optional[UserAvatarPreference] = None,
        update_avatar_preference: bool = False,
        current_password: Optional[str] = None,
        new_password: Optional[str] = None,
    ) -> User:
        normalized_name = full_name.strip() if full_name is not None else None
        if full_name is not None:
            user.full_name = normalized_name or None
            user.display_name = normalized_name or None
        if update_ui_language:
            user.ui_language = ui_language or None
        if update_quota_alerts_enabled:
            user.quota_alerts_enabled = bool(quota_alerts_enabled)
        if update_quota_alerts_global_watch:
            if not is_admin_ui_role(user.role) and bool(quota_alerts_global_watch):
                raise ValueError("Global quota watch requires admin role")
            user.quota_alerts_global_watch = bool(quota_alerts_global_watch) if is_admin_ui_role(user.role) else False
        if update_ui_preferences:
            user.ui_preferences_json = _dump_ui_preferences(ui_preferences or UiPreferences())
        if update_avatar_preference:
            UserAvatarService(self.db).set_preference(user, avatar_preference or "auto")

        password_changed = False
        if current_password is not None or new_password is not None:
            if not current_password or not new_password:
                raise ValueError("Both current_password and new_password are required")
            if not user.hashed_password:
                raise ValueError("Password change is unavailable for this account")
            if not verify_password(current_password, user.hashed_password):
                raise ValueError("Current password is incorrect")
            validate_password_policy(new_password)
            user.hashed_password = get_password_hash(new_password)
            user.auth_version += 1
            password_changed = True

        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        if password_changed:
            from app.services.auth_session_service import AuthSessionService

            AuthSessionService(self.db).revoke_all_for_user(
                user,
                "password_changed",
                increment_version=False,
            )
        logger.debug("Updated profile for user id=%s", user.id)
        return user

    def delete_user(self, user_id: int) -> None:
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            raise ValueError("User not found")
        require_no_private_storage_space_ownership(self.db, user_id=user.id)
        created_connection_rows = (
            self.db.query(S3Connection.id, S3Connection.is_shared)
            .filter(S3Connection.created_by_user_id == user.id)
            .all()
        )
        created_shared_ids = sorted([row[0] for row in created_connection_rows if bool(row[1])])
        if created_shared_ids:
            created_shared_str = ", ".join(str(conn_id) for conn_id in created_shared_ids)
            raise ValueError(
                f"Cannot delete user with shared S3 connections created by this user: {created_shared_str}"
            )
        created_private_ids = [
            row[0]
            for row in created_connection_rows
            if not bool(row[1])
        ]
        from app.services.portal_service import PortalService

        portal_service = PortalService(self.db)
        portal_accounts = (
            self.db.query(S3Account)
            .join(AccountIAMUser, AccountIAMUser.account_id == S3Account.id)
            .filter(AccountIAMUser.user_id == user.id)
            .all()
        )
        for account in portal_accounts:
            portal_service.sync_existing_portal_user_access(
                user,
                account,
                None,
            )
        # Remove dependent links/tokens first to satisfy FK constraints on PostgreSQL.
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
        (
            self.db.query(UserUiGroup)
            .filter(UserUiGroup.user_id == user.id)
            .delete(synchronize_session=False)
        )
        if created_private_ids:
            (
                self.db.query(UserS3Connection)
                .filter(UserS3Connection.s3_connection_id.in_(created_private_ids))
                .delete(synchronize_session=False)
            )
            (
                self.db.query(S3Connection)
                .filter(S3Connection.id.in_(created_private_ids))
                .delete(synchronize_session=False)
            )
        (
            self.db.query(ApiToken)
            .filter(ApiToken.user_id == user.id)
            .delete(synchronize_session=False)
        )
        auth_session_ids = [
            row[0]
            for row in self.db.query(AuthSession.id).filter(AuthSession.user_id == user.id).all()
        ]
        if auth_session_ids:
            self.db.query(RefreshToken).filter(
                RefreshToken.auth_session_id.in_(auth_session_ids)
            ).delete(synchronize_session=False)
            self.db.query(AuthSession).filter(
                AuthSession.id.in_(auth_session_ids)
            ).delete(synchronize_session=False)
        (
            self.db.query(AuditLog)
            .filter(AuditLog.user_id == user.id)
            .update({AuditLog.user_id: None}, synchronize_session=False)
        )
        (
            self.db.query(BucketMigration)
            .filter(BucketMigration.created_by_user_id == user.id)
            .update({BucketMigration.created_by_user_id: None}, synchronize_session=False)
        )
        # Private bucket UI tags must disappear with their owner. Turning them
        # into global definitions would silently make private metadata shared.
        (
            self.db.query(TagDefinition)
            .filter(
                TagDefinition.owner_user_id == user.id,
                TagDefinition.domain_kind.in_(
                    [TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN, TAG_DOMAIN_BUCKET_UI_STORAGE_OPS]
                ),
            )
            .delete(synchronize_session=False)
        )
        (
            self.db.query(TagDefinition)
            .filter(TagDefinition.owner_user_id == user.id)
            .update({TagDefinition.owner_user_id: None}, synchronize_session=False)
        )
        self.db.delete(user)
        self.db.commit()
        logger.debug("Deleted user id=%s email=%s", user.id, user.email)

    def list_users(self) -> list[User]:
        return self.db.query(User).all()

    def list_users_minimal(self) -> list[UserSummary]:
        rows = self.db.query(User).order_by(User.email.asc()).all()
        avatar_service = UserAvatarService(self.db)
        return [
            UserSummary(
                id=row.id,
                email=row.email,
                full_name=row.full_name,
                display_name=row.display_name or row.full_name,
                avatar=avatar_service.descriptor(row),
                role=row.role,
            )
            for row in rows
        ]

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
            pattern = f"%{search_value}%"
            query = (
                query.outerjoin(UserS3Account, User.id == UserS3Account.user_id)
                .outerjoin(S3Account, UserS3Account.account_id == S3Account.id)
                .outerjoin(UserS3User, User.id == UserS3User.user_id)
                .outerjoin(S3User, UserS3User.s3_user_id == S3User.id)
                .outerjoin(UserS3Connection, User.id == UserS3Connection.user_id)
                .outerjoin(
                    linked_connection,
                    and_(
                        UserS3Connection.s3_connection_id == linked_connection.id,
                        linked_connection.is_shared.is_(True),
                    ),
                )
                .outerjoin(UserUiGroup, User.id == UserUiGroup.user_id)
                .outerjoin(UiGroup, UserUiGroup.group_id == UiGroup.id)
            )
            query = query.filter(
                or_(
                    User.email.ilike(pattern),
                    User.role.ilike(pattern),
                    S3Account.name.ilike(pattern),
                    S3Account.rgw_account_id.ilike(pattern),
                    func.coalesce(S3User.name, "").ilike(pattern),
                    func.coalesce(S3User.rgw_user_uid, "").ilike(pattern),
                    func.coalesce(linked_connection.name, "").ilike(pattern),
                    func.coalesce(UiGroup.name, "").ilike(pattern),
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
        output_service = UserOutputService(self.db)
        preloaded = output_service.preload(rows)
        outputs = [
            output_service.to_out(user, preloaded=preloaded)
            for user in rows
        ]
        return outputs, total

    def assign_user_to_account(
        self,
        user_id: int,
        account_id: int,
        account_root: Optional[bool] = None,
        *,
        role: Optional[str] = None,
    ) -> User:
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            raise ValueError("User not found")
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise ValueError("S3Account not found")
        before_roles = capture_effective_portal_roles(
            self.db,
            user_ids=[user.id],
            account_ids=[account.id],
        )
        link = (
            self.db.query(UserS3Account)
            .filter(UserS3Account.user_id == user.id, UserS3Account.account_id == account.id)
            .first()
        )
        if user.role == UserRole.UI_NONE.value:
            user.role = UserRole.UI_USER.value
        resolved_account_root = (
            bool(link.is_root)
            if account_root is None and link is not None
            else bool(account_root)
        )
        canonical_role = role
        if resolved_account_root:
            canonical_role = "account_administrator"
        elif canonical_role is None and link is not None:
            canonical_role = link.role
        canonical_role = require_account_role(canonical_role)
        if not link:
            link = UserS3Account(
                user_id=user.id,
                account_id=account.id,
                is_root=resolved_account_root,
                role=canonical_role,
            )
        link.is_root = resolved_account_root
        link.role = canonical_role
        link.updated_at = utcnow()
        self.db.add(link)
        self.db.add(user)
        self.db.flush()
        after_roles = capture_effective_portal_roles(
            self.db,
            user_ids=[user.id],
            account_ids=[account.id],
        )
        try:
            sync_portal_role_downgrades(self.db, before=before_roles, after=after_roles)
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        sync_portal_role_promotions(self.db, before=before_roles, after=after_roles)
        self.db.refresh(user)
        return user

    def unassign_user_from_account(self, user_id: int, account_id: int) -> User:
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            raise ValueError("User not found")
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise ValueError("S3Account not found")
        link = (
            self.db.query(UserS3Account)
            .filter(
                UserS3Account.user_id == user.id,
                UserS3Account.account_id == account.id,
            )
            .first()
        )
        if not link:
            raise ValueError("Account link not found")
        if link.is_root:
            raise ValueError("Cannot remove the root account link")

        before_roles = capture_effective_portal_roles(
            self.db,
            user_ids=[user.id],
            account_ids=[account.id],
        )
        self.db.delete(link)
        self.db.flush()
        after_roles = capture_effective_portal_roles(
            self.db,
            user_ids=[user.id],
            account_ids=[account.id],
        )
        try:
            sync_portal_role_downgrades(
                self.db,
                before=before_roles,
                after=after_roles,
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        sync_portal_role_promotions(
            self.db,
            before=before_roles,
            after=after_roles,
        )
        self.db.refresh(user)
        return user

    def authenticate(self, email: str, password: str) -> Optional[User]:
        user = self.get_by_email(email)
        if not user or not user.is_active or not user.hashed_password:
            consume_dummy_password_hash(password)
            return None
        valid, updated_hash = verify_and_update_password(password, user.hashed_password)
        if not valid:
            return None
        if updated_hash:
            user.hashed_password = updated_hash
            user.auth_version += 1
            self.db.add(user)
            self.db.commit()
            from app.services.auth_session_service import AuthSessionService

            AuthSessionService(self.db).revoke_all_for_user(
                user,
                "password_rehashed",
                increment_version=False,
            )
            self.db.refresh(user)
        logger.debug("Authenticated user id=%s email=%s", user.id, user.email)
        return self.mark_last_login(user)

    def user_to_out(
        self,
        user: User,
    ) -> UserOut:
        return UserOutputService(self.db).to_out(user)

    def mark_last_login(self, user: User) -> User:
        user.last_login_at = utcnow()
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def get_or_create_oidc_user(
        self,
        *,
        provider: str,
        subject: str,
        email: Optional[str],
        full_name: Optional[str],
        picture_url: Optional[str],
    ) -> tuple[User, bool]:
        return ExternalIdentityUserService(self.db).get_or_create_oidc_user(
            provider=provider,
            subject=subject,
            email=email,
            full_name=full_name,
            picture_url=picture_url,
        )

    def get_or_create_ldap_user(
        self,
        *,
        provider: str,
        subject: str,
        email: Optional[str],
        full_name: Optional[str],
    ) -> tuple[User, bool]:
        return ExternalIdentityUserService(self.db).get_or_create_ldap_user(
            provider=provider,
            subject=subject,
            email=email,
            full_name=full_name,
        )


def get_users_service(db: Session) -> UsersService:
    return UsersService(db)
