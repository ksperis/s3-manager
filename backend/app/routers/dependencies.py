# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import base64
import binascii
import hashlib
from app.utils.time import utcnow
from dataclasses import dataclass, field
import logging
from typing import Optional, Union

from fastapi import Depends, HTTPException, Query, Request, status, Header
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import decode_token
from app.db import (
    S3Account,
    S3Connection,
    S3User,
    StorageEndpoint,
    StorageProvider,
    User,
    UserS3Account,
    UserS3Connection,
    UserS3User,
    UserRole,
    is_admin_ui_role,
    is_superadmin_ui_role,
)
from app.models.session import ManagerSessionPrincipal
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.services.app_settings_service import load_app_settings
from app.services.audit_service import AuditService, get_audit_service as build_audit_service
from app.services.api_token_service import ApiTokenService
from app.services.session_service import SessionService
from app.models.browser import SseCustomerContext
from app.services.storage_endpoints_service import get_storage_endpoints_service
from app.services.connection_identity_service import ConnectionIdentityService
from app.utils.s3_connection_capabilities import s3_connection_can_manage_iam
from app.utils.rgw import has_supervision_credentials
from app.utils.storage_endpoint_features import resolve_admin_endpoint, resolve_feature_flags
from app.utils.s3_connection_endpoint import resolve_connection_endpoint
from app.utils.s3_endpoint import normalize_s3_endpoint, resolve_s3_endpoint

settings = get_settings()
logger = logging.getLogger(__name__)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.api_v1_prefix}/auth/login")
ManagerActor = Union[User, ManagerSessionPrincipal]


@dataclass
class AccountCapabilities:
    can_manage_buckets: bool = False
    can_manage_iam: bool = False
    can_view_root_key: bool = False
    using_root_key: bool = False


@dataclass
class AccountAccess:
    account: S3Account
    actor: ManagerActor
    membership: Optional[UserS3Account]
    capabilities: AccountCapabilities


@dataclass
class BucketMigrationAccessScope:
    user: User
    allowed_context_ids: set[str]
    admin_account_context_ids: set[str] = field(default_factory=set)


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
    api_token_user = ApiTokenService(db).resolve_user_from_claims(payload)
    if api_token_user:
        return api_token_user
    if payload.get("typ") == "api_admin" or payload.get("auth_type") == "api_token":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API token expired or invalid")
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
    if not is_admin_ui_role(user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def get_current_ui_superadmin(user: User = Depends(get_current_user)) -> User:
    if not is_superadmin_ui_role(user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def get_current_ceph_admin(user: User = Depends(get_current_user)) -> User:
    if not is_admin_ui_role(user.role) or not bool(user.can_access_ceph_admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def get_current_storage_ops_admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in {
        UserRole.UI_SUPERADMIN.value,
        UserRole.UI_ADMIN.value,
        UserRole.UI_USER.value,
    } or not bool(user.can_access_storage_ops):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def get_current_account_admin(actor: ManagerActor = Depends(get_current_actor)) -> ManagerActor:
    if isinstance(actor, User):
        if actor.role not in {UserRole.UI_SUPERADMIN.value, UserRole.UI_ADMIN.value, UserRole.UI_USER.value}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
        return actor
    return actor


def get_current_account_user(user: User = Depends(get_current_user)) -> User:
    if user.role not in {
        UserRole.UI_SUPERADMIN.value,
        UserRole.UI_ADMIN.value,
        UserRole.UI_USER.value,
    }:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def require_internal_cron_token(x_internal_token: Optional[str] = Header(None, alias="X-Internal-Token")) -> None:
    expected = settings.internal_cron_token
    if not expected:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Internal token is not configured")
    if not x_internal_token or x_internal_token != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal token")


def get_optional_sse_customer_context(
    sse_customer_key: Optional[str] = Header(default=None, alias="X-S3-SSE-C-Key"),
    sse_customer_algorithm: Optional[str] = Header(default=None, alias="X-S3-SSE-C-Algorithm"),
) -> Optional[SseCustomerContext]:
    key_raw = sse_customer_key.strip() if isinstance(sse_customer_key, str) else ""
    algo_raw = sse_customer_algorithm.strip() if isinstance(sse_customer_algorithm, str) else ""
    if not key_raw:
        if algo_raw:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="X-S3-SSE-C-Algorithm requires X-S3-SSE-C-Key",
            )
        return None
    if algo_raw and algo_raw != "AES256":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-S3-SSE-C-Algorithm must be AES256",
        )
    try:
        key_bytes = base64.b64decode(key_raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-S3-SSE-C-Key must be valid base64",
        ) from exc
    if len(key_bytes) != 32:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-S3-SSE-C-Key must decode to exactly 32 bytes",
        )
    normalized_key = base64.b64encode(key_bytes).decode("ascii")
    key_md5 = base64.b64encode(hashlib.md5(key_bytes).digest()).decode("ascii")
    return SseCustomerContext(algorithm="AES256", key=normalized_key, key_md5=key_md5)


