# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import asyncio
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import sessionmaker

from app.db import BucketMigration, BucketMigrationEvent, BucketMigrationItem
from app.routers.manager import migrations as migrations_router
from app.routers.dependencies import BucketMigrationAccessScope


def _seed_migration(session_factory: sessionmaker, *, status: str) -> int:
    with session_factory() as db:
        migration = BucketMigration(
            source_context_id="source-ctx",
            target_context_id="target-ctx",
            mode="one_shot",
            copy_bucket_settings=False,
            delete_source=False,
            lock_target_writes=True,
            use_same_endpoint_copy=False,
            auto_grant_source_read_for_copy=False,
            status=status,
            precheck_status="passed",
            parallelism_max=4,
            total_items=1,
        )
        db.add(migration)
        db.flush()

        item_status = "completed" if status in {"completed", "completed_with_errors", "failed", "canceled", "rolled_back"} else "running"
        item_step = "completed" if item_status == "completed" else "sync"
        item = BucketMigrationItem(
            migration_id=migration.id,
            source_bucket="bucket-a",
            target_bucket="bucket-a-copy",
            status=item_status,
            step=item_step,
        )
        db.add(item)
        db.flush()

        event = BucketMigrationEvent(
            migration_id=migration.id,
            item_id=item.id,
            level="info",
            message="Migration seed event.",
        )
        db.add(event)
        db.commit()
        return int(migration.id)


def _request_with_disconnect_after(calls_before_disconnect: int):
    state = {"calls": 0}

    async def is_disconnected() -> bool:
        state["calls"] += 1
        return state["calls"] > calls_before_disconnect

    return SimpleNamespace(is_disconnected=is_disconnected)


async def _read_stream_body(response) -> str:
    chunks: list[str] = []
    async for chunk in response.body_iterator:
        chunks.append(chunk.decode() if isinstance(chunk, bytes) else chunk)
    return "".join(chunks)


def _scope(*context_ids: str) -> BucketMigrationAccessScope:
    return BucketMigrationAccessScope(
        user=SimpleNamespace(id=1),
        allowed_context_ids=set(context_ids),
    )


def test_manager_migration_stream_emits_snapshot_and_done_for_final_state(
    db_session,
    monkeypatch: pytest.MonkeyPatch,
):
    test_session_factory = sessionmaker(autocommit=False, autoflush=False, bind=db_session.get_bind())
    monkeypatch.setattr(migrations_router, "SessionLocal", test_session_factory)
    migration_id = _seed_migration(test_session_factory, status="completed")

    async def _run() -> str:
        request = _request_with_disconnect_after(calls_before_disconnect=100)
        response = await migrations_router.stream_migration(
            migration_id=migration_id,
            request=request,
            events_limit=200,
            scope=_scope("source-ctx", "target-ctx"),
        )
        return await _read_stream_body(response)

    body = asyncio.run(_run())
    assert "event: snapshot" in body
    assert "event: done" in body
    assert f'"migration_id":{migration_id}' in body
    assert '"reason":"final_state"' in body


def test_manager_migration_stream_returns_404_for_unknown_migration(
    db_session,
    monkeypatch: pytest.MonkeyPatch,
):
    test_session_factory = sessionmaker(autocommit=False, autoflush=False, bind=db_session.get_bind())
    monkeypatch.setattr(migrations_router, "SessionLocal", test_session_factory)

    async def _run() -> None:
        request = _request_with_disconnect_after(calls_before_disconnect=1)
        with pytest.raises(HTTPException) as exc:
            await migrations_router.stream_migration(
                migration_id=99999,
                request=request,
                events_limit=200,
                scope=_scope("source-ctx", "target-ctx"),
            )
        assert exc.value.status_code == 404

    asyncio.run(_run())


def test_manager_migration_stream_stops_when_client_disconnects(
    db_session,
    monkeypatch: pytest.MonkeyPatch,
):
    test_session_factory = sessionmaker(autocommit=False, autoflush=False, bind=db_session.get_bind())
    monkeypatch.setattr(migrations_router, "SessionLocal", test_session_factory)
    monkeypatch.setattr(migrations_router, "_MIGRATION_STREAM_POLL_INTERVAL_SECONDS", 0.01)
    migration_id = _seed_migration(test_session_factory, status="running")

    async def _run() -> str:
        request = _request_with_disconnect_after(calls_before_disconnect=1)
        response = await migrations_router.stream_migration(
            migration_id=migration_id,
            request=request,
            events_limit=200,
            scope=_scope("source-ctx", "target-ctx"),
        )
        return await asyncio.wait_for(_read_stream_body(response), timeout=1.0)

    body = asyncio.run(_run())
    assert "event: snapshot" in body
    assert "event: done" not in body


def test_manager_migration_stream_emits_multiple_snapshots_when_item_timestamp_changes(
    db_session,
    monkeypatch: pytest.MonkeyPatch,
):
    test_session_factory = sessionmaker(autocommit=False, autoflush=False, bind=db_session.get_bind())
    monkeypatch.setattr(migrations_router, "SessionLocal", test_session_factory)
    monkeypatch.setattr(migrations_router, "_MIGRATION_STREAM_POLL_INTERVAL_SECONDS", 0.01)
    migration_id = _seed_migration(test_session_factory, status="running")

    async def _touch_item_timestamp() -> None:
        await asyncio.sleep(0.06)
        with test_session_factory() as db:
            migration = db.query(BucketMigration).filter(BucketMigration.id == migration_id).first()
            item = db.query(BucketMigrationItem).filter(BucketMigrationItem.migration_id == migration_id).first()
            assert migration is not None
            assert item is not None
            migration.updated_at = migration.updated_at + timedelta(seconds=2)
            item.updated_at = item.updated_at + timedelta(seconds=2)
            db.commit()

    async def _run() -> str:
        request = _request_with_disconnect_after(calls_before_disconnect=7)
        response = await migrations_router.stream_migration(
            migration_id=migration_id,
            request=request,
            events_limit=200,
            scope=_scope("source-ctx", "target-ctx"),
        )
        updater = asyncio.create_task(_touch_item_timestamp())
        body = await asyncio.wait_for(_read_stream_body(response), timeout=1.0)
        await updater
        return body

    body = asyncio.run(_run())
    assert body.count("event: snapshot") >= 2


def test_manager_migration_get_detail_respects_events_limit(
    db_session,
    monkeypatch: pytest.MonkeyPatch,
):
    test_session_factory = sessionmaker(autocommit=False, autoflush=False, bind=db_session.get_bind())
    monkeypatch.setattr(migrations_router, "SessionLocal", test_session_factory)
    migration_id = _seed_migration(test_session_factory, status="running")
    with test_session_factory() as db:
        for index in range(5):
            db.add(
                BucketMigrationEvent(
                    migration_id=migration_id,
                    level="info",
                    message=f"event-{index}",
                )
            )
        db.commit()

    with test_session_factory() as db:
        detail = migrations_router.get_migration(
            migration_id=migration_id,
            events_limit=2,
            db=db,
            scope=_scope("source-ctx", "target-ctx"),
        )

    assert len(detail.recent_events) == 2
