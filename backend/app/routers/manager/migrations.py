# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.db import BucketMigration, BucketMigrationEvent, BucketMigrationItem, User
from app.models.bucket_migration import (
    BucketMigrationActionResponse,
    BucketMigrationCreateRequest,
    BucketMigrationDetail,
    BucketMigrationEventView,
    BucketMigrationItemView,
    BucketMigrationListResponse,
    BucketMigrationView,
)
from app.routers.dependencies import get_audit_logger, get_current_bucket_migration_user
from app.services.audit_service import AuditService
from app.services.bucket_migration_service import BucketMigrationService, get_bucket_migration_worker

router = APIRouter(prefix="/manager/migrations", tags=["manager-migrations"])


def _load_json(value: Optional[str]) -> Optional[dict]:
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else {"value": parsed}


def _item_to_view(item: BucketMigrationItem) -> BucketMigrationItemView:
    return BucketMigrationItemView(
        id=item.id,
        source_bucket=item.source_bucket,
        target_bucket=item.target_bucket,
        status=item.status,
        step=item.step,
        pre_sync_done=bool(item.pre_sync_done),
        read_only_applied=bool(item.read_only_applied),
        target_lock_applied=bool(item.target_lock_applied),
        target_bucket_exists=bool(item.target_bucket_exists),
        objects_copied=int(item.objects_copied or 0),
        objects_deleted=int(item.objects_deleted or 0),
        source_count=item.source_count,
        target_count=item.target_count,
        matched_count=item.matched_count,
        different_count=item.different_count,
        only_source_count=item.only_source_count,
        only_target_count=item.only_target_count,
        diff_sample=_load_json(item.diff_sample_json),
        error_message=item.error_message,
        started_at=item.started_at,
        finished_at=item.finished_at,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _event_to_view(entry: BucketMigrationEvent) -> BucketMigrationEventView:
    return BucketMigrationEventView(
        id=entry.id,
        item_id=entry.item_id,
        level=entry.level,
        message=entry.message,
        metadata=_load_json(entry.metadata_json),
        created_at=entry.created_at,
    )


def _migration_to_view(migration: BucketMigration) -> BucketMigrationView:
    return BucketMigrationView(
        id=migration.id,
        created_by_user_id=migration.created_by_user_id,
        source_context_id=migration.source_context_id,
        target_context_id=migration.target_context_id,
        mode=migration.mode,
        copy_bucket_settings=bool(migration.copy_bucket_settings),
        delete_source=bool(migration.delete_source),
        lock_target_writes=bool(migration.lock_target_writes),
        auto_grant_source_read_for_copy=bool(migration.auto_grant_source_read_for_copy),
        webhook_url=migration.webhook_url,
        mapping_prefix=migration.mapping_prefix,
        status=migration.status,
        pause_requested=bool(migration.pause_requested),
        cancel_requested=bool(migration.cancel_requested),
        precheck_status=(migration.precheck_status or "pending"),
        precheck_report=_load_json(migration.precheck_report_json),
        precheck_checked_at=migration.precheck_checked_at,
        parallelism_max=int(migration.parallelism_max or 1),
        total_items=int(migration.total_items or 0),
        completed_items=int(migration.completed_items or 0),
        failed_items=int(migration.failed_items or 0),
        skipped_items=int(migration.skipped_items or 0),
        awaiting_items=int(migration.awaiting_items or 0),
        error_message=migration.error_message,
        started_at=migration.started_at,
        finished_at=migration.finished_at,
        last_heartbeat_at=migration.last_heartbeat_at,
        created_at=migration.created_at,
        updated_at=migration.updated_at,
    )


def _migration_to_detail(migration: BucketMigration, events_limit: int) -> BucketMigrationDetail:
    items = sorted(migration.items, key=lambda entry: (entry.id, entry.source_bucket))
    recent_events = sorted(migration.events, key=lambda entry: entry.created_at, reverse=True)[:events_limit]
    base = _migration_to_view(migration)
    return BucketMigrationDetail(
        **base.model_dump(),
        items=[_item_to_view(item) for item in items],
        recent_events=[_event_to_view(event) for event in recent_events],
    )


def _worker_wake_up() -> None:
    worker = get_bucket_migration_worker(SessionLocal)
    worker.wake_up()


@router.get("", response_model=BucketMigrationListResponse)
def list_migrations(
    limit: int = Query(default=100, ge=1, le=500),
    context_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_bucket_migration_user),
) -> BucketMigrationListResponse:
    service = BucketMigrationService(db)
    migrations = service.list_migrations(limit=limit, context_id=context_id)
    return BucketMigrationListResponse(items=[_migration_to_view(migration) for migration in migrations])