def _parse_account_selector(account_ref: Optional[str]) -> tuple[Optional[int], Optional[int], Optional[int], Optional[int]]:
    if account_ref is None or account_ref == "":
        return None, None, None, None
    if isinstance(account_ref, str) and account_ref.lower() in {"-1", "null"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account identifier")
    if isinstance(account_ref, str) and account_ref.startswith("conn-"):
        suffix = account_ref.split("conn-", 1)[1]
        if not suffix.isdigit():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid connection identifier")
        return None, None, int(suffix), None
    if isinstance(account_ref, str) and account_ref.startswith("s3u-"):
        suffix = account_ref.split("s3u-", 1)[1]
        if not suffix.isdigit():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid S3 user identifier")
        return None, int(suffix), None, None
    if isinstance(account_ref, str) and account_ref.startswith("ceph-admin-"):
        suffix = account_ref.split("ceph-admin-", 1)[1]
        if not suffix.isdigit():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Ceph Admin endpoint identifier")
        return None, None, None, int(suffix)
    try:
        value = int(account_ref)
        if value <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account identifier")
        return value, None, None, None
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account identifier")


def _build_s3_connection_account(conn: S3Connection) -> S3Account:
    """Builds an S3Account-like context for a user-scoped connection.

    We intentionally keep manager routers and services working with S3Account
    for now. This wrapper is an implementation detail and must remain hidden
    from the admin UX.
    """
    account = S3Account(
        name=conn.name,
        rgw_account_id=None,
        email=None,
        rgw_user_uid=None,
    )
    # Use an out-of-band negative id range to avoid clashes with s3_users.
    account.id = -(1_000_000 + conn.id)
    account.rgw_access_key = conn.access_key_id
    account.rgw_secret_key = conn.secret_access_key
    account.storage_endpoint_id = conn.storage_endpoint_id
    account.storage_endpoint = conn.storage_endpoint
    # Let resolve_s3_endpoint() pick it up.
    endpoint_url, region, force_path_style, verify_tls = resolve_connection_endpoint(conn)
    account.storage_endpoint_url = endpoint_url  # type: ignore[attr-defined]
    account._session_region = region  # type: ignore[attr-defined]
    account._session_force_path_style = force_path_style  # type: ignore[attr-defined]
    account._session_verify_tls = verify_tls  # type: ignore[attr-defined]
    account.s3_connection_id = conn.id  # type: ignore[attr-defined]
    account._session_token = conn.session_token  # type: ignore[attr-defined]
    account._source_connection = conn  # type: ignore[attr-defined]
    return account


def _connection_iam_capable(conn: S3Connection) -> bool:
    return s3_connection_can_manage_iam(getattr(conn, "capabilities_json", None))


def _build_s3_user_account(s3_user: S3User) -> S3Account:
    account = S3Account(
        name=s3_user.name,
        rgw_account_id=None,
        email=s3_user.email,
        rgw_user_uid=s3_user.rgw_user_uid,
    )
    # Keep an out-of-band negative id to avoid collisions with RGW account ids.
    account.id = -(100_000 + s3_user.id)
    account.rgw_access_key = s3_user.rgw_access_key
    account.rgw_secret_key = s3_user.rgw_secret_key
    account.storage_endpoint_id = s3_user.storage_endpoint_id
    account.storage_endpoint = s3_user.storage_endpoint
    account.s3_user_id = s3_user.id  # type: ignore[attr-defined]
    return account


def _resolve_s3_user_context(db: Session, user: User, s3_user_id: int) -> S3Account:
    link = (
        db.query(UserS3User)
        .filter(
            UserS3User.user_id == user.id,
            UserS3User.s3_user_id == s3_user_id,
        )
        .first()
    )
    if not link:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this S3 user")

    s3_user = db.query(S3User).filter(S3User.id == s3_user_id).first()
    if not s3_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3 user not found")

    account = _build_s3_user_account(s3_user)
    account.set_session_credentials(s3_user.rgw_access_key, s3_user.rgw_secret_key)
    account._manager_capabilities = AccountCapabilities(  # type: ignore[attr-defined]
        can_manage_buckets=True,
        can_manage_iam=False,
        can_view_root_key=False,
        using_root_key=False,
    )
    return account


def _build_ceph_admin_browser_account(endpoint: StorageEndpoint) -> S3Account:
    account = S3Account(
        name=f"ceph-admin:{endpoint.id}",
        rgw_account_id=None,
        email=None,
        rgw_user_uid=None,
    )
    account.id = -(2_000_000 + endpoint.id)
    account.rgw_access_key = endpoint.ceph_admin_access_key
    account.rgw_secret_key = endpoint.ceph_admin_secret_key
    account.storage_endpoint_id = endpoint.id
    account.storage_endpoint = endpoint
    account.ceph_admin_endpoint_id = endpoint.id  # type: ignore[attr-defined]
    account.set_session_credentials(endpoint.ceph_admin_access_key, endpoint.ceph_admin_secret_key)
    account._manager_capabilities = AccountCapabilities(  # type: ignore[attr-defined]
        can_manage_buckets=True,
        can_manage_iam=False,
        can_view_root_key=False,
        using_root_key=False,
    )
    return account


def _resolve_connection_context(
    db: Session,
    user: User,
    connection_id: int,
    *,
    surface: str,
    touch_usage: bool = True,
) -> S3Account:
    """Resolve an S3Connection context.

    Access is granted if:
    - user is the creator for private connections, or
    - the user is explicitly linked for shared connections.
    """
    conn = db.query(S3Connection).filter(S3Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
    if not bool(conn.is_active):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3Connection is disabled")
    if conn.is_temporary and conn.expires_at and conn.expires_at <= utcnow():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3Connection expired")
    if surface == "manager" and not bool(conn.access_manager):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This S3Connection cannot be used in manager workspace")
    if surface == "browser" and not bool(conn.access_browser):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This S3Connection cannot be used in browser workspace")
    if not conn.is_shared and conn.created_by_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this connection")
    if conn.is_shared:
        link = (
            db.query(UserS3Connection)
            .filter(
                UserS3Connection.user_id == user.id,
                UserS3Connection.s3_connection_id == conn.id,
            )
            .first()
        )
        if not link:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this connection")

    # Keep a minimal usage signal for UX (recently used sorting / hints).
    if touch_usage:
        try:
            now = utcnow()
            conn.last_used_at = now
            conn.updated_at = now
            db.commit()
        except Exception:
            db.rollback()
    account = _build_s3_connection_account(conn)
    account.set_session_credentials(conn.access_key_id, conn.secret_access_key)
    can_manage_iam = _connection_iam_capable(conn)
    account._manager_capabilities = AccountCapabilities(  # type: ignore[attr-defined]
        can_manage_buckets=True,
        can_manage_iam=can_manage_iam,
        can_view_root_key=False,
        using_root_key=False,
    )
    return account


def _resolve_ceph_admin_browser_context(db: Session, actor: User, endpoint_id: int, *, surface: str) -> S3Account:
    if surface != "browser":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ceph Admin context is only allowed in browser workspace")
    app_settings = load_app_settings()
    if not app_settings.general.ceph_admin_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ceph Admin feature is disabled")
    if not app_settings.general.browser_ceph_admin_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Browser is disabled for Ceph Admin workspace")
    if not is_admin_ui_role(actor.role) or not bool(actor.can_access_ceph_admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for Ceph Admin browser workspace")

    endpoint = db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
    if not endpoint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage endpoint not found")
    provider = StorageProvider(str(endpoint.provider))
    if provider != StorageProvider.CEPH:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Storage endpoint is not a Ceph provider")

    access_key = endpoint.ceph_admin_access_key
    secret_key = endpoint.ceph_admin_secret_key
    if not access_key or not secret_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Ceph Admin credentials are not configured for this storage endpoint",
        )
    if not normalize_s3_endpoint(getattr(endpoint, "endpoint_url", None)):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="S3 endpoint URL is not configured for this storage endpoint",
        )
    from app.routers.ceph_admin.dependencies import validate_ceph_admin_service_identity

    identity_validation_error = validate_ceph_admin_service_identity(endpoint)
    if identity_validation_error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=identity_validation_error)
    return _build_ceph_admin_browser_account(endpoint)


