# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session, aliased

from app.core.database import get_db
from app.db import S3Connection, StorageEndpoint, User, UserS3Connection
from app.models.s3_connection import S3ConnectionCreate, S3ConnectionUpdate, S3ConnectionCredentialsUpdate
from app.models.s3_connection_admin import (
    PaginatedS3ConnectionsResponse,
    S3ConnectionAdminItem,
    S3ConnectionUserLink,
    S3ConnectionUserLinkUpsert,
    S3ConnectionSummary,
)
from app.routers.dependencies import get_audit_logger, get_current_super_admin
from app.services.audit_service import AuditService
from app.utils.s3_connection_endpoint import (
    build_custom_endpoint_config,
    parse_custom_endpoint_config,
    resolve_connection_details,
)


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
    if conn.is_public:
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
        (S3Connection.is_public.is_(True))
        | (S3Connection.owner_user_id == current_user.id)
        | (access_link.user_id == current_user.id)
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

    sort_field = {
        "name": S3Connection.name,
        "endpoint": StorageEndpoint.endpoint_url,
        "owner": User.email,
        "last_used_at": S3Connection.last_used_at,
        "created_at": S3Connection.created_at,
    }.get(sort_by, S3Connection.name)
    order = sort_field.asc() if sort_dir.lower() != "desc" else sort_field.desc()
    q = q.order_by(order)

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
        details = resolve_connection_details(conn)
        items.append(
            S3ConnectionAdminItem(
                id=conn.id,
                name=conn.name,
                storage_endpoint_id=conn.storage_endpoint_id,
                endpoint_url=details.endpoint_url or "",
                is_public=bool(conn.is_public),
                provider_hint=details.provider,
                region=details.region,
                force_path_style=details.force_path_style,
                verify_tls=details.verify_tls,
                owner_user_id=conn.owner_user_id,
                owner_email=owner_email,
                user_count=int(user_count or 0),
                user_ids=sorted(user_ids_by_connection.get(conn.id, [])),
                last_used_at=conn.last_used_at,
                created_at=conn.created_at,
                updated_at=conn.updated_at,
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
        )
        .outerjoin(access_link, access_link.s3_connection_id == S3Connection.id)
        .filter(
            (S3Connection.is_public.is_(True))
            | (S3Connection.owner_user_id == current_user.id)
            | (access_link.user_id == current_user.id)
        )
        .order_by(S3Connection.name.asc())
        .distinct()
        .all()
    )
    return [
        S3ConnectionSummary(
            id=row[0],
            name=row[1],
            owner_user_id=row[2],
            is_public=bool(row[3]),
        )
        for row in rows
    ]


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
    is_public = bool(payload.is_public)
    owner_user_id = None if is_public else current_user.id
    conn = S3Connection(
        owner_user_id=owner_user_id,
        name=payload.name,
        storage_endpoint_id=storage_endpoint_id,
        custom_endpoint_config=custom_endpoint_config,
        is_public=is_public,
        access_key_id=payload.access_key_id,
        secret_access_key=payload.secret_access_key,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(conn)
    try:
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
            "access_key_id": _mask_access_key(conn.access_key_id),
        },
    )
    return S3ConnectionAdminItem(
        id=conn.id,
        name=conn.name,
        storage_endpoint_id=conn.storage_endpoint_id,
        endpoint_url=details.endpoint_url or "",
        is_public=bool(conn.is_public),
        provider_hint=details.provider,
        region=details.region,
        force_path_style=details.force_path_style,
        verify_tls=details.verify_tls,
        owner_user_id=conn.owner_user_id,
        owner_email=None if conn.is_public else current_user.email,
        user_count=0,
        user_ids=[],
        last_used_at=conn.last_used_at,
        created_at=conn.created_at,
        updated_at=conn.updated_at,
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
    if "is_public" in payload_data:
        if payload.is_public:
            conn.is_public = True
            conn.owner_user_id = None
        else:
            conn.is_public = False
            if conn.owner_user_id is None:
                conn.owner_user_id = current_user.id
    if payload.storage_endpoint_id is not None:
        storage_endpoint = db.query(StorageEndpoint).filter(StorageEndpoint.id == payload.storage_endpoint_id).first()
        if not storage_endpoint:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage endpoint not found")
        conn.storage_endpoint_id = storage_endpoint.id
        conn.custom_endpoint_config = None
    elif payload.storage_endpoint_id is None and "storage_endpoint_id" in payload_data:
        conn.storage_endpoint_id = None
        if not payload.endpoint_url and not conn.custom_endpoint_config:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Endpoint URL is required for manual connections")
    if conn.storage_endpoint_id is None:
        current = parse_custom_endpoint_config(conn.custom_endpoint_config)
        endpoint_url = current.get("endpoint_url")
        region = current.get("region")
        force_path_style = bool(current.get("force_path_style", False))
        verify_tls = bool(current.get("verify_tls", True))
        provider = current.get("provider") or current.get("provider_hint")
        if payload.endpoint_url is not None:
            endpoint_url = payload.endpoint_url.rstrip("/")
        if payload.region is not None:
            region = payload.region
        if payload.force_path_style is not None:
            force_path_style = bool(payload.force_path_style)
        if payload.verify_tls is not None:
            verify_tls = bool(payload.verify_tls)
        if payload.provider_hint is not None:
            provider = payload.provider_hint
        conn.custom_endpoint_config = build_custom_endpoint_config(
            endpoint_url,
            region,
            force_path_style,
            verify_tls,
            provider,
        )
    conn.updated_at = datetime.utcnow()
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
    details = resolve_connection_details(conn)
    return S3ConnectionAdminItem(
        id=conn.id,
        name=conn.name,
        storage_endpoint_id=conn.storage_endpoint_id,
        endpoint_url=details.endpoint_url or "",
        is_public=bool(conn.is_public),
        provider_hint=details.provider,
        region=details.region,
        force_path_style=details.force_path_style,
        verify_tls=details.verify_tls,
        owner_user_id=conn.owner_user_id,
        owner_email=owner_email,
        user_count=int(user_count),
        user_ids=user_ids,
        last_used_at=conn.last_used_at,
        created_at=conn.created_at,
        updated_at=conn.updated_at,
    )


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
    conn.updated_at = datetime.utcnow()
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
    details = resolve_connection_details(conn)
    return S3ConnectionAdminItem(
        id=conn.id,
        name=conn.name,
        storage_endpoint_id=conn.storage_endpoint_id,
        endpoint_url=details.endpoint_url or "",
        is_public=bool(conn.is_public),
        provider_hint=details.provider,
        region=details.region,
        force_path_style=details.force_path_style,
        verify_tls=details.verify_tls,
        owner_user_id=conn.owner_user_id,
        owner_email=owner_email,
        user_count=int(user_count),
        user_ids=user_ids,
        last_used_at=conn.last_used_at,
        created_at=conn.created_at,
        updated_at=conn.updated_at,
    )


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
            can_browser=bool(link.can_browser),
            can_manager=bool(link.can_manager),
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
    now = datetime.utcnow()
    if existing:
        existing.can_browser = bool(payload.can_browser)
        existing.can_manager = bool(payload.can_manager)
        existing.updated_at = now
        link = existing
        action = "connection.user.update"
    else:
        link = UserS3Connection(
            user_id=payload.user_id,
            s3_connection_id=connection_id,
            can_browser=bool(payload.can_browser),
            can_manager=bool(payload.can_manager),
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
        metadata={"user_id": payload.user_id, "can_browser": bool(link.can_browser), "can_manager": bool(link.can_manager)},
    )
    return S3ConnectionUserLink(
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        can_browser=bool(link.can_browser),
        can_manager=bool(link.can_manager),
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
    link.can_browser = bool(payload.can_browser)
    link.can_manager = bool(payload.can_manager)
    link.updated_at = datetime.utcnow()
    db.commit()
    audit.record_action(
        user=current_user,
        scope="admin",
        action="connection.user.update",
        entity_type="s3_connection",
        entity_id=str(connection_id),
        metadata={"user_id": user_id, "can_browser": bool(link.can_browser), "can_manager": bool(link.can_manager)},
    )
    return S3ConnectionUserLink(
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        can_browser=bool(link.can_browser),
        can_manager=bool(link.can_manager),
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
