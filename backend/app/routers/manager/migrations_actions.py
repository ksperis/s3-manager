# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Manager bucket-migration execution-control routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.access_context import BucketMigrationAccessScope
from app.models.bucket_migration import BucketMigrationActionResponse
from app.routers.dependencies import (
    get_audit_service,
    get_current_bucket_migration_scope,
)
from app.routers.manager.migrations_common import (
    _build_service,
    _raise_migration_value_error,
    _worker_wake_up,
)
from app.services.audit_service import AuditService
from app.utils.http_errors import raise_http_exception_from_exception

router = APIRouter(prefix="/manager/migrations", tags=["manager-migrations"])


@router.post("/{migration_id}/start", response_model=BucketMigrationActionResponse)
def start_migration(
    migration_id: int,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> BucketMigrationActionResponse:
    current_user = scope.user
    service = _build_service(db, scope)
    try:
        migration = service.start_migration(migration_id)
    except PermissionError as exc:
        raise_http_exception_from_exception(status.HTTP_403_FORBIDDEN, exc)
    except ValueError as exc:
        _raise_migration_value_error(exc)

    _worker_wake_up()
    audit.record_action(
        user=current_user,
        scope="manager",
        action="start_bucket_migration",
        entity_type="bucket_migration",
        entity_id=str(migration.id),
    )
    return BucketMigrationActionResponse(id=migration.id, status=migration.status, message="Migration queued")


@router.post("/{migration_id}/pause", response_model=BucketMigrationActionResponse)
def pause_migration(
    migration_id: int,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> BucketMigrationActionResponse:
    current_user = scope.user
    service = _build_service(db, scope)
    try:
        migration = service.request_pause(migration_id)
    except ValueError as exc:
        _raise_migration_value_error(exc)

    _worker_wake_up()
    audit.record_action(
        user=current_user,
        scope="manager",
        action="pause_bucket_migration",
        entity_type="bucket_migration",
        entity_id=str(migration.id),
    )
    return BucketMigrationActionResponse(id=migration.id, status=migration.status, message="Pause requested")


@router.post("/{migration_id}/resume", response_model=BucketMigrationActionResponse)
def resume_migration(
    migration_id: int,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> BucketMigrationActionResponse:
    current_user = scope.user
    service = _build_service(db, scope)
    try:
        migration = service.resume_migration(migration_id)
    except ValueError as exc:
        _raise_migration_value_error(exc)

    _worker_wake_up()
    audit.record_action(
        user=current_user,
        scope="manager",
        action="resume_bucket_migration",
        entity_type="bucket_migration",
        entity_id=str(migration.id),
    )
    return BucketMigrationActionResponse(id=migration.id, status=migration.status, message="Migration resumed")


@router.post("/{migration_id}/stop", response_model=BucketMigrationActionResponse)
def stop_migration(
    migration_id: int,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> BucketMigrationActionResponse:
    current_user = scope.user
    service = _build_service(db, scope)
    try:
        migration = service.stop_migration(migration_id)
    except ValueError as exc:
        _raise_migration_value_error(exc)

    _worker_wake_up()
    audit.record_action(
        user=current_user,
        scope="manager",
        action="stop_bucket_migration",
        entity_type="bucket_migration",
        entity_id=str(migration.id),
    )
    return BucketMigrationActionResponse(id=migration.id, status=migration.status, message="Stop requested")


@router.post("/{migration_id}/continue", response_model=BucketMigrationActionResponse)
def continue_after_presync(
    migration_id: int,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> BucketMigrationActionResponse:
    current_user = scope.user
    service = _build_service(db, scope)
    try:
        migration = service.continue_after_presync(migration_id)
    except ValueError as exc:
        _raise_migration_value_error(exc)

    _worker_wake_up()
    audit.record_action(
        user=current_user,
        scope="manager",
        action="continue_bucket_migration",
        entity_type="bucket_migration",
        entity_id=str(migration.id),
    )
    return BucketMigrationActionResponse(id=migration.id, status=migration.status, message="Cutover queued")


@router.post("/{migration_id}/rollback", response_model=BucketMigrationActionResponse)
def rollback_migration(
    migration_id: int,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> BucketMigrationActionResponse:
    current_user = scope.user
    service = _build_service(db, scope)
    try:
        migration = service.rollback_failed_migration(migration_id)
    except ValueError as exc:
        _raise_migration_value_error(exc)

    audit.record_action(
        user=current_user,
        scope="manager",
        action="rollback_bucket_migration",
        entity_type="bucket_migration",
        entity_id=str(migration.id),
    )
    return BucketMigrationActionResponse(id=migration.id, status=migration.status, message="Rollback completed")


@router.post("/{migration_id}/items/retry-failed", response_model=BucketMigrationActionResponse)
def retry_failed_items(
    migration_id: int,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> BucketMigrationActionResponse:
    current_user = scope.user
    service = _build_service(db, scope)
    try:
        migration, retried_count = service.retry_failed_items(migration_id)
    except ValueError as exc:
        _raise_migration_value_error(exc)

    _worker_wake_up()
    audit.record_action(
        user=current_user,
        scope="manager",
        action="retry_failed_bucket_migration_items",
        entity_type="bucket_migration",
        entity_id=str(migration.id),
        metadata={"retried_items": retried_count},
    )
    return BucketMigrationActionResponse(
        id=migration.id,
        status=migration.status,
        message=f"Retry queued for {retried_count} failed item(s)",
    )


@router.post("/{migration_id}/items/rollback-failed", response_model=BucketMigrationActionResponse)
def rollback_failed_items(
    migration_id: int,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> BucketMigrationActionResponse:
    current_user = scope.user
    service = _build_service(db, scope)
    try:
        migration, rolled_back_count = service.rollback_failed_items(migration_id)
    except ValueError as exc:
        _raise_migration_value_error(exc)

    audit.record_action(
        user=current_user,
        scope="manager",
        action="rollback_failed_bucket_migration_items",
        entity_type="bucket_migration",
        entity_id=str(migration.id),
        metadata={"rolled_back_items": rolled_back_count},
    )
    return BucketMigrationActionResponse(
        id=migration.id,
        status=migration.status,
        message=f"Rollback executed for {rolled_back_count} failed item(s)",
    )


@router.post("/{migration_id}/items/{item_id}/retry", response_model=BucketMigrationActionResponse)
def retry_item(
    migration_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> BucketMigrationActionResponse:
    current_user = scope.user
    service = _build_service(db, scope)
    try:
        migration = service.retry_item(migration_id, item_id)
    except ValueError as exc:
        _raise_migration_value_error(exc)

    _worker_wake_up()
    audit.record_action(
        user=current_user,
        scope="manager",
        action="retry_bucket_migration_item",
        entity_type="bucket_migration_item",
        entity_id=f"{migration.id}:{item_id}",
    )
    return BucketMigrationActionResponse(
        id=migration.id,
        status=migration.status,
        message="Retry queued for bucket item",
    )


@router.post("/{migration_id}/items/{item_id}/rollback", response_model=BucketMigrationActionResponse)
def rollback_item(
    migration_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> BucketMigrationActionResponse:
    current_user = scope.user
    service = _build_service(db, scope)
    try:
        migration = service.rollback_item(migration_id, item_id)
    except ValueError as exc:
        _raise_migration_value_error(exc)

    audit.record_action(
        user=current_user,
        scope="manager",
        action="rollback_bucket_migration_item",
        entity_type="bucket_migration_item",
        entity_id=f"{migration.id}:{item_id}",
    )
    return BucketMigrationActionResponse(
        id=migration.id,
        status=migration.status,
        message="Rollback executed for bucket item",
    )