def _resolve_workspace_surface(request: Optional[Request]) -> str:
    if not request:
        return "manager"
    path = str(request.url.path)
    browser_prefix = f"{settings.api_v1_prefix}/browser"
    if path.startswith(browser_prefix):
        return "browser"
    return "manager"


def _resolve_default_account_id(db: Session, user: User) -> int:
    links = db.query(UserS3Account).filter(UserS3Account.user_id == user.id).all()
    if len(links) == 1:
        return links[0].account_id
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="S3Account id required")


def _resolve_account_by_id(db: Session, account_id: int) -> S3Account:
    account = db.query(S3Account).filter(S3Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Account not found")
    account.clear_session_credentials()
    return account


def _resolve_user_account_link(
    db: Session,
    user: User,
    account_id: Optional[int],
    allow_default: bool,
) -> tuple[S3Account, UserS3Account]:
    if account_id is None or account_id <= 0:
        if not allow_default:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="S3Account id required")
        account_id = _resolve_default_account_id(db, user)
    account = _resolve_account_by_id(db, account_id)
    link = (
        db.query(UserS3Account)
        .filter(UserS3Account.user_id == user.id, UserS3Account.account_id == account.id)
        .first()
    )
    if not link:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
    return account, link


def _manager_membership_capabilities(
    link: UserS3Account,
) -> AccountCapabilities:
    is_account_admin = bool(link.account_admin or link.is_root)
    if not is_account_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
    return AccountCapabilities(
        can_manage_buckets=True,
        can_manage_iam=True,
        can_view_root_key=True,
        using_root_key=True,
    )


