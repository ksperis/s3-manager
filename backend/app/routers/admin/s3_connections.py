# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.utils.time import utcnow
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import exists, func
from sqlalchemy.orm import Session, aliased

from app.core.database import get_db
from app.db import (
    S3Connection,
    S3ConnectionTag,
    StorageEndpoint,
    TagDefinition,
    UiGroup,
    UiGroupS3Connection,
    User,
    UserS3Connection,
)
from app.models.s3_connection import (
    S3ConnectionCredentialsUpdate,
    S3ConnectionCredentialsValidationRequest,
    S3ConnectionCredentialsValidationResult,
)
from app.models.s3_connection_admin import (
    PaginatedS3ConnectionsResponse,
    S3ConnectionAdminCreate,
    S3ConnectionAdminItem,
    S3ConnectionAdminUpdate,
    S3ConnectionGroupDetail,
    S3ConnectionUserLink,
    S3ConnectionUserLinkUpsert,
    S3ConnectionSummary,
    S3ConnectionRemediationAction,
)
from app.routers.dependencies import get_audit_service, get_current_super_admin
from app.services.audit_service import AuditService
from app.services.mappers.s3_connection import mask_access_key_id
from app.services.s3_connections_service import (
    ACTIVE_MANAGED_SOURCE_CREDENTIALS_ERROR,
    ACTIVE_MANAGED_SOURCE_DELETE_ERROR,
    ACTIVE_MANAGED_SOURCE_UPDATE_ERROR,
    AdminSharedStorageEndpointNotFoundError,
    S3ConnectionsService,
)
from app.services.s3_connection_validation_service import S3ConnectionValidationService
from app.services.tags_service import TagsService, serialize_tag_summaries
from app.services.ui_group_avatar_service import UiGroupAvatarService
from app.services.user_avatar_service import UserAvatarService
from app.models.user import UserAssociationDetail
from app.utils.s3_connection_capabilities import (
    parse_s3_connection_capabilities,
    s3_connection_can_manage_iam,
)
from app.utils.s3_connection_endpoint import (
    resolve_connection_details,
)
from app.utils.name_ordering import name_order_by
from app.core.sensitive_data import sanitize_error_detail
router = APIRouter(prefix="/admin/s3-connections", tags=["admin-s3-connections"])
logger = logging.getLogger(__name__)


