# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Manager bucket-migration definition and precheck routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.access_context import BucketMigrationAccessScope
from app.models.bucket_migration import (
    BucketMigrationCreateRequest,
    BucketMigrationDetail,
)
from app.routers.manager.migrations_common import (
    _build_service,
    _raise_migration_value_error,
)
from app.routers.dependencies import (
    get_audit_service,
    get_current_bucket_migration_scope,
)
from app.services.audit_service import AuditService
from app.services.mappers.bucket_migration import (
    bucket_migration_to_detail as _migration_to_detail,
)
from app.utils.http_errors import raise_http_exception_from_exception

router = APIRouter(prefix="/manager/migrations", tags=["manager-migrations"])


@router.delete("/{migration_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_migration(
    migration_id: int,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> Response:
    current_user = scope.user
    service = _build_service(db, scope)
    try:
        service.delete_migration(migration_id)
    except ValueError as exc:
        _raise_migration_value_error(exc)

    audit.record_action(
        user=current_user,
        scope="manager",
        action="delete_bucket_migration",
        entity_type="bucket_migration",
        entity_id=str(migration_id),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("", response_model=BucketMigrationDetail, status_code=status.HTTP_201_CREATED)
def create_migration(
    payload: BucketMigrationCreateRequest,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> BucketMigrationDetail:
    current_user = scope.user
    service = _build_service(db, scope)
    try:
        migration = service.create_migration(payload, current_user)
    except PermissionError as exc:
        raise_http_exception_from_exception(status.HTTP_403_FORBIDDEN, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)

    audit.record_action(
        user=current_user,
        scope="manager",
        action="create_bucket_migration",
        entity_type="bucket_migration",
        entity_id=str(migration.id),
        metadata={
            "source_context_id": payload.source_context_id,
            "target_context_id": payload.target_context_id,
            "mode": payload.mode,
            "lock_target_writes": bool(payload.lock_target_writes),
            "strong_integrity_check": bool(payload.strong_integrity_check),
            "use_same_endpoint_copy": bool(migration.use_same_endpoint_copy),
            "auto_grant_source_read_for_copy": bool(migration.auto_grant_source_read_for_copy),
            "webhook_enabled": bool((payload.webhook_url or "").strip()),
            "items": len(payload.buckets),
        },
    )
    items = service.list_migration_items(migration.id)
    recent_events = service.list_recent_migration_events(migration.id, limit=200)
    return _migration_to_detail(migration, items=items, recent_events=recent_events)


@router.patch("/{migration_id}", response_model=BucketMigrationDetail)
def update_migration(
    migration_id: int,
    payload: BucketMigrationCreateRequest,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> BucketMigrationDetail:
    current_user = scope.user
    service = _build_service(db, scope)
    try:
        migration = service.update_draft_migration(migration_id, payload)
    except PermissionError as exc:
        raise_http_exception_from_exception(status.HTTP_403_FORBIDDEN, exc)
    except ValueError as exc:
        _raise_migration_value_error(exc)

    audit.record_action(
        user=current_user,
        scope="manager",
        action="update_bucket_migration",
        entity_type="bucket_migration",
        entity_id=str(migration.id),
        metadata={
            "source_context_id": payload.source_context_id,
            "target_context_id": payload.target_context_id,
            "mode": payload.mode,
            "lock_target_writes": bool(payload.lock_target_writes),
            "strong_integrity_check": bool(payload.strong_integrity_check),
            "use_same_endpoint_copy": bool(migration.use_same_endpoint_copy),
            "auto_grant_source_read_for_copy": bool(migration.auto_grant_source_read_for_copy),
            "webhook_enabled": bool((payload.webhook_url or "").strip()),
            "items": len(payload.buckets),
        },
    )
    items = service.list_migration_items(migration.id)
    recent_events = service.list_recent_migration_events(migration.id, limit=200)
    return _migration_to_detail(migration, items=items, recent_events=recent_events)


@router.post("/{migration_id}/precheck", response_model=BucketMigrationDetail)
def run_migration_precheck(
    migration_id: int,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> BucketMigrationDetail:
    current_user = scope.user
    service = _build_service(db, scope)
    try:
        migration = service.run_precheck(migration_id)
    except PermissionError as exc:
        raise_http_exception_from_exception(status.HTTP_403_FORBIDDEN, exc)
    except ValueError as exc:
        _raise_migration_value_error(exc)

    audit.record_action(
        user=current_user,
        scope="manager",
        action="precheck_bucket_migration",
        entity_type="bucket_migration",
        entity_id=str(migration.id),
    )
    items = service.list_migration_items(migration.id)
    recent_events = service.list_recent_migration_events(migration.id, limit=200)
    return _migration_to_detail(migration, items=items, recent_events=recent_events)
