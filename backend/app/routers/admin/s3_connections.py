# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.utils.time import utcnow
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session, aliased

from app.core.database import get_db
from app.db import S3Connection, StorageEndpoint, User, UserS3Connection
from app.models.s3_connection import (
    S3ConnectionCreate,
    S3ConnectionCredentialsUpdate,
    S3ConnectionCredentialsValidationRequest,
    S3ConnectionCredentialsValidationResult,
    S3ConnectionUpdate,
)
from app.models.s3_connection_admin import (
    PaginatedS3ConnectionsResponse,
    S3ConnectionAdminItem,
    S3ConnectionUserLink,
    S3ConnectionUserLinkUpsert,
    S3ConnectionSummary,
)
from app.routers.dependencies import get_audit_logger, get_current_super_admin
from app.services.audit_service import AuditService
from app.services.s3_connection_capabilities_service import refresh_connection_detected_capabilities
from app.services.s3_connection_validation_service import S3ConnectionValidationService
from app.utils.s3_connection_capabilities import (
    parse_s3_connection_capabilities,
    s3_connection_can_manage_iam,
)
from app.utils.s3_connection_endpoint import (
    build_custom_endpoint_config,
    parse_custom_endpoint_config,
    resolve_connection_details,
)
from app.utils.s3_connection_ordering import s3_connection_name_order_by
from app.utils.s3_connection_visibility import normalize_visibility, visibility_from_flags


router = APIRouter(prefix="/admin/s3-connections", tags=["admin-s3-connections"])
logger = logging.getLogger(__name__)


def _mask_access_key(value: str) -> str:
    if not value:
        return ""
    trimmed = value.strip()
    if len(trimmed) <= 8:
        return "***" + trimmed[-2:]
    return f"{trimmed[:4]}***{trimmed[-4:]}"


def _ensure_editable(conn: S3Connection, current_user: User) -> None:
    if conn.is_temporary:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
    if conn.is_public or conn.is_shared:
        return
    if conn.owner_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this connection")


def _linked_user_ids(db: Session, connection_id: int) -> list[int]:
    rows = (
        db.query(UserS3Connection.user_id)
        .filter(UserS3Connection.s3_connection_id == connection_id)
        .all()
    )
    return sorted([row[0] for row in rows])


def _parse_capabilities(value: Optional[str]) -> dict:
    return parse_s3_connection_capabilities(value)


def _resolve_access_flags(*, access_manager: Optional[bool], access_browser: Optional[bool]) -> tuple[bool, bool]:
    manager = bool(access_manager)
    browser = bool(access_browser)
    if not manager and not browser:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one access flag must be enabled",
        )
    return manager, browser


def _refresh_detected_capabilities(conn: S3Connection) -> None:
    refresh_connection_detected_capabilities(conn)


def _connection_iam_capable(conn: S3Connection) -> bool:
    return s3_connection_can_manage_iam(conn.capabilities_json)


def _to_admin_item(
    conn: S3Connection,
    *,
    owner_email: Optional[str],
    user_count: int,
    user_ids: list[int],
) -> S3ConnectionAdminItem:
    details = resolve_connection_details(conn)
    capabilities = _parse_capabilities(conn.capabilities_json)
    capabilities["can_manage_iam"] = _connection_iam_capable(conn)
    return S3ConnectionAdminItem(
        id=conn.id,
        name=conn.name,
        storage_endpoint_id=conn.storage_endpoint_id,
        endpoint_url=details.endpoint_url or "",
        is_public=bool(conn.is_public),
        is_shared=bool(conn.is_shared),
        is_active=bool(conn.is_active),
        visibility=visibility_from_flags(is_public=bool(conn.is_public), is_shared=bool(conn.is_shared)),
        access_manager=bool(conn.access_manager),
        access_browser=bool(conn.access_browser),
        credential_owner_type=conn.credential_owner_type,
        credential_owner_identifier=conn.credential_owner_identifier,
        provider_hint=details.provider,
        region=details.region,
        force_path_style=details.force_path_style,
        verify_tls=details.verify_tls,
        owner_user_id=conn.owner_user_id,
        owner_email=owner_email,
        user_count=int(user_count),
        user_ids=sorted(user_ids),
        last_used_at=conn.last_used_at,
        created_at=conn.created_at,
        updated_at=conn.updated_at,
        capabilities=capabilities,
    )


