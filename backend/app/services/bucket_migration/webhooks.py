# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


class _BucketMigrationWebhookDispatcher:
    def __init__(
        self,
        *,
        queue_size: int,
        workers: int,
        timeout_seconds: float,
    ) -> None:
        self._queue: queue.Queue[_WebhookDispatchTask] = queue.Queue(maxsize=max(1, int(queue_size)))
        self._workers = max(1, int(workers))
        self._timeout_seconds = max(0.1, float(timeout_seconds))
        self._stop_event = threading.Event()
        self._threads: list[threading.Thread] = []
        self._lock = threading.Lock()

    def start(self) -> None:
        with self._lock:
            if any(thread.is_alive() for thread in self._threads):
                return
            self._stop_event.clear()
            self._threads = []
            for index in range(self._workers):
                thread = threading.Thread(
                    target=self._run_loop,
                    name=f"bucket-migration-webhook-{index + 1}",
                    daemon=True,
                )
                thread.start()
                self._threads.append(thread)

    def stop(self, timeout: float = 3.0) -> None:
        with self._lock:
            self._stop_event.set()
            threads = list(self._threads)
        for thread in threads:
            thread.join(timeout=timeout)

    def enqueue(
        self,
        *,
        webhook_url: str,
        payload: dict[str, Any],
        migration_id: int,
        item_id: Optional[int],
    ) -> bool:
        task = _WebhookDispatchTask(
            webhook_url=webhook_url,
            payload=payload,
            migration_id=int(migration_id),
            item_id=int(item_id) if item_id is not None else None,
        )
        try:
            self._queue.put_nowait(task)
            return True
        except queue.Full:
            return False

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                task = self._queue.get(timeout=0.2)
            except queue.Empty:
                continue
            try:
                self._deliver(task)
            finally:
                self._queue.task_done()

    def _deliver(self, task: _WebhookDispatchTask) -> None:
        try:
            _validate_webhook_target_url(task.webhook_url)
        except ValueError as exc:
            logger.warning(
                "Bucket migration webhook target rejected before delivery: migration=%s item=%s error=%s",
                task.migration_id,
                task.item_id,
                exc,
            )
            return

        try:
            response = requests.post(
                task.webhook_url,
                json=task.payload,
                timeout=self._timeout_seconds,
                allow_redirects=False,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "s3-manager-migration-webhook/1.0",
                },
            )
            if int(getattr(response, "status_code", 0) or 0) >= 400:
                logger.warning(
                    "Bucket migration webhook returned non-success status: migration=%s item=%s status=%s",
                    task.migration_id,
                    task.item_id,
                    getattr(response, "status_code", "unknown"),
                )
        except requests.RequestException as exc:
            logger.warning(
                "Bucket migration webhook delivery failed: migration=%s item=%s error=%s",
                task.migration_id,
                task.item_id,
                exc,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Bucket migration webhook delivery raised unexpected error: migration=%s item=%s error=%s",
                task.migration_id,
                task.item_id,
                exc,
            )


_webhook_dispatcher_singleton: Optional[_BucketMigrationWebhookDispatcher] = None
_webhook_dispatcher_lock = threading.Lock()


def get_bucket_migration_webhook_dispatcher() -> _BucketMigrationWebhookDispatcher:
    global _webhook_dispatcher_singleton
    with _webhook_dispatcher_lock:
        if _webhook_dispatcher_singleton is None:
            _webhook_dispatcher_singleton = _BucketMigrationWebhookDispatcher(
                queue_size=_WEBHOOK_QUEUE_SIZE,
                workers=_WEBHOOK_WORKERS,
                timeout_seconds=_WEBHOOK_TIMEOUT_SECONDS,
            )
            _webhook_dispatcher_singleton.start()
        return _webhook_dispatcher_singleton


def reset_bucket_migration_webhook_dispatcher_for_tests() -> None:
    global _webhook_dispatcher_singleton
    with _webhook_dispatcher_lock:
        dispatcher = _webhook_dispatcher_singleton
        _webhook_dispatcher_singleton = None
    if dispatcher is not None:
        dispatcher.stop(timeout=0.1)
