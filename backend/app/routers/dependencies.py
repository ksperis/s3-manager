# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from dataclasses import dataclass
import logging
from typing import Optional, Union

from fastapi import Depends, HTTPException, Query, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import decode_token
from app.db_models import AccountRole, S3Account, S3User, User, UserS3Account, UserS3User, UserRole
from app.models.session import ManagerSessionPrincipal
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.services.app_settings_service import load_app_settings
from app.services.portal_service import get_portal_service
from app.services.audit_service import AuditService, get_audit_service as build_audit_service
from app.services.session_service import SessionService
from app.services.storage_endpoints_service import get_storage_endpoints_service
from app.utils.rgw import has_supervision_credentials
from app.utils.s3_endpoint import normalize_s3_endpoint

settings = get_settings()
logger = logging.getLogger(__name__)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.api_v1_prefix}/auth/login")
ManagerActor = Union[User, ManagerSessionPrincipal]


@dataclass
class AccountCapabilities:
    can_manage_buckets: bool = False
    can_manage_portal_users: bool = False
    can_manage_iam: bool = False
    can_view_root_key: bool = False
    using_root_key: bool = False


@dataclass
class AccountAccess:
    account: S3Account
    actor: ManagerActor
    membership: Optional[UserS3Account]
    role: str
    capabilities: AccountCapabilities


def _resolve_actor(db: Session, token: str) -> ManagerActor:
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    session_id = payload.get("sid")
    if session_id:
        principal = SessionService(db).get_principal(session_id)
        if not principal:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid")
        return principal
    if "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    email = payload["sub"]
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User inactive")
    return user


def get_current_actor(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)) -> ManagerActor:
    return _resolve_actor(db, token)


def get_current_user(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)) -> User:
    actor = _resolve_actor(db, token)
    if isinstance(actor, ManagerSessionPrincipal):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Session token not allowed for this endpoint")
    return actor


def get_current_super_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.UI_ADMIN.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def get_current_account_admin(actor: ManagerActor = Depends(get_current_actor)) -> ManagerActor:
    if isinstance(actor, User):
        if actor.role not in {UserRole.UI_ADMIN.value, UserRole.UI_USER.value}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
        return actor
    return actor


def get_current_account_user(user: User = Depends(get_current_user)) -> User:
    if user.role not in {
        UserRole.UI_ADMIN.value,
        UserRole.UI_USER.value,
    }:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def _parse_account_selector(account_ref: Optional[str]) -> tuple[Optional[int], Optional[int]]:
    if account_ref is None or account_ref == "":
        return None, None
    if isinstance(account_ref, str) and account_ref.lower() in {"-1", "null"}:
        return None, None
    if isinstance(account_ref, str) and account_ref.startswith("s3u-"):
        suffix = account_ref.split("s3u-", 1)[1]
        if not suffix.isdigit():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid S3 user identifier")
        return None, int(suffix)
    try:
        value = int(account_ref)
        if value < 0:
            return None, abs(value)
        return value, None
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account identifier")