@router.get("", response_model=PaginatedS3ConnectionsResponse)
def list_s3_connections(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: Optional[str] = Query(None),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
) -> PaginatedS3ConnectionsResponse:
    access_link = aliased(UserS3Connection)
    linked_user = aliased(User)
    q = (
        db.query(
            S3Connection,
            func.count(UserS3Connection.id).label("user_count"),
            func.max(User.email).label("owner_email"),
        )
        .outerjoin(User, User.id == S3Connection.owner_user_id)
        .outerjoin(StorageEndpoint, StorageEndpoint.id == S3Connection.storage_endpoint_id)
        .outerjoin(access_link, access_link.s3_connection_id == S3Connection.id)
        .outerjoin(UserS3Connection, UserS3Connection.s3_connection_id == S3Connection.id)
        .outerjoin(linked_user, linked_user.id == UserS3Connection.user_id)
        .group_by(S3Connection.id)
    )
    q = q.filter(
        S3Connection.is_temporary.is_(False),
        (S3Connection.is_public.is_(True))
        | (S3Connection.owner_user_id == current_user.id)
        | ((S3Connection.is_shared.is_(True)) & (access_link.user_id == current_user.id))
    )
    if search:
        term = f"%{search.strip()}%"
        q = q.filter(
            (S3Connection.name.ilike(term))
            | (StorageEndpoint.endpoint_url.ilike(term))
            | (S3Connection.custom_endpoint_config.ilike(term))
            | (User.email.ilike(term))
            | (linked_user.email.ilike(term))
            | (linked_user.full_name.ilike(term))
        )

    sort_map = {
        "name": S3Connection.name,
        "endpoint": StorageEndpoint.endpoint_url,
        "owner": User.email,
        "last_used_at": S3Connection.last_used_at,
        "created_at": S3Connection.created_at,
    }
    requested_sort = sort_by if sort_by in sort_map else "name"
    descending = sort_dir.lower() == "desc"
    if requested_sort == "name":
        if descending:
            q = q.order_by(
                func.lower(S3Connection.name).desc(),
                S3Connection.name.desc(),
                S3Connection.id.desc(),
            )
        else:
            q = q.order_by(*s3_connection_name_order_by(S3Connection))
    else:
        sort_field = sort_map[requested_sort]
        if descending:
            q = q.order_by(sort_field.desc(), S3Connection.id.desc())
        else:
            q = q.order_by(sort_field.asc(), S3Connection.id.asc())

    total = q.count()
    rows = q.offset((page - 1) * page_size).limit(page_size).all()
    connection_ids = [conn.id for conn, _, _ in rows]
    user_ids_by_connection: dict[int, list[int]] = {}
    if connection_ids:
        link_rows = (
            db.query(UserS3Connection.s3_connection_id, UserS3Connection.user_id)
            .filter(UserS3Connection.s3_connection_id.in_(connection_ids))
            .all()
        )
        for conn_id, user_id in link_rows:
            user_ids_by_connection.setdefault(conn_id, []).append(user_id)
    items: list[S3ConnectionAdminItem] = []
    for conn, user_count, owner_email in rows:
        items.append(
            _to_admin_item(
                conn,
                owner_email=owner_email,
                user_count=int(user_count or 0),
                user_ids=user_ids_by_connection.get(conn.id, []),
            )
        )
    has_next = page * page_size < total
    return PaginatedS3ConnectionsResponse(items=items, total=total, page=page, page_size=page_size, has_next=has_next)


@router.get("/minimal", response_model=list[S3ConnectionSummary])
def list_s3_connections_minimal(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
) -> list[S3ConnectionSummary]:
    access_link = aliased(UserS3Connection)
    rows = (
        db.query(
            S3Connection.id,
            S3Connection.name,
            S3Connection.owner_user_id,
            S3Connection.is_public,
            S3Connection.is_shared,
            S3Connection.is_active,
        )
        .outerjoin(access_link, access_link.s3_connection_id == S3Connection.id)
        .filter(
            S3Connection.is_temporary.is_(False),
            (S3Connection.is_public.is_(True))
            | (S3Connection.owner_user_id == current_user.id)
            | ((S3Connection.is_shared.is_(True)) & (access_link.user_id == current_user.id))
        )
        .order_by(*s3_connection_name_order_by(S3Connection))
        .distinct()
        .all()
    )
    return [
        S3ConnectionSummary(
            id=row[0],
            name=row[1],
            owner_user_id=row[2],
            is_public=bool(row[3]),
            is_shared=bool(row[4]),
            is_active=bool(row[5]),
            visibility=visibility_from_flags(is_public=bool(row[3]), is_shared=bool(row[4])),
        )
        for row in rows
    ]


