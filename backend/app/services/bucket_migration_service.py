# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from .bucket_migration._shared import *
from .bucket_migration.execution import BucketMigrationExecutionMixin
from .bucket_migration.persistence import BucketMigrationPersistenceMixin
from .bucket_migration.planning import BucketMigrationPlanningMixin
from .bucket_migration.progress import BucketMigrationProgressMixin
from .bucket_migration.rollback import BucketMigrationRollbackMixin


class BucketMigrationService(
    BucketMigrationPersistenceMixin,
    BucketMigrationPlanningMixin,
    BucketMigrationExecutionMixin,
    BucketMigrationRollbackMixin,
    BucketMigrationProgressMixin,
):
    def __init__(
        self,
        db: Session,
        *,
        authorized_context_ids: Optional[set[str]] = None,
        admin_account_context_ids: Optional[set[str]] = None,
    ) -> None:
        self.db = db
        self._buckets = BucketsService()
        self._inspector = BucketMigrationInspector(self)
        self._precheck_planner = BucketMigrationPrecheckPlanner(self, self._inspector)
        self._authorized_context_ids: Optional[set[str]]
        self._admin_account_context_ids: Optional[set[str]]
        if authorized_context_ids is None:
            self._authorized_context_ids = None
        else:
            self._authorized_context_ids = {str(value or "").strip() for value in authorized_context_ids if str(value or "").strip()}
        if admin_account_context_ids is None:
            self._admin_account_context_ids = None
        else:
            self._admin_account_context_ids = {
                str(value or "").strip() for value in admin_account_context_ids if str(value or "").strip()
            }



from .bucket_migration.webhooks import (  # noqa: E402
    _BucketMigrationWebhookDispatcher,
    get_bucket_migration_webhook_dispatcher,
    reset_bucket_migration_webhook_dispatcher_for_tests,
)
from .bucket_migration.worker import (  # noqa: E402
    BucketMigrationWorker,
    get_bucket_migration_worker,
    reset_bucket_migration_worker_for_tests,
)
