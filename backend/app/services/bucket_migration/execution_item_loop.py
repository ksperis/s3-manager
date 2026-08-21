# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any, Callable, Optional

from app.db import BucketMigration, BucketMigrationItem
from app.utils.time import utcnow

from ._shared import (
    _ITEM_HEARTBEAT_PERSIST_INTERVAL_SECONDS,
    _ResolvedContext,
    _WorkerLeaseLostError,
)

if TYPE_CHECKING:
    from .execution_item_runner import BucketMigrationItemRunnerMixin


class _MigrationItemExecutionLoop:
    def __init__(
        self,
        *,
        service: BucketMigrationItemRunnerMixin,
        migration: BucketMigration,
        item: BucketMigrationItem,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        control_check: Callable[[], str],
    ) -> None:
        self.service = service
        self.migration = migration
        self.item = item
        self.source_ctx = source_ctx
        self.target_ctx = target_ctx
        self.control_check = control_check
        self.last_heartbeat_persist = 0.0
        self.step_handlers: dict[str, Callable[[str], bool]] = {
            "create_bucket": self._run_create_bucket,
            "copy_bucket_settings": self._run_copy_bucket_settings,
            "apply_target_lock": self._run_apply_target_lock,
            "pre_sync": self._run_pre_sync,
            "awaiting_cutover": self._run_awaiting_cutover,
            "apply_read_only": self._run_apply_read_only,
            "sync": self._run_sync,
            "verify": self._run_verify,
            "delete_source": self._run_delete_source,
            "completed": self._finish_terminal_step,
            "skipped": self._finish_terminal_step,
        }

    def run(self) -> None:
        self.service._assert_item_execution_plan_supported(self.item)
        while True:
            self._persist_heartbeat_if_due()
            if not self._may_continue():
                return

            strategy = self.service._item_execution_strategy(self.item)
            handler = self.step_handlers.get(self.item.step)
            if handler is None:
                raise RuntimeError(f"Unsupported item step: {self.item.step}")
            if not handler(strategy):
                return

    def _persist_heartbeat_if_due(self) -> None:
        now_mono = time.monotonic()
        if (
            now_mono - self.last_heartbeat_persist
        ) < _ITEM_HEARTBEAT_PERSIST_INTERVAL_SECONDS:
            return
        heartbeat_at = utcnow()
        self.migration.last_heartbeat_at = heartbeat_at
        self.migration.updated_at = heartbeat_at
        self.item.updated_at = heartbeat_at
        self.service._commit()
        self.last_heartbeat_persist = now_mono

    def _may_continue(self) -> bool:
        state = self.control_check()
        if state == "lost_lease":
            raise _WorkerLeaseLostError(
                f"Worker lease lost for migration {self.migration.id}"
            )
        if state == "cancel":
            self.item.status = "canceled"
            self.item.finished_at = utcnow()
            self.item.updated_at = utcnow()
            self.service._commit()
            return False
        if state == "pause":
            self.item.status = "paused"
            self.item.updated_at = utcnow()
            self.service._commit()
            return False
        return True

    def _run_create_bucket(self, strategy: str) -> bool:
        return self.service._run_create_bucket_step(
            self.migration,
            self.item,
            self.source_ctx,
            self.target_ctx,
            strategy=strategy,
        )

    def _run_copy_bucket_settings(self, _strategy: str) -> bool:
        self.service._copy_bucket_settings(
            self.source_ctx.account,
            self.item.source_bucket,
            self.target_ctx.account,
            self.item.target_bucket,
            self.migration,
            self.item,
        )
        self.item.step = self.service._next_step_after_target_setup(
            self.migration,
            self.item,
        )
        self.service._commit()
        return True

    def _run_apply_target_lock(self, _strategy: str) -> bool:
        self.service._run_apply_target_lock_step(
            self.migration,
            self.item,
            self.target_ctx,
        )
        return True

    def _run_pre_sync(self, _strategy: str) -> bool:
        synced = self._sync_bucket(allow_delete=False)
        if synced is None:
            return False
        copied, _deleted, diff = synced
        self.service._store_item_diff(self.item, diff)
        self.item.pre_sync_done = True
        self.item.status = "awaiting_cutover"
        self.item.step = "awaiting_cutover"
        self.item.updated_at = utcnow()
        self.service._add_event(
            self.migration,
            item=self.item,
            level="info",
            message="Pre-sync completed; waiting for cutover.",
            metadata={"copied": copied},
        )
        self.service._commit()
        return False

    def _run_awaiting_cutover(self, _strategy: str) -> bool:
        self.item.status = "awaiting_cutover"
        self.item.updated_at = utcnow()
        self.service._commit()
        return False

    def _run_apply_read_only(self, _strategy: str) -> bool:
        self.service._apply_read_only_policy(
            self.source_ctx.account,
            self.item.source_bucket,
            self.item,
        )
        self.item.read_only_applied = True
        self.item.step = "sync"
        self.item.updated_at = utcnow()
        self.service._add_event(
            self.migration,
            item=self.item,
            level="info",
            message="Read-only policy applied on source bucket.",
        )
        self.service._commit()
        return True

    def _run_sync(self, _strategy: str) -> bool:
        synced = self._sync_bucket(allow_delete=True)
        if synced is None:
            return False
        _copied, _deleted, diff = synced
        self.service._store_item_diff(self.item, diff)
        self.item.step = "verify"
        self.item.updated_at = utcnow()
        self.service._commit()
        return True

    def _sync_bucket(self, *, allow_delete: bool) -> Optional[tuple[int, int, Any]]:
        copied, deleted, diff = self.service._sync_bucket(
            self.source_ctx,
            self.target_ctx,
            source_bucket=self.item.source_bucket,
            target_bucket=self.item.target_bucket,
            allow_delete=allow_delete,
            parallelism_max=self.migration.parallelism_max,
            migration=self.migration,
            item=self.item,
            control_check=self.control_check,
        )
        if copied < 0 or deleted < 0:
            self.service._stop_interrupted_item(
                self.migration,
                self.item,
                self.control_check,
            )
            return None
        return copied, deleted, diff

    def _run_verify(self, strategy: str) -> bool:
        return self.service._run_verify_step(
            self.migration,
            self.item,
            self.source_ctx,
            self.target_ctx,
            strategy=strategy,
            control_check=self.control_check,
        )

    def _run_delete_source(self, _strategy: str) -> bool:
        self.service._set_managed_block_policy(
            self.item.source_bucket,
            self.source_ctx.account,
            deny_delete=False,
        )
        self.service._delete_source_bucket_with_retry(
            self.item.source_bucket,
            self.source_ctx.account,
        )
        self.service._finalize_target_versioning_state(
            self.target_ctx.account,
            self.item.target_bucket,
            self.migration,
            self.item,
        )
        self.item.status = "completed"
        self.item.step = "completed"
        self.item.finished_at = utcnow()
        self.item.updated_at = utcnow()
        self.service._add_event(
            self.migration,
            item=self.item,
            level="info",
            message="Source bucket deleted after clean diff.",
        )
        self.service._commit()
        return False

    def _finish_terminal_step(self, _strategy: str) -> bool:
        if self.item.status == "running":
            self.item.status = "completed"
        if self.item.finished_at is None:
            self.item.finished_at = utcnow()
        self.item.updated_at = utcnow()
        self.service._commit()
        return False
