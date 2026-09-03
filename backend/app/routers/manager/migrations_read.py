# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Manager bucket-migration read and event-stream routes."""

from __future__ import annotations

import asyncio
import json
import logging
from time import monotonic
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.db import BucketMigration, BucketMigrationEvent, BucketMigrationItem
from app.models.access_context import BucketMigrationAccessScope
from app.models.bucket_migration import (
    BucketMigrationDetail,
    BucketMigrationListResponse,
)
from app.routers.dependencies import get_current_bucket_migration_scope
from app.routers.manager.migrations_common import _build_service
from app.services.mappers.bucket_migration import (
    bucket_migration_to_detail as _migration_to_detail,
    bucket_migration_to_view as _migration_to_view,
)
from app.utils.http_errors import raise_http_exception_from_exception

router = APIRouter(prefix="/manager/migrations", tags=["manager-migrations"])
logger = logging.getLogger(__name__)

_MIGRATION_STREAM_POLL_INTERVAL_SECONDS = 1.0
_MIGRATION_STREAM_KEEPALIVE_INTERVAL_SECONDS = 15.0


def _format_sse_event(event: str, payload: dict[str, object], *, event_id: Optional[int] = None) -> str:
    lines: list[str] = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event}")
    payload_json = json.dumps(payload, separators=(",", ":"), ensure_ascii=False, default=str)
    for entry in payload_json.splitlines() or [payload_json]:
        lines.append(f"data: {entry}")
    lines.append("")
    return "\n".join(lines) + "\n"


def _is_final_migration_status(status_value: str) -> bool:
    return status_value in {"completed", "completed_with_errors", "failed", "canceled", "rolled_back"}


def _compute_migration_stream_signature(
    db: Session,
    migration_id: int,
    *,
    migration: Optional[BucketMigration] = None,
) -> tuple[str, str, int]:
    max_item_updated_at = (
        db.query(func.max(BucketMigrationItem.updated_at))
        .filter(BucketMigrationItem.migration_id == migration_id)
        .scalar()
    )
    max_event_id = (
        db.query(func.max(BucketMigrationEvent.id))
        .filter(BucketMigrationEvent.migration_id == migration_id)
        .scalar()
    )
    migration_updated_at = migration.updated_at if migration is not None else None
    return (
        migration_updated_at.isoformat() if migration_updated_at else "",
        max_item_updated_at.isoformat() if max_item_updated_at else "",
        int(max_event_id or 0),
    )


@router.get("", response_model=BucketMigrationListResponse)
def list_migrations(
    limit: int = Query(default=100, ge=1, le=500),
    context_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
) -> BucketMigrationListResponse:
    service = _build_service(db, scope)
    migrations = service.list_migrations(limit=limit, context_id=context_id)
    return BucketMigrationListResponse(items=[_migration_to_view(migration) for migration in migrations])


@router.get("/{migration_id}", response_model=BucketMigrationDetail)
def get_migration(
    migration_id: int,
    events_limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
) -> BucketMigrationDetail:
    service = _build_service(db, scope)
    try:
        migration = service.get_migration(migration_id)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)
    items = service.list_migration_items(migration.id)
    recent_events = service.list_recent_migration_events(migration.id, limit=events_limit)
    return _migration_to_detail(migration, items=items, recent_events=recent_events)


@router.get("/{migration_id}/stream")
async def stream_migration(
    migration_id: int,
    request: Request,
    events_limit: int = Query(default=200, ge=1, le=1000),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
) -> StreamingResponse:
    with SessionLocal() as db:
        service = _build_service(db, scope)
        try:
            service.get_migration(migration_id)
        except ValueError as exc:
            raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)

    async def event_generator():
        stream_event_id = 0
        last_signature: Optional[tuple[str, str, int]] = None
        last_keepalive_at = monotonic()

        while True:
            if await request.is_disconnected():
                break

            try:
                with SessionLocal() as db:
                    service = _build_service(db, scope)
                    migration = service.get_migration(migration_id)
                    signature = _compute_migration_stream_signature(db, migration_id, migration=migration)
                    if signature != last_signature:
                        items = service.list_migration_items(migration.id)
                        recent_events = service.list_recent_migration_events(migration.id, limit=events_limit)
                        detail = _migration_to_detail(
                            migration,
                            items=items,
                            recent_events=recent_events,
                        )
                        stream_event_id += 1
                        yield _format_sse_event(
                            "snapshot",
                            detail.model_dump(mode="json"),
                            event_id=stream_event_id,
                        )
                        last_signature = signature
                        last_keepalive_at = monotonic()

                        if _is_final_migration_status(detail.status):
                            stream_event_id += 1
                            yield _format_sse_event(
                                "done",
                                {
                                    "migration_id": migration_id,
                                    "status": detail.status,
                                    "reason": "final_state",
                                },
                                event_id=stream_event_id,
                            )
                            break
            except ValueError:
                stream_event_id += 1
                yield _format_sse_event(
                    "error",
                    {"detail": "Migration not found"},
                    event_id=stream_event_id,
                )
                break
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # pragma: no cover
                logger.exception("Bucket migration stream failed for migration %s", migration_id)
                stream_event_id += 1
                yield _format_sse_event(
                    "error",
                    {"detail": "Bucket migration stream failed"},
                    event_id=stream_event_id,
                )
                break

            now = monotonic()
            if (now - last_keepalive_at) >= _MIGRATION_STREAM_KEEPALIVE_INTERVAL_SECONDS:
                yield ": keepalive\n\n"
                last_keepalive_at = now

            await asyncio.sleep(_MIGRATION_STREAM_POLL_INTERVAL_SECONDS)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