def _normalize_access_mode(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    normalized = value.strip().lower()
    if normalized in {"portal", "user"}:
        return "portal"
    if normalized in {"admin", "root"}:
        return "admin"
    return None


def _build_s3_user_account(s3_user: S3User) -> S3Account:
    account = S3Account(
        name=s3_user.name,
        rgw_account_id=None,
        email=s3_user.email,
        rgw_user_uid=s3_user.rgw_user_uid,
    )
    account.id = -s3_user.id
    account.rgw_access_key = s3_user.rgw_access_key
    account.rgw_secret_key = s3_user.rgw_secret_key
    account.storage_endpoint_id = s3_user.storage_endpoint_id
    account.storage_endpoint = s3_user.storage_endpoint
    account.s3_user_id = s3_user.id  # type: ignore[attr-defined]
    return account


def get_account_context(
    request: Request,
    account_ref: Optional[str] = Query(default=None, alias="account_id"),
    actor: ManagerActor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> S3Account:
    account_id, s3_user_id = _parse_account_selector(account_ref)
    requested_mode = _normalize_access_mode(request.headers.get("X-Manager-Access-Mode")) if request else None
    requested_endpoint = normalize_s3_endpoint(request.headers.get("X-S3-Endpoint")) if request else None
    if requested_endpoint:
        general = load_app_settings().general
        if general.allow_login_custom_endpoint:
            pass
        elif general.allow_login_endpoint_list:
            service = get_storage_endpoints_service(db)
            if not any(endpoint.endpoint_url == requested_endpoint for endpoint in service.list_endpoints()):
                requested_endpoint = None
        else:
            requested_endpoint = None
    if isinstance(actor, User):
        if s3_user_id is not None:
            s3_user = (
                db.query(S3User)
                .filter(S3User.id == s3_user_id)
                .first()
            )
            if not s3_user:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3 user not found")
            if actor.role != UserRole.UI_ADMIN.value:
                link_exists = (
                    db.query(UserS3User)
                    .filter(
                        UserS3User.user_id == actor.id,
                        UserS3User.s3_user_id == s3_user.id,
                    )
                    .first()
                )
                if not link_exists:
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this user")
            account = _build_s3_user_account(s3_user)
            account.set_session_credentials(s3_user.rgw_access_key, s3_user.rgw_secret_key)
            account._manager_capabilities = AccountCapabilities(  # type: ignore[attr-defined]
                can_manage_buckets=True,
                can_manage_portal_users=False,
                can_manage_iam=False,
                can_view_root_key=False,
                using_root_key=False,
            )
            return account
        if account_id is None or account_id <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="S3Account id required")
        account = db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Account not found")
        account.clear_session_credentials()
        link = (
            db.query(UserS3Account)
            .filter(UserS3Account.user_id == actor.id, UserS3Account.account_id == account.id)
            .first()
        )
        if not link:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
        account_role = link.account_role if link else AccountRole.PORTAL_NONE.value
        is_account_admin = bool((link.account_admin or link.is_root) if link else False)
        if account_role == AccountRole.PORTAL_NONE.value and not is_account_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
        can_portal_role = account_role != AccountRole.PORTAL_NONE.value
        if can_portal_role:
            using_root = bool(is_account_admin and requested_mode == "admin")
        else:
            using_root = bool(is_account_admin)
        can_manage_iam = bool(using_root or account_role == AccountRole.PORTAL_MANAGER.value)
        can_manage_buckets = bool(using_root or account_role in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value})
        can_manage_portal_users = bool(account_role == AccountRole.PORTAL_MANAGER.value or (is_account_admin and using_root))
        if not can_manage_buckets:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
        access_key: Optional[str]
        secret_key: Optional[str]
        if using_root:
            access_key, secret_key = account.effective_rgw_credentials()
            if not access_key or not secret_key:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="RGW admin credentials are not configured for this account",
                )
        else:
            portal_service = get_portal_service(db)
            try:
                access_key, secret_key = portal_service.get_portal_credentials(actor, account, account_role)
            except RuntimeError as exc:
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
        account.set_session_credentials(access_key, secret_key)
        account._manager_capabilities = AccountCapabilities(  # type: ignore[attr-defined]
            can_manage_buckets=can_manage_buckets,
            can_manage_portal_users=can_manage_portal_users,
            can_manage_iam=can_manage_iam,
            can_view_root_key=using_root,
            using_root_key=using_root,
        )
        return account

    if s3_user_id is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sessions cannot assume S3 user context")

    if not actor.account_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3Account context unavailable for session")

    account: Optional[S3Account] = None
    if account_id and account_id > 0:
        account = db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Account not found")
        if account.rgw_account_id and account.rgw_account_id.lower() != actor.account_id.lower():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
    else:
        account = (
            db.query(S3Account)
            .filter(S3Account.rgw_account_id == actor.account_id)
            .first()
        )
        if not account:
            account = S3Account(
                name=actor.account_name or actor.account_id,
                rgw_account_id=actor.account_id,
            )
    account.set_session_credentials(actor.access_key, actor.secret_key)
    if requested_endpoint:
        account._session_endpoint = requested_endpoint  # type: ignore[attr-defined]
    account._manager_capabilities = AccountCapabilities(  # type: ignore[attr-defined]
        can_manage_buckets=actor.capabilities.can_manage_buckets,
        can_manage_portal_users=False,
        can_manage_iam=actor.capabilities.can_manage_iam,
        can_view_root_key=False,
        using_root_key=False,
    )
    return account