@router.post("/validate-credentials", response_model=S3ConnectionCredentialsValidationResult)
def validate_s3_connection_credentials(
    payload: S3ConnectionCredentialsValidationRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_super_admin),
) -> S3ConnectionCredentialsValidationResult:
    service = S3ConnectionValidationService(db)
    try:
        return service.validate_credentials(payload)
    except KeyError as exc:
        detail = exc.args[0] if exc.args else "Storage endpoint not found"
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("", response_model=S3ConnectionAdminItem, status_code=status.HTTP_201_CREATED)
def create_s3_connection(
    payload: S3ConnectionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_logger),
) -> S3ConnectionAdminItem:
    endpoint_url = (payload.endpoint_url or "").strip()
    region = payload.region
    force_path_style = bool(payload.force_path_style)
    verify_tls = bool(payload.verify_tls)
    storage_endpoint_id = payload.storage_endpoint_id
    if storage_endpoint_id is None and not endpoint_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Endpoint URL is required for manual connections")
    if storage_endpoint_id is not None:
        storage_endpoint = db.query(StorageEndpoint).filter(StorageEndpoint.id == storage_endpoint_id).first()
        if not storage_endpoint:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage endpoint not found")
        custom_endpoint_config = None
    else:
        endpoint_url = endpoint_url.rstrip("/") if endpoint_url else None
        custom_endpoint_config = build_custom_endpoint_config(
            endpoint_url,
            region,
            force_path_style,
            verify_tls,
            payload.provider_hint,
        )
    visibility = normalize_visibility(
        visibility=payload.visibility,
        is_public=payload.is_public,
        is_shared=payload.is_shared,
        default="private",
    )
    is_public = visibility == "public"
    is_shared = visibility == "shared"
    access_manager, access_browser = _resolve_access_flags(
        access_manager=payload.access_manager,
        access_browser=payload.access_browser,
    )
    owner_user_id = None if is_public else current_user.id
    conn = S3Connection(
        owner_user_id=owner_user_id,
        name=payload.name,
        storage_endpoint_id=storage_endpoint_id,
        custom_endpoint_config=custom_endpoint_config,
        is_public=is_public,
        is_shared=is_shared,
        is_active=True,
        access_manager=access_manager,
        access_browser=access_browser,
        credential_owner_type=payload.credential_owner_type,
        credential_owner_identifier=payload.credential_owner_identifier,
        access_key_id=payload.access_key_id,
        secret_access_key=payload.secret_access_key,
        capabilities_json=json.dumps({}),
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    try:
        db.add(conn)
        db.flush()
        _refresh_detected_capabilities(conn)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create S3Connection") from exc
    db.refresh(conn)
    details = resolve_connection_details(conn)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="connection.create",
        entity_type="s3_connection",
        entity_id=str(conn.id),
        metadata={
                "name": conn.name,
                "endpoint_url": details.endpoint_url,
                "provider_hint": details.provider,
                "visibility": visibility,
                "access_manager": bool(conn.access_manager),
                "access_browser": bool(conn.access_browser),
                "can_manage_iam": _connection_iam_capable(conn),
                "access_key_id": _mask_access_key(conn.access_key_id),
            },
        )
    return _to_admin_item(
        conn,
        owner_email=None if conn.is_public else current_user.email,
        user_count=0,
        user_ids=[],
    )