def _resolve_session_account(
    db: Session,
    actor: ManagerSessionPrincipal,
    account_id: Optional[int],
    requested_endpoint: Optional[str] = None,
) -> S3Account:
    if not actor.account_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3Account context unavailable for session")
    account: Optional[S3Account] = None
    if account_id and account_id > 0:
        account = _resolve_account_by_id(db, account_id)
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
    resolved_endpoint: Optional[StorageEndpoint] = None
    if not requested_endpoint and not resolve_s3_endpoint(account):
        endpoint = _resolve_default_endpoint(db)
        requested_endpoint = endpoint.endpoint_url
        resolved_endpoint = endpoint
    elif requested_endpoint:
        resolved_endpoint = (
            db.query(StorageEndpoint)
            .filter(StorageEndpoint.endpoint_url == requested_endpoint)
            .first()
        )
    if resolved_endpoint:
        account.storage_endpoint_id = resolved_endpoint.id
        account.storage_endpoint = resolved_endpoint
    if requested_endpoint:
        account._session_endpoint = requested_endpoint  # type: ignore[attr-defined]
    return account


def _resolve_requested_session_endpoint(
    db: Session,
    actor: ManagerSessionPrincipal,
    requested_endpoint: Optional[str],
) -> Optional[str]:
    pinned_endpoint = normalize_s3_endpoint(getattr(actor.capabilities, "endpoint_url", None))
    if pinned_endpoint:
        if requested_endpoint and requested_endpoint != pinned_endpoint:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Endpoint override is not allowed for this session")
        return pinned_endpoint
    if not requested_endpoint:
        return None
    general = load_app_settings().general
    if general.allow_login_custom_endpoint:
        return requested_endpoint
    if general.allow_login_endpoint_list:
        service = get_storage_endpoints_service(db)
        if any(endpoint.endpoint_url == requested_endpoint for endpoint in service.list_endpoints()):
            return requested_endpoint
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Endpoint is not allowed for this session")