def get_portal_account_context(
    account_ref: Optional[str] = Query(default=None, alias="account_id"),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> S3Account:
    account_id, s3_user_id = _parse_account_selector(account_ref)
    if s3_user_id is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3 user context is not supported here")
    if account_id is None or account_id <= 0:
        links = db.query(UserS3Account).filter(UserS3Account.user_id == user.id).all()
        if len(links) == 1:
            account_id = links[0].account_id
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="S3Account id required")
    account = db.query(S3Account).filter(S3Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Account not found")
    account.clear_session_credentials()
    link_exists = (
        db.query(UserS3Account)
        .filter(UserS3Account.user_id == user.id, UserS3Account.account_id == account.id)
        .first()
    )
    if not link_exists:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
    return account


def get_portal_account_access(
    account_ref: Optional[str] = Query(default=None, alias="account_id"),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> AccountAccess:
    account_id, s3_user_id = _parse_account_selector(account_ref)
    if s3_user_id is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3 user context is not supported here")
    if account_id is None or account_id <= 0:
        links = db.query(UserS3Account).filter(UserS3Account.user_id == user.id).all()
        if len(links) == 1:
            account_id = links[0].account_id
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="S3Account id required")
    account = db.query(S3Account).filter(S3Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Account not found")
    account.clear_session_credentials()
    link = (
        db.query(UserS3Account)
        .filter(UserS3Account.user_id == user.id, UserS3Account.account_id == account.id)
        .first()
    )
    if not link:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
    role, capabilities = _portal_membership_capabilities(link)
    if role == AccountRole.PORTAL_NONE.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
    return AccountAccess(account=account, actor=user, membership=link, role=role, capabilities=capabilities)


def _membership_capabilities(link: Optional[UserS3Account], actor: ManagerActor) -> tuple[str, AccountCapabilities]:
    if link:
        role = link.account_role or AccountRole.PORTAL_USER.value
        if role == AccountRole.PORTAL_NONE.value:
            return role, AccountCapabilities()
        # Base defaults per role / flag
        is_account_admin = bool(link.account_admin or link.is_root)
        can_manage_portal_users = role == AccountRole.PORTAL_MANAGER.value
        can_manage_buckets = role == AccountRole.PORTAL_MANAGER.value
        can_manage_iam = bool(role == AccountRole.PORTAL_MANAGER.value or link.can_manage_iam or is_account_admin)
        can_view_root_key = bool(link.can_view_root_key or is_account_admin)
        return role, AccountCapabilities(
            can_manage_buckets=can_manage_buckets,
            can_manage_portal_users=can_manage_portal_users,
            can_manage_iam=can_manage_iam,
            can_view_root_key=can_view_root_key,
            using_root_key=is_account_admin,
        )
    # Session principal or unlinked user (should be guarded earlier)
    if isinstance(actor, ManagerSessionPrincipal):
        return AccountRole.PORTAL_MANAGER.value if actor.capabilities.can_manage_buckets else AccountRole.PORTAL_USER.value, AccountCapabilities(
            can_manage_buckets=actor.capabilities.can_manage_buckets,
            can_manage_portal_users=False,
            can_manage_iam=actor.capabilities.can_manage_iam,
            can_view_root_key=False,
            using_root_key=False,
        )
    return AccountRole.PORTAL_NONE.value, AccountCapabilities()


def _portal_membership_capabilities(link: Optional[UserS3Account]) -> tuple[str, AccountCapabilities]:
    if link:
        role = link.account_role or AccountRole.PORTAL_USER.value
        if role == AccountRole.PORTAL_NONE.value:
            return role, AccountCapabilities()
        can_manage_portal_users = role == AccountRole.PORTAL_MANAGER.value
        can_manage_buckets = role == AccountRole.PORTAL_MANAGER.value
        return role, AccountCapabilities(
            can_manage_buckets=can_manage_buckets,
            can_manage_portal_users=can_manage_portal_users,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        )
    return AccountRole.PORTAL_NONE.value, AccountCapabilities()


def get_account_access(
    account_ref: Optional[str] = Query(default=None, alias="account_id"),
    actor: ManagerActor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> AccountAccess:
    account_id, s3_user_id = _parse_account_selector(account_ref)
    if s3_user_id is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3 user context is not supported here")

    # Resolve target account
    if isinstance(actor, User):
        if account_id is None or account_id <= 0:
            links = db.query(UserS3Account).filter(UserS3Account.user_id == actor.id).all()
            if len(links) == 1:
                account_id = links[0].account_id
            else:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="S3Account id required")
        account = db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Account not found")
        account.clear_session_credentials()
        link = (
            db.query(UserS3Account)
            .filter(UserS3Account.user_id == actor.id, UserS3Account.account_id == account.id)
            .first()
        )
        if not link:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
        role, capabilities = _membership_capabilities(link, actor)
        if role == AccountRole.PORTAL_NONE.value:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
        return AccountAccess(account=account, actor=actor, membership=link, role=role, capabilities=capabilities)

    # Session principal
    if not actor.account_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3Account context unavailable for session")
    account: Optional[S3Account] = None
    if account_id and account_id > 0:
        account = db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Account not found")
        if account.rgw_account_id and account.rgw_account_id.lower() != actor.account_id.lower():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
    else:
        account = (
            db.query(S3Account)
            .filter(S3Account.rgw_account_id == actor.account_id)
            .first()
        )
        if not account:
            account = S3Account(
                name=actor.account_name or actor.account_id,
                rgw_account_id=actor.account_id,
            )
    account.set_session_credentials(actor.access_key, actor.secret_key)
    role, capabilities = _membership_capabilities(None, actor)
    return AccountAccess(account=account, actor=actor, membership=None, role=role, capabilities=capabilities)


def require_portal_manager(access: AccountAccess = Depends(get_portal_account_access)) -> AccountAccess:
    if not access.capabilities.can_manage_portal_users:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager rights required for this account")
    return access


def require_portal_buckets(access: AccountAccess = Depends(get_portal_account_access)) -> AccountAccess:
    if not access.capabilities.can_manage_buckets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket management not allowed for this account")
    return access


def _ensure_manager_capabilities(account: S3Account, require_iam: bool = False, require_usage: bool = False) -> None:
    caps: Optional[AccountCapabilities] = getattr(account, "_manager_capabilities", None)  # type: ignore[attr-defined]
    if not caps:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account context unavailable")
    if require_iam and not caps.can_manage_iam:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="IAM management not allowed for this account")
    if require_usage and not caps.can_manage_buckets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage metrics not available for this account")


def require_iam_capable_manager(
    account: S3Account = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_actor),
) -> ManagerActor:
    _ensure_manager_capabilities(account, require_iam=True)
    return actor