@router.put("/{connection_id}", response_model=S3ConnectionAdminItem)
def update_s3_connection(
    connection_id: int,
    payload: S3ConnectionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_logger),
) -> S3ConnectionAdminItem:
    conn = db.query(S3Connection).filter(S3Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
    _ensure_editable(conn, current_user)
    if payload.name is not None:
        conn.name = payload.name
    payload_data = payload.model_dump(exclude_unset=True)
    should_probe_iam = False
    if {"visibility", "is_public", "is_shared"} & set(payload_data.keys()):
        visibility = normalize_visibility(
            visibility=payload.visibility if "visibility" in payload_data else None,
            is_public=payload.is_public if "is_public" in payload_data else None,
            is_shared=payload.is_shared if "is_shared" in payload_data else None,
            default=visibility_from_flags(is_public=bool(conn.is_public), is_shared=bool(conn.is_shared)),
        )
        conn.is_public = visibility == "public"
        conn.is_shared = visibility == "shared"
        if conn.is_public:
            conn.owner_user_id = None
        elif conn.owner_user_id is None:
            conn.owner_user_id = current_user.id
        if visibility != "shared":
            (
                db.query(UserS3Connection)
                .filter(UserS3Connection.s3_connection_id == conn.id)
                .delete(synchronize_session=False)
            )
    if "is_active" in payload_data:
        conn.is_active = bool(payload.is_active)
    if payload.storage_endpoint_id is not None:
        storage_endpoint = db.query(StorageEndpoint).filter(StorageEndpoint.id == payload.storage_endpoint_id).first()
        if not storage_endpoint:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage endpoint not found")
        conn.storage_endpoint_id = storage_endpoint.id
        conn.custom_endpoint_config = None
        should_probe_iam = True
    elif payload.storage_endpoint_id is None and "storage_endpoint_id" in payload_data:
        conn.storage_endpoint_id = None
        if not payload.endpoint_url and not conn.custom_endpoint_config:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Endpoint URL is required for manual connections")
        should_probe_iam = True
    if conn.storage_endpoint_id is None:
        current = parse_custom_endpoint_config(conn.custom_endpoint_config)
        endpoint_url = current.get("endpoint_url")
        region = current.get("region")
        force_path_style = bool(current.get("force_path_style", False))
        verify_tls = bool(current.get("verify_tls", True))
        provider = current.get("provider") or current.get("provider_hint")
        if payload.endpoint_url is not None:
            endpoint_url = payload.endpoint_url.rstrip("/")
            should_probe_iam = True
        if payload.region is not None:
            region = payload.region
            should_probe_iam = True
        if payload.force_path_style is not None:
            force_path_style = bool(payload.force_path_style)
        if payload.verify_tls is not None:
            verify_tls = bool(payload.verify_tls)
            should_probe_iam = True
        if payload.provider_hint is not None:
            provider = payload.provider_hint
        conn.custom_endpoint_config = build_custom_endpoint_config(
            endpoint_url,
            region,
            force_path_style,
            verify_tls,
            provider,
        )
    if "access_manager" in payload_data or "access_browser" in payload_data:
        access_manager, access_browser = _resolve_access_flags(
            access_manager=payload.access_manager if "access_manager" in payload_data else bool(conn.access_manager),
            access_browser=payload.access_browser if "access_browser" in payload_data else bool(conn.access_browser),
        )
        conn.access_manager = access_manager
        conn.access_browser = access_browser
    if "credential_owner_type" in payload_data:
        conn.credential_owner_type = payload.credential_owner_type
    if "credential_owner_identifier" in payload_data:
        conn.credential_owner_identifier = payload.credential_owner_identifier
    if should_probe_iam:
        _refresh_detected_capabilities(conn)
    conn.updated_at = utcnow()
    db.commit()
    db.refresh(conn)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="connection.update",
        entity_type="s3_connection",
        entity_id=str(conn.id),
        metadata=payload.model_dump(exclude_none=True),
    )
    owner_email = db.query(User.email).filter(User.id == conn.owner_user_id).scalar()
    user_count = db.query(func.count(UserS3Connection.id)).filter(UserS3Connection.s3_connection_id == conn.id).scalar() or 0
    user_ids = _linked_user_ids(db, conn.id)
    return _to_admin_item(conn, owner_email=owner_email, user_count=int(user_count), user_ids=user_ids)