def get_account_context(
    request: Request,
    account_ref: Optional[str] = Query(default=None, alias="account_id"),
    actor: ManagerActor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> S3Account:
    account_id, s3_user_id, connection_id, ceph_admin_endpoint_id = _parse_account_selector(account_ref)
    surface = _resolve_workspace_surface(request)
    requested_endpoint = normalize_s3_endpoint(request.headers.get("X-S3-Endpoint")) if request else None
    if isinstance(actor, ManagerSessionPrincipal):
        requested_endpoint = _resolve_requested_session_endpoint(db, actor, requested_endpoint)
    else:
        # UI users are bound to the endpoint configured on the selected account.
        requested_endpoint = None
    is_storage_ops_surface = bool(request and str(request.url.path).startswith(f"{settings.api_v1_prefix}/storage-ops"))
    if isinstance(actor, User):
        if ceph_admin_endpoint_id is not None:
            return _resolve_ceph_admin_browser_context(db, actor, ceph_admin_endpoint_id, surface=surface)
        if connection_id is not None:
            return _resolve_connection_context(
                db,
                actor,
                connection_id,
                surface=surface,
                touch_usage=not is_storage_ops_surface,
            )
        if s3_user_id is not None:
            return _resolve_s3_user_context(db, actor, s3_user_id)
        account, link = _resolve_user_account_link(db, actor, account_id, allow_default=False)
        capabilities = _manager_membership_capabilities(link)
        if not capabilities.can_manage_buckets:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Admin credentials are not configured for this account",
            )
        account.set_session_credentials(access_key, secret_key)
        account._manager_capabilities = capabilities  # type: ignore[attr-defined]
        return account

    if s3_user_id is not None or connection_id is not None or ceph_admin_endpoint_id is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sessions cannot assume this context")

    account = _resolve_session_account(db, actor, account_id, requested_endpoint=requested_endpoint)
    account._manager_capabilities = AccountCapabilities(  # type: ignore[attr-defined]
        can_manage_buckets=actor.capabilities.can_manage_buckets,
        can_manage_iam=actor.capabilities.can_manage_iam,
        can_view_root_key=False,
        using_root_key=False,
    )
    return account


def _membership_capabilities(link: Optional[UserS3Account], actor: ManagerActor) -> AccountCapabilities:
    if link:
        is_account_admin = bool(link.account_admin or link.is_root)
        if not is_account_admin:
            return AccountCapabilities()
        return AccountCapabilities(
            can_manage_buckets=True,
            can_manage_iam=True,
            can_view_root_key=True,
            using_root_key=is_account_admin,
        )
    if isinstance(actor, ManagerSessionPrincipal):
        return AccountCapabilities(
            can_manage_buckets=actor.capabilities.can_manage_buckets,
            can_manage_iam=actor.capabilities.can_manage_iam,
            can_view_root_key=False,
            using_root_key=False,
        )
    return AccountCapabilities()