def require_usage_capable_manager(
    account: S3Account = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_actor),
) -> ManagerActor:
    caps: Optional[AccountCapabilities] = getattr(account, "_manager_capabilities", None)  # type: ignore[attr-defined]
    if not has_supervision_credentials(account):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage metrics are not configured for this account")
    if isinstance(actor, ManagerSessionPrincipal) and not actor.capabilities.can_view_traffic:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage metrics not available for this profile")
    if caps and not caps.can_manage_buckets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage metrics not available for this account")
    if caps and isinstance(actor, User) and not caps.using_root_key:
        settings = load_app_settings()
        if not settings.manager.allow_manager_user_usage_stats:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage metrics not available for this profile")
    return actor


def require_manager_enabled() -> None:
    settings = load_app_settings()
    if not settings.general.manager_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager feature is disabled")


def require_browser_enabled() -> None:
    settings = load_app_settings()
    if not settings.general.browser_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Browser feature is disabled")


def require_portal_enabled() -> None:
    settings = load_app_settings()
    if not settings.general.portal_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal feature is disabled")


def require_manager_context_enabled() -> None:
    settings = load_app_settings()
    if not settings.general.manager_enabled and not settings.general.browser_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager access is disabled")


def _resolve_admin_rgw_credentials(user: User) -> tuple[str, str]:
    access_key = user.rgw_access_key or settings.rgw_admin_access_key or settings.s3_access_key
    secret_key = user.rgw_secret_key or settings.rgw_admin_secret_key or settings.s3_secret_key
    if not access_key or not secret_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RGW admin credentials are not configured",
        )
    return access_key, secret_key


def get_optional_super_admin_rgw_client(user: User = Depends(get_current_super_admin)) -> Optional[RGWAdminClient]:
    try:
        access_key, secret_key = _resolve_admin_rgw_credentials(user)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR:
            logger.warning("RGW admin credentials missing; proceeding without admin client")
            return None
        raise
    try:
        return get_rgw_admin_client(access_key=access_key, secret_key=secret_key)
    except RGWAdminError as exc:
        logger.warning("Unable to build RGW admin client: %s", exc)
        return None


def get_super_admin_rgw_client(user: User = Depends(get_current_super_admin)) -> RGWAdminClient:
    access_key, secret_key = _resolve_admin_rgw_credentials(user)
    return get_rgw_admin_client(access_key=access_key, secret_key=secret_key)


def get_audit_logger(
    db: Session = Depends(get_db),
) -> AuditService:
    return build_audit_service(db)