def _get_admin_shared_connection(db: Session, connection_id: int) -> S3Connection:
    try:
        return S3ConnectionsService(db).get_admin_shared(connection_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found") from exc


def _linked_user_details_by_connection(
    db: Session,
    connection_ids: list[int],
) -> dict[int, list[UserAssociationDetail]]:
    if not connection_ids:
        return {}
    rows = (
        db.query(UserS3Connection.s3_connection_id, User)
        .join(User, User.id == UserS3Connection.user_id)
        .filter(UserS3Connection.s3_connection_id.in_(connection_ids))
        .order_by(UserS3Connection.s3_connection_id.asc(), User.email.asc(), User.id.asc())
        .all()
    )
    user_details_by_connection: dict[int, list[UserAssociationDetail]] = {}
    avatar_service = UserAvatarService(db)
    for connection_id, user in rows:
        normalized_connection_id = int(connection_id)
        normalized_user_id = int(user.id)
        user_details_by_connection.setdefault(normalized_connection_id, []).append(
            UserAssociationDetail(
                id=normalized_user_id,
                email=user.email,
                full_name=user.full_name,
                display_name=user.display_name,
                avatar=avatar_service.descriptor(user),
            )
        )
    return user_details_by_connection


def _linked_user_details(db: Session, connection_id: int) -> list[UserAssociationDetail]:
    return _linked_user_details_by_connection(db, [connection_id]).get(connection_id, [])


def _linked_group_details_by_connection(
    db: Session,
    connection_ids: list[int],
) -> dict[int, list[S3ConnectionGroupDetail]]:
    if not connection_ids:
        return {}
    rows = (
        db.query(UiGroupS3Connection.s3_connection_id, UiGroup)
        .join(UiGroup, UiGroup.id == UiGroupS3Connection.group_id)
        .filter(UiGroupS3Connection.s3_connection_id.in_(connection_ids))
        .order_by(UiGroupS3Connection.s3_connection_id.asc(), UiGroup.name.asc(), UiGroup.id.asc())
        .all()
    )
    group_details_by_connection: dict[int, list[S3ConnectionGroupDetail]] = {}
    avatar_service = UiGroupAvatarService(db)
    for connection_id, group in rows:
        normalized_connection_id = int(connection_id)
        normalized_group_id = int(group.id)
        group_details_by_connection.setdefault(normalized_connection_id, []).append(
            S3ConnectionGroupDetail(
                id=normalized_group_id,
                name=group.name,
                avatar=avatar_service.descriptor(group),
            )
        )
    return group_details_by_connection


def _linked_group_details(db: Session, connection_id: int) -> list[S3ConnectionGroupDetail]:
    return _linked_group_details_by_connection(db, [connection_id]).get(connection_id, [])


def _to_admin_item(
    conn: S3Connection,
    *,
    created_by_email: Optional[str],
    created_by_user: Optional[User],
    user_count: int,
    user_details: list[UserAssociationDetail],
    group_details: list[S3ConnectionGroupDetail],
    tags_service: TagsService,
) -> S3ConnectionAdminItem:
    details = resolve_connection_details(conn)
    capabilities = parse_s3_connection_capabilities(conn.capabilities_json)
    return S3ConnectionAdminItem(
        id=conn.id,
        name=conn.name,
        storage_endpoint_id=conn.storage_endpoint_id,
        endpoint_url=details.endpoint_url or "",
        is_active=bool(conn.is_active),
        execution_status="remediation_required" if conn.remediation_required else "ready",
        remediation_reason=conn.remediation_reason,
        credential_owner_type=conn.credential_owner_type,
        credential_owner_identifier=conn.credential_owner_identifier,
        provider_hint=details.provider,
        region=details.region,
        force_path_style=details.force_path_style,
        verify_tls=details.verify_tls,
        created_by_user_id=conn.created_by_user_id,
        created_by_email=created_by_email,
        created_by_full_name=(created_by_user.display_name or created_by_user.full_name) if created_by_user else None,
        created_by_avatar=UserAvatarService(tags_service.db).descriptor(created_by_user) if created_by_user else None,
        user_count=int(user_count),
        user_details=user_details,
        group_details=group_details,
        tags=tags_service.get_connection_tags(conn),
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
    _ = current_user
    tags_service = TagsService(db)
    linked_user = aliased(User)
    q = (
        db.query(
            S3Connection,
            func.count(UserS3Connection.id).label("user_count"),
            func.max(User.email).label("created_by_email"),
        )
        .outerjoin(User, User.id == S3Connection.created_by_user_id)
        .outerjoin(StorageEndpoint, StorageEndpoint.id == S3Connection.storage_endpoint_id)
        .outerjoin(UserS3Connection, UserS3Connection.s3_connection_id == S3Connection.id)
        .outerjoin(linked_user, linked_user.id == UserS3Connection.user_id)
        .group_by(S3Connection.id)
    )
    q = q.filter(*S3ConnectionsService.admin_shared_predicates())
    if search:
        term = f"%{search.strip()}%"
        tag_match = (
            exists()
            .where(S3ConnectionTag.s3_connection_id == S3Connection.id)
            .where(TagDefinition.id == S3ConnectionTag.tag_definition_id)
            .where(TagDefinition.label.ilike(term))
        )
        group_match = (
            exists()
            .where(UiGroupS3Connection.s3_connection_id == S3Connection.id)
            .where(UiGroup.id == UiGroupS3Connection.group_id)
            .where(UiGroup.name.ilike(term))
        )
        q = q.filter(
            (S3Connection.name.ilike(term))
            | (StorageEndpoint.endpoint_url.ilike(term))
            | (S3Connection.custom_endpoint_config.ilike(term))
            | (User.email.ilike(term))
            | (linked_user.email.ilike(term))
            | (linked_user.full_name.ilike(term))
            | group_match
            | tag_match
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
            q = q.order_by(*name_order_by(S3Connection))
    else:
        sort_field = sort_map[requested_sort]
        if descending:
            q = q.order_by(sort_field.desc(), S3Connection.id.desc())
        else:
            q = q.order_by(sort_field.asc(), S3Connection.id.asc())

    total = q.count()
    rows = q.offset((page - 1) * page_size).limit(page_size).all()
    connection_ids = [conn.id for conn, _, _ in rows]
    creator_ids = {int(conn.created_by_user_id) for conn, _, _ in rows}
    creators_by_id = {
        int(creator.id): creator
        for creator in db.query(User).filter(User.id.in_(creator_ids)).all()
    } if creator_ids else {}
    user_details_by_connection = _linked_user_details_by_connection(db, connection_ids)
    group_details_by_connection = _linked_group_details_by_connection(db, connection_ids)
    items: list[S3ConnectionAdminItem] = []
    for conn, user_count, created_by_email in rows:
        items.append(
            _to_admin_item(
                conn,
                created_by_email=created_by_email,
                created_by_user=creators_by_id.get(int(conn.created_by_user_id)),
                user_count=int(user_count or 0),
                user_details=user_details_by_connection.get(conn.id, []),
                group_details=group_details_by_connection.get(conn.id, []),
                tags_service=tags_service,
            )
        )
    has_next = page * page_size < total
    return PaginatedS3ConnectionsResponse(items=items, total=total, page=page, page_size=page_size, has_next=has_next)


@router.get("/minimal", response_model=list[S3ConnectionSummary])
def list_s3_connections_minimal(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
) -> list[S3ConnectionSummary]:
    _ = current_user
    rows = (
        db.query(
            S3Connection.id,
            S3Connection.name,
            S3Connection.created_by_user_id,
            S3Connection.is_active,
            S3Connection.remediation_required,
        )
        .filter(*S3ConnectionsService.admin_shared_predicates())
        .order_by(*name_order_by(S3Connection))
        .all()
    )
    return [
        S3ConnectionSummary(
            id=row[0],
            name=row[1],
            created_by_user_id=row[2],
            is_active=bool(row[3]),
            execution_status="remediation_required" if row[4] else "ready",
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc


@router.post("", response_model=S3ConnectionAdminItem, status_code=status.HTTP_201_CREATED)
def create_s3_connection(
    payload: S3ConnectionAdminCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> S3ConnectionAdminItem:
    service = S3ConnectionsService(db)
    tags_service = service.tags
    try:
        conn = service.create_admin_shared(current_user.id, payload)
    except AdminSharedStorageEndpointNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Storage endpoint not found",
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create S3Connection") from exc
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
                "is_shared": True,
                "created_by_user_id": conn.created_by_user_id,
                "access_manager": bool(conn.access_manager),
                "access_browser": bool(conn.access_browser),
                "can_manage_iam": s3_connection_can_manage_iam(conn.capabilities_json),
                "access_key_id": mask_access_key_id(conn.access_key_id),
                "tags": serialize_tag_summaries(tags_service.get_connection_tags(conn)),
            },
        )
    return _to_admin_item(
        conn,
        created_by_email=current_user.email,
        created_by_user=current_user,
        user_count=0,
        user_details=[],
        group_details=[],
        tags_service=tags_service,
    )


@router.put("/{connection_id}", response_model=S3ConnectionAdminItem)
def update_s3_connection(
    connection_id: int,
    payload: S3ConnectionAdminUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> S3ConnectionAdminItem:
    service = S3ConnectionsService(db)
    tags_service = service.tags
    _get_admin_shared_connection(db, connection_id)
    try:
        conn = service.update_admin_shared(connection_id, payload)
    except AdminSharedStorageEndpointNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Storage endpoint not found",
        ) from exc
    except ValueError as exc:
        error = sanitize_error_detail(str(exc))
        status_code = (
            status.HTTP_409_CONFLICT
            if error == ACTIVE_MANAGED_SOURCE_UPDATE_ERROR
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=status_code, detail=error) from exc
    audit.record_action(
        user=current_user,
        scope="admin",
        action="connection.update",
        entity_type="s3_connection",
        entity_id=str(conn.id),
        metadata=payload.model_dump(exclude_none=True),
    )
    created_by_user = db.query(User).filter(User.id == conn.created_by_user_id).first()
    created_by_email = created_by_user.email if created_by_user else None
    user_count = db.query(func.count(UserS3Connection.id)).filter(UserS3Connection.s3_connection_id == conn.id).scalar() or 0
    user_details = _linked_user_details(db, conn.id)
    group_details = _linked_group_details(db, conn.id)
    return _to_admin_item(
        conn,
        created_by_email=created_by_email,
        created_by_user=created_by_user,
        user_count=int(user_count),
        user_details=user_details,
        group_details=group_details,
        tags_service=tags_service,
    )


@router.post("/{connection_id}/remediation", response_model=S3ConnectionAdminItem)
def remediate_s3_connection(
    connection_id: int,
    payload: S3ConnectionRemediationAction,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> S3ConnectionAdminItem:
    service = S3ConnectionsService(db)
    _get_admin_shared_connection(db, connection_id)
    if payload.action != "activate_manager":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unsupported remediation action")
    conn = service.update_admin_shared(
        connection_id,
        S3ConnectionAdminUpdate(),
        activate_manager=True,
    )
    audit.record_action(
        user=current_user,
        scope="admin",
        action="connection.remediate",
        entity_type="s3_connection",
        entity_id=str(conn.id),
        metadata={"action": payload.action},
    )
    created_by_user = db.query(User).filter(User.id == conn.created_by_user_id).first()
    user_details = _linked_user_details(db, conn.id)
    group_details = _linked_group_details(db, conn.id)
    return _to_admin_item(
        conn,
        created_by_email=created_by_user.email if created_by_user else None,
        created_by_user=created_by_user,
        user_count=len(user_details),
        user_details=user_details,
        group_details=group_details,
        tags_service=service.tags,
    )


@router.put("/{connection_id}/credentials", response_model=S3ConnectionAdminItem)
def rotate_s3_connection_credentials(
    connection_id: int,
    payload: S3ConnectionCredentialsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> S3ConnectionAdminItem:
    service = S3ConnectionsService(db)
    tags_service = service.tags
    _get_admin_shared_connection(db, connection_id)
    try:
        conn = service.update_admin_shared(
            connection_id,
            S3ConnectionAdminUpdate(),
            access_key_id=payload.access_key_id,
            secret_access_key=payload.secret_access_key,
        )
    except ValueError as exc:
        error = sanitize_error_detail(str(exc))
        status_code = (
            status.HTTP_409_CONFLICT
            if error == ACTIVE_MANAGED_SOURCE_CREDENTIALS_ERROR
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(
            status_code=status_code,
            detail=error,
        ) from exc
    audit.record_action(
        user=current_user,
        scope="admin",
        action="connection.rotate_credentials",
        entity_type="s3_connection",
        entity_id=str(conn.id),
        metadata={"access_key_id": mask_access_key_id(payload.access_key_id)},
    )
    created_by_user = db.query(User).filter(User.id == conn.created_by_user_id).first()
    created_by_email = created_by_user.email if created_by_user else None
    user_count = db.query(func.count(UserS3Connection.id)).filter(UserS3Connection.s3_connection_id == conn.id).scalar() or 0
    user_details = _linked_user_details(db, conn.id)
    group_details = _linked_group_details(db, conn.id)
    return _to_admin_item(
        conn,
        created_by_email=created_by_email,
        created_by_user=created_by_user,
        user_count=int(user_count),
        user_details=user_details,
        group_details=group_details,
        tags_service=tags_service,
    )


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_s3_connection(
    connection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
):
    service = S3ConnectionsService(db)
    conn = _get_admin_shared_connection(db, connection_id)
    details = resolve_connection_details(conn)
    meta = {"name": conn.name, "endpoint_url": details.endpoint_url, "provider_hint": details.provider}
    try:
        service.delete_admin_shared(conn.id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=ACTIVE_MANAGED_SOURCE_DELETE_ERROR,
        ) from exc
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
    conn = _get_admin_shared_connection(db, connection_id)
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
    audit: AuditService = Depends(get_audit_service),
) -> S3ConnectionUserLink:
    conn = _get_admin_shared_connection(db, connection_id)
    user = db.query(User).filter(User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
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
    audit: AuditService = Depends(get_audit_service),
) -> S3ConnectionUserLink:
    if payload.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="user_id mismatch")
    conn = _get_admin_shared_connection(db, connection_id)
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
    audit: AuditService = Depends(get_audit_service),
):
    conn = _get_admin_shared_connection(db, connection_id)
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