def get_account_access(
    account_ref: Optional[str] = Query(default=None, alias="account_id"),
    actor: ManagerActor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> AccountAccess:
    account_id, s3_user_id, connection_id, ceph_admin_endpoint_id = _parse_account_selector(account_ref)
    if s3_user_id is not None or connection_id is not None or ceph_admin_endpoint_id is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3 user context is not supported here")

    # Resolve target account
    if isinstance(actor, User):
        account, link = _resolve_user_account_link(db, actor, account_id, allow_default=True)
        capabilities = _membership_capabilities(link, actor)
        if not capabilities.can_manage_buckets:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
        return AccountAccess(account=account, actor=actor, membership=link, capabilities=capabilities)

    # Session principal
    account = _resolve_session_account(db, actor, account_id)
    capabilities = _membership_capabilities(None, actor)
    return AccountAccess(account=account, actor=actor, membership=None, capabilities=capabilities)


def _ensure_manager_capabilities(account: S3Account, require_iam: bool = False, require_usage: bool = False) -> None:
    caps: Optional[AccountCapabilities] = getattr(account, "_manager_capabilities", None)  # type: ignore[attr-defined]
    if not caps:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account context unavailable")
    if require_iam and not caps.can_manage_iam:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="IAM management not allowed for this account")
    if require_iam:
        endpoint = getattr(account, "storage_endpoint", None)
        if endpoint and not resolve_feature_flags(endpoint).iam_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="IAM is disabled for this endpoint")
    if require_usage and not caps.can_manage_buckets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage metrics not available for this account")


def _require_supervision_access(
    account: S3Account,
    actor: ManagerActor,
    disabled_detail: str,
    required_feature: str,
) -> ManagerActor:
    caps: Optional[AccountCapabilities] = getattr(account, "_manager_capabilities", None)  # type: ignore[attr-defined]
    endpoint = getattr(account, "storage_endpoint", None)

    connection_id = getattr(account, "s3_connection_id", None)
    if connection_id is not None:
        source_connection = getattr(account, "_source_connection", None)
        if source_connection is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Metrics are unavailable: connection context is incomplete.",
            )
        resolution = ConnectionIdentityService().resolve_metrics_identity(source_connection)
        if not resolution.eligible:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=resolution.reason or disabled_detail)
        if required_feature == "metrics" and not resolution.metrics_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage metrics are disabled for this endpoint")
        if required_feature == "usage" and not resolution.usage_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage logs are disabled for this endpoint")
        if resolution.rgw_account_id:
            account.rgw_account_id = resolution.rgw_account_id
        if resolution.rgw_user_uid:
            account.rgw_user_uid = resolution.rgw_user_uid

    if endpoint:
        flags = resolve_feature_flags(endpoint)
        if required_feature == "metrics" and not flags.metrics_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=disabled_detail)
        if required_feature == "usage" and not flags.usage_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=disabled_detail)
    if not has_supervision_credentials(account):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Supervision credentials are not configured for this account")
    if isinstance(actor, ManagerSessionPrincipal) and not actor.capabilities.can_view_traffic:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Metrics are not available for this profile")
    if caps and not caps.can_manage_buckets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Metrics are not available for this account")
    if caps and isinstance(actor, User) and not caps.using_root_key:
        settings = load_app_settings()
        if not settings.manager.allow_manager_user_usage_stats:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Metrics are not available for this profile")
    return actor


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
    return _require_supervision_access(
        account,
        actor,
        disabled_detail="Storage metrics are disabled for this endpoint",
        required_feature="metrics",
    )


def require_sns_capable_manager(
    account: S3Account = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_actor),
) -> ManagerActor:
    _ensure_manager_capabilities(account)
    endpoint = getattr(account, "storage_endpoint", None)
    if endpoint:
        flags = resolve_feature_flags(endpoint)
        if not flags.sns_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SNS topics are disabled for this endpoint")
    return actor


def require_metrics_capable_manager(
    account: S3Account = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_actor),
) -> ManagerActor:
    return _require_supervision_access(
        account,
        actor,
        disabled_detail="Usage logs are disabled for this endpoint",
        required_feature="usage",
    )


def _ensure_bucket_migration_allowed(user: User) -> None:
    app_settings = load_app_settings()
    if not app_settings.general.bucket_migration_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket migration feature is disabled")
    if is_admin_ui_role(user.role):
        return
    if user.role == UserRole.UI_USER.value and bool(app_settings.general.allow_ui_user_bucket_migration):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")


