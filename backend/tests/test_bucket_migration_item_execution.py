# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timezone
import json
from types import SimpleNamespace

import pytest

from app.services.bucket_migration_service import BucketMigrationService


def _execution_plan() -> str:
    return json.dumps(
        {
            "report_version": 2,
            "strategy": "current_only",
            "supported": True,
            "blocked": False,
            "delete_source_safe": True,
            "rollback_safe": True,
            "same_endpoint_copy_safe": True,
            "blocking_codes": [],
        }
    )


def _migration(**overrides):
    values = {
        "id": 101,
        "parallelism_max": 3,
        "delete_source": False,
        "strong_integrity_check": False,
        "last_heartbeat_at": None,
        "updated_at": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _item(*, step: str):
    return SimpleNamespace(
        execution_plan_json=_execution_plan(),
        source_bucket="bucket-a",
        target_bucket="bucket-b",
        status="running",
        step=step,
        read_only_applied=False,
        pre_sync_done=False,
        error_message=None,
        finished_at=None,
        updated_at=None,
    )


def _diff(*, different_count: int = 0, only_source_count: int = 0):
    return SimpleNamespace(
        source_count=1,
        target_count=1,
        matched_count=1,
        different_count=different_count,
        only_source_count=only_source_count,
        only_target_count=0,
        sample={
            "only_source_sample": [],
            "only_target_sample": [],
            "different_sample": [],
        },
    )


def test_run_item_dispatches_step_handlers_in_order(db_session):
    service = BucketMigrationService(db_session)
    migration = _migration()
    item = _item(step="copy_bucket_settings")
    source_ctx = SimpleNamespace(account=object())
    target_ctx = SimpleNamespace(account=object())
    calls: list[object] = []

    service._copy_bucket_settings = (  # type: ignore[method-assign]
        lambda *_args, **_kwargs: calls.append("copy_settings")
    )
    service._next_step_after_target_setup = (  # type: ignore[method-assign]
        lambda *_args, **_kwargs: "apply_read_only"
    )
    service._apply_read_only_policy = (  # type: ignore[method-assign]
        lambda *_args, **_kwargs: calls.append("apply_read_only")
    )

    def sync_bucket(*_args, **kwargs):
        calls.append(("sync", kwargs["allow_delete"]))
        return 2, 1, _diff()

    def verify_step(*_args, **kwargs):
        calls.append(("verify", kwargs["strategy"]))
        item.status = "completed"
        item.step = "completed"
        item.finished_at = datetime.now(timezone.utc)
        return False

    service._sync_bucket = sync_bucket  # type: ignore[method-assign]
    service._run_verify_step = verify_step  # type: ignore[method-assign]
    service._add_event = lambda *_args, **_kwargs: None  # type: ignore[method-assign]

    service._run_item(
        migration,
        item,
        source_ctx,
        target_ctx,
        control_check=lambda: "run",
    )

    assert calls == [
        "copy_settings",
        "apply_read_only",
        ("sync", True),
        ("verify", "current_only"),
    ]
    assert item.status == "completed"
    assert item.step == "completed"
    assert item.read_only_applied is True
    assert item.matched_count == 1


def test_run_item_turns_interrupted_sync_into_paused_state(db_session):
    service = BucketMigrationService(db_session)
    migration = _migration(id=102, parallelism_max=2)
    item = _item(step="sync")
    control_states = iter(["run", "pause"])
    service._sync_bucket = (  # type: ignore[method-assign]
        lambda *_args, **_kwargs: (-1, -1, SimpleNamespace())
    )

    service._run_item(
        migration,
        item,
        SimpleNamespace(account=object()),
        SimpleNamespace(account=object()),
        control_check=lambda: next(control_states),
    )

    assert item.status == "paused"
    assert item.step == "sync"
    assert item.finished_at is None
    assert item.updated_at is not None


def test_run_item_rejects_unknown_step(db_session):
    service = BucketMigrationService(db_session)

    with pytest.raises(RuntimeError, match="^Unsupported item step: unknown$"):
        service._run_item(
            _migration(id=103, parallelism_max=1),
            _item(step="unknown"),
            SimpleNamespace(account=object()),
            SimpleNamespace(account=object()),
            control_check=lambda: "run",
        )


def test_verify_step_fails_non_clean_diff(db_session):
    service = BucketMigrationService(db_session)
    migration = _migration()
    item = _item(step="verify")
    events: list[dict[str, object]] = []
    service._compare_buckets_streamed = (  # type: ignore[method-assign]
        lambda *_args, **_kwargs: _diff(different_count=1, only_source_count=2)
    )
    service._add_event = (  # type: ignore[method-assign]
        lambda *_args, **kwargs: events.append(kwargs)
    )

    should_continue = service._run_verify_step(
        migration,
        item,
        SimpleNamespace(account=object()),
        SimpleNamespace(account=object()),
        strategy="current_only",
        control_check=lambda: "run",
    )

    assert should_continue is False
    assert item.status == "failed"
    assert item.step == "verify"
    assert item.error_message == "Final diff is not clean"
    assert item.finished_at is not None
    assert events == [
        {
            "item": item,
            "level": "error",
            "message": "Final diff detected differences.",
            "metadata": {
                "different_count": 1,
                "only_source_count": 2,
                "only_target_count": 0,
            },
        }
    ]


def test_verify_step_completes_clean_item_without_source_deletion(db_session):
    service = BucketMigrationService(db_session)
    migration = _migration(delete_source=False)
    item = _item(step="verify")
    target_account = object()
    finalized: list[tuple[object, str]] = []
    events: list[str] = []
    service._compare_buckets_streamed = (  # type: ignore[method-assign]
        lambda *_args, **_kwargs: _diff()
    )
    service._finalize_target_versioning_state = (  # type: ignore[method-assign]
        lambda account, bucket, *_args: finalized.append((account, bucket))
    )
    service._add_event = (  # type: ignore[method-assign]
        lambda *_args, **kwargs: events.append(kwargs["message"])
    )

    should_continue = service._run_verify_step(
        migration,
        item,
        SimpleNamespace(account=object()),
        SimpleNamespace(account=target_account),
        strategy="current_only",
        control_check=lambda: "run",
    )

    assert should_continue is False
    assert item.status == "completed"
    assert item.step == "completed"
    assert item.finished_at is not None
    assert finalized == [(target_account, "bucket-b")]
    assert events == ["Item completed with clean diff."]