@router.get("/{migration_id}", response_model=BucketMigrationDetail)
def get_migration(
    migration_id: int,
    events_limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_bucket_migration_user),
) -> BucketMigrationDetail:
    service = BucketMigrationService(db)
    try:
        migration = service.get_migration(migration_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _migration_to_detail(migration, events_limit)


@router.delete("/{migration_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_migration(
    migration_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_bucket_migration_user),
    audit: AuditService = Depends(get_audit_logger),
) -> Response:
    service = BucketMigrationService(db)
    try:
        service.delete_migration(migration_id)
    except ValueError as exc:
        message = str(exc)
        error_status = status.HTTP_404_NOT_FOUND if message == "Migration not found" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=error_status, detail=message) from exc

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
    current_user: User = Depends(get_current_bucket_migration_user),
    audit: AuditService = Depends(get_audit_logger),
) -> BucketMigrationDetail:
    service = BucketMigrationService(db)
    try:
        migration = service.create_migration(payload, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

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
            "auto_grant_source_read_for_copy": bool(payload.auto_grant_source_read_for_copy),
            "webhook_enabled": bool((payload.webhook_url or "").strip()),
            "items": len(payload.buckets),
        },
    )
    return _migration_to_detail(migration, events_limit=200)


@router.patch("/{migration_id}", response_model=BucketMigrationDetail)
def update_migration(
    migration_id: int,
    payload: BucketMigrationCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_bucket_migration_user),
    audit: AuditService = Depends(get_audit_logger),
) -> BucketMigrationDetail:
    service = BucketMigrationService(db)
    try:
        migration = service.update_draft_migration(migration_id, payload)
    except ValueError as exc:
        message = str(exc)
        error_status = status.HTTP_404_NOT_FOUND if message == "Migration not found" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=error_status, detail=message) from exc

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
            "auto_grant_source_read_for_copy": bool(payload.auto_grant_source_read_for_copy),
            "webhook_enabled": bool((payload.webhook_url or "").strip()),
            "items": len(payload.buckets),
        },
    )
    return _migration_to_detail(migration, events_limit=200)


@router.post("/{migration_id}/precheck", response_model=BucketMigrationDetail)
def run_migration_precheck(
    migration_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_bucket_migration_user),
    audit: AuditService = Depends(get_audit_logger),
) -> BucketMigrationDetail:
    service = BucketMigrationService(db)
    try:
        migration = service.run_precheck(migration_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    audit.record_action(
        user=current_user,
        scope="manager",
        action="precheck_bucket_migration",
        entity_type="bucket_migration",
        entity_id=str(migration.id),
    )
    return _migration_to_detail(migration, events_limit=200)


@router.post("/{migration_id}/start", response_model=BucketMigrationActionResponse)
def start_migration(
    migration_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_bucket_migration_user),
    audit: AuditService = Depends(get_audit_logger),
) -> BucketMigrationActionResponse:
    service = BucketMigrationService(db)
    try:
        migration = service.start_migration(migration_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

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
    current_user: User = Depends(get_current_bucket_migration_user),
    audit: AuditService = Depends(get_audit_logger),
) -> BucketMigrationActionResponse:
    service = BucketMigrationService(db)
    try:
        migration = service.request_pause(migration_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

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
    current_user: User = Depends(get_current_bucket_migration_user),
    audit: AuditService = Depends(get_audit_logger),
) -> BucketMigrationActionResponse:
    service = BucketMigrationService(db)
    try:
        migration = service.resume_migration(migration_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

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
    current_user: User = Depends(get_current_bucket_migration_user),
    audit: AuditService = Depends(get_audit_logger),
) -> BucketMigrationActionResponse:
    service = BucketMigrationService(db)
    try:
        migration = service.stop_migration(migration_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

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
    current_user: User = Depends(get_current_bucket_migration_user),
    audit: AuditService = Depends(get_audit_logger),
) -> BucketMigrationActionResponse:
    service = BucketMigrationService(db)
    try:
        migration = service.continue_after_presync(migration_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

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
    current_user: User = Depends(get_current_bucket_migration_user),
    audit: AuditService = Depends(get_audit_logger),
) -> BucketMigrationActionResponse:
    service = BucketMigrationService(db)
    try:
        migration = service.rollback_failed_migration(migration_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

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
    current_user: User = Depends(get_current_bucket_migration_user),
    audit: AuditService = Depends(get_audit_logger),
) -> BucketMigrationActionResponse:
    service = BucketMigrationService(db)
    try:
        migration, retried_count = service.retry_failed_items(migration_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

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
    current_user: User = Depends(get_current_bucket_migration_user),
    audit: AuditService = Depends(get_audit_logger),
) -> BucketMigrationActionResponse:
    service = BucketMigrationService(db)
    try:
        migration, rolled_back_count = service.rollback_failed_items(migration_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

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
    current_user: User = Depends(get_current_bucket_migration_user),
    audit: AuditService = Depends(get_audit_logger),
) -> BucketMigrationActionResponse:
    service = BucketMigrationService(db)
    try:
        migration = service.retry_item(migration_id, item_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

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
    current_user: User = Depends(get_current_bucket_migration_user),
    audit: AuditService = Depends(get_audit_logger),
) -> BucketMigrationActionResponse:
    service = BucketMigrationService(db)
    try:
        migration = service.rollback_item(migration_id, item_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

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