def _manager_link_allows_bucket_migration(
    link: UserS3Account,
) -> bool:
    return bool(link.account_admin or link.is_root)


def _build_bucket_migration_allowed_context_ids(db: Session, user: User) -> set[str]:
    allowed_context_ids: set[str] = set()

    if is_superadmin_ui_role(user.role):
        allowed_context_ids.update(str(row[0]) for row in db.query(S3Account.id).all())
        allowed_context_ids.update(f"s3u-{row[0]}" for row in db.query(S3User.id).all())
        now = utcnow()
        connections = (
            db.query(S3Connection.id)
            .filter(S3Connection.is_active.is_(True))
            .filter(S3Connection.access_manager.is_(True))
            .filter(
                (S3Connection.is_temporary.is_(False))
                | (S3Connection.expires_at.is_(None))
                | (S3Connection.expires_at > now)
            )
            .all()
        )
        allowed_context_ids.update(f"conn-{row[0]}" for row in connections)
        return allowed_context_ids

    account_links = db.query(UserS3Account).filter(UserS3Account.user_id == user.id).all()
    for link in account_links:
        if _manager_link_allows_bucket_migration(link):
            allowed_context_ids.add(str(link.account_id))

    s3_links = db.query(UserS3User).filter(UserS3User.user_id == user.id).all()
    for link in s3_links:
        allowed_context_ids.add(f"s3u-{link.s3_user_id}")

    user_connection_ids = (
        db.query(UserS3Connection.s3_connection_id)
        .filter(UserS3Connection.user_id == user.id)
    )
    now = utcnow()
    connections = (
        db.query(S3Connection)
        .filter(
            ((S3Connection.is_shared.is_(False)) & (S3Connection.created_by_user_id == user.id))
            | ((S3Connection.is_shared.is_(True)) & (S3Connection.id.in_(user_connection_ids)))
        )
        .filter(S3Connection.is_active.is_(True))
        .filter(S3Connection.access_manager.is_(True))
        .filter(
            (S3Connection.is_temporary.is_(False))
            | (S3Connection.expires_at.is_(None))
            | (S3Connection.expires_at > now)
        )
        .all()
    )
    for connection in connections:
        allowed_context_ids.add(f"conn-{connection.id}")

    return allowed_context_ids


def _build_bucket_migration_admin_account_context_ids(db: Session, user: User) -> set[str]:
    if is_superadmin_ui_role(user.role):
        return {str(row[0]) for row in db.query(S3Account.id).all()}
    admin_account_context_ids: set[str] = set()
    account_links = db.query(UserS3Account).filter(UserS3Account.user_id == user.id).all()
    for link in account_links:
        if bool(link.account_admin or link.is_root):
            admin_account_context_ids.add(str(link.account_id))
    return admin_account_context_ids


def get_current_bucket_migration_user(user: User = Depends(get_current_user)) -> User:
    _ensure_bucket_migration_allowed(user)
    return user


def get_current_bucket_migration_scope(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BucketMigrationAccessScope:
    _ensure_bucket_migration_allowed(user)
    allowed_context_ids = _build_bucket_migration_allowed_context_ids(db, user)
    admin_account_context_ids = _build_bucket_migration_admin_account_context_ids(db, user)
    return BucketMigrationAccessScope(
        user=user,
        allowed_context_ids=allowed_context_ids,
        admin_account_context_ids=admin_account_context_ids,
    )


def require_bucket_compare_enabled() -> None:
    app_settings = load_app_settings()
    if not app_settings.general.bucket_compare_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket compare feature is disabled")


def is_manager_ceph_s3_user_keys_available(account: S3Account) -> bool:
    app_settings = load_app_settings()
    if not bool(app_settings.general.manager_ceph_s3_user_keys_enabled):
        return False

    s3_user_id = getattr(account, "s3_user_id", None)
    if s3_user_id is None:
        return False

    endpoint = getattr(account, "storage_endpoint", None)
    if endpoint is None:
        return False
    if StorageProvider(str(endpoint.provider)) != StorageProvider.CEPH:
        return False

    flags = resolve_feature_flags(endpoint)
    if not flags.admin_enabled:
        return False
    if not resolve_admin_endpoint(endpoint):
        return False

    access_key = (getattr(endpoint, "admin_access_key", None) or "").strip()
    secret_key = (getattr(endpoint, "admin_secret_key", None) or "").strip()
    if not access_key or not secret_key:
        return False

    return True


def require_manager_ceph_s3_user_keys(
    account: S3Account = Depends(get_account_context),
) -> S3Account:
    if not is_manager_ceph_s3_user_keys_available(account):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ceph key management is not available for this context",
        )
    return account