@router.put("/{connection_id}/credentials", response_model=S3ConnectionAdminItem)
def rotate_s3_connection_credentials(
    connection_id: int,
    payload: S3ConnectionCredentialsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_logger),
) -> S3ConnectionAdminItem:
    conn = db.query(S3Connection).filter(S3Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
    _ensure_editable(conn, current_user)
    conn.access_key_id = payload.access_key_id
    conn.secret_access_key = payload.secret_access_key
    _refresh_detected_capabilities(conn)
    conn.updated_at = utcnow()
    db.commit()
    db.refresh(conn)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="connection.rotate_credentials",
        entity_type="s3_connection",
        entity_id=str(conn.id),
        metadata={"access_key_id": _mask_access_key(payload.access_key_id)},
    )
    owner_email = db.query(User.email).filter(User.id == conn.owner_user_id).scalar()
    user_count = db.query(func.count(UserS3Connection.id)).filter(UserS3Connection.s3_connection_id == conn.id).scalar() or 0
    user_ids = _linked_user_ids(db, conn.id)
    return _to_admin_item(conn, owner_email=owner_email, user_count=int(user_count), user_ids=user_ids)


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_s3_connection(
    connection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_logger),
):
    conn = db.query(S3Connection).filter(S3Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
    _ensure_editable(conn, current_user)
    details = resolve_connection_details(conn)
    meta = {"name": conn.name, "endpoint_url": details.endpoint_url, "provider_hint": details.provider}
    db.query(UserS3Connection).filter(UserS3Connection.s3_connection_id == conn.id).delete()
    db.delete(conn)
    db.commit()
    audit.record_action(
        user=current_user,
        scope="admin",
        action="connection.delete",
        entity_type="s3_connection",
        entity_id=str(connection_id),
        metadata=meta,
    )
    return None


@router.get("/{connection_id}/users", response_model=list[S3ConnectionUserLink])
def list_connection_users(
    connection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
) -> list[S3ConnectionUserLink]:
    conn = db.query(S3Connection).filter(S3Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
    _ensure_editable(conn, current_user)
    if not conn.is_shared:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User links are only available for shared connections")
    links = (
        db.query(UserS3Connection, User)
        .join(User, User.id == UserS3Connection.user_id)
        .filter(UserS3Connection.s3_connection_id == connection_id)
        .order_by(User.email.asc())
        .all()
    )
    return [
        S3ConnectionUserLink(
            user_id=user.id,
            email=user.email,
            full_name=user.full_name,
            created_at=link.created_at,
            updated_at=link.updated_at,
        )
        for link, user in links
    ]


@router.post("/{connection_id}/users", response_model=S3ConnectionUserLink, status_code=status.HTTP_201_CREATED)
def add_connection_user(
    connection_id: int,
    payload: S3ConnectionUserLinkUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_logger),
) -> S3ConnectionUserLink:
    conn = db.query(S3Connection).filter(S3Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
    _ensure_editable(conn, current_user)
    if not conn.is_shared:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User links are only available for shared connections")
    user = db.query(User).filter(User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == conn.owner_user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Owner already has access")
    existing = (
        db.query(UserS3Connection)
        .filter(UserS3Connection.user_id == payload.user_id, UserS3Connection.s3_connection_id == connection_id)
        .first()
    )
    now = utcnow()
    if existing:
        existing.updated_at = now
        link = existing
        action = "connection.user.update"
    else:
        link = UserS3Connection(
            user_id=payload.user_id,
            s3_connection_id=connection_id,
            created_at=now,
            updated_at=now,
        )
        db.add(link)
        action = "connection.user.add"
    db.commit()
    db.refresh(link)
    audit.record_action(
        user=current_user,
        scope="admin",
        action=action,
        entity_type="s3_connection",
        entity_id=str(connection_id),
        metadata={"user_id": payload.user_id},
    )
    return S3ConnectionUserLink(
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        created_at=link.created_at,
        updated_at=link.updated_at,
    )


@router.put("/{connection_id}/users/{user_id}", response_model=S3ConnectionUserLink)
def update_connection_user(
    connection_id: int,
    user_id: int,
    payload: S3ConnectionUserLinkUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_logger),
) -> S3ConnectionUserLink:
    if payload.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="user_id mismatch")
    conn = db.query(S3Connection).filter(S3Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
    _ensure_editable(conn, current_user)
    if not conn.is_shared:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User links are only available for shared connections")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    link = (
        db.query(UserS3Connection)
        .filter(UserS3Connection.user_id == user_id, UserS3Connection.s3_connection_id == connection_id)
        .first()
    )
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")
    link.updated_at = utcnow()
    db.commit()
    audit.record_action(
        user=current_user,
        scope="admin",
        action="connection.user.update",
        entity_type="s3_connection",
        entity_id=str(connection_id),
        metadata={"user_id": user_id},
    )
    return S3ConnectionUserLink(
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        created_at=link.created_at,
        updated_at=link.updated_at,
    )


@router.delete("/{connection_id}/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_connection_user(
    connection_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_logger),
):
    conn = db.query(S3Connection).filter(S3Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
    _ensure_editable(conn, current_user)
    if not conn.is_shared:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User links are only available for shared connections")
    link = (
        db.query(UserS3Connection)
        .filter(UserS3Connection.user_id == user_id, UserS3Connection.s3_connection_id == connection_id)
        .first()
    )
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")
    db.delete(link)
    db.commit()
    audit.record_action(
        user=current_user,
        scope="admin",
        action="connection.user.remove",
        entity_type="s3_connection",
        entity_id=str(connection_id),
        metadata={"user_id": user_id},
    )
    return None