def require_manager_enabled() -> None:
    settings = load_app_settings()
    if not settings.general.manager_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager feature is disabled")


def require_ceph_admin_enabled() -> None:
    settings = load_app_settings()
    if not settings.general.ceph_admin_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ceph admin feature is disabled")


def require_storage_ops_enabled() -> None:
    settings = load_app_settings()
    if not settings.general.storage_ops_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage Ops feature is disabled")


def require_browser_enabled() -> None:
    settings = load_app_settings()
    if not settings.general.browser_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Browser feature is disabled")

def require_manager_context_enabled() -> None:
    settings = load_app_settings()
    if not settings.general.manager_enabled and not settings.general.browser_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager access is disabled")


def _resolve_default_endpoint(db: Session) -> StorageEndpoint:
    service = get_storage_endpoints_service(db)
    service.ensure_default_endpoint()
    endpoint = (
        db.query(StorageEndpoint)
        .filter(StorageEndpoint.is_default.is_(True))
        .order_by(StorageEndpoint.id.asc())
        .first()
    )
    if not endpoint:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Default storage endpoint is not configured",
        )
    return endpoint


def _resolve_admin_rgw_context(db: Session, _user: User) -> tuple[str, str, str, Optional[str], bool]:
    endpoint = _resolve_default_endpoint(db)
    if StorageProvider(str(endpoint.provider)) != StorageProvider.CEPH:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Default endpoint does not support RGW admin operations",
        )
    flags = resolve_feature_flags(endpoint)
    if not flags.admin_enabled:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Admin operations are disabled for the default endpoint",
        )
    admin_endpoint = resolve_admin_endpoint(endpoint)
    if not admin_endpoint:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Admin endpoint is not configured for the default endpoint",
        )
    access_key = endpoint.admin_access_key
    secret_key = endpoint.admin_secret_key
    if not access_key or not secret_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RGW admin credentials are not configured",
        )
    return access_key, secret_key, admin_endpoint, endpoint.region, bool(getattr(endpoint, "verify_tls", True))


def get_optional_super_admin_rgw_client(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_super_admin),
) -> Optional[RGWAdminClient]:
    try:
        access_key, secret_key, admin_endpoint, region, verify_tls = _resolve_admin_rgw_context(db, user)
        return get_rgw_admin_client(
            access_key=access_key,
            secret_key=secret_key,
            endpoint=admin_endpoint,
            region=region,
            verify_tls=verify_tls,
        )
    except RGWAdminError as exc:
        logger.warning("Unable to build RGW admin client: %s", exc)
        return None
    except HTTPException as exc:
        if exc.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR:
            logger.warning("RGW admin client unavailable: %s", exc.detail)
            return None
        raise


def get_super_admin_rgw_client(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_super_admin),
) -> RGWAdminClient:
    access_key, secret_key, admin_endpoint, region, verify_tls = _resolve_admin_rgw_context(db, user)
    return get_rgw_admin_client(
        access_key=access_key,
        secret_key=secret_key,
        endpoint=admin_endpoint,
        region=region,
        verify_tls=verify_tls,
    )


def get_audit_logger(
    db: Session = Depends(get_db),
) -> AuditService:
    return build_audit_service(db)
