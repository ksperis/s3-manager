# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.buckets_service import BucketsService
from .bucket_migration.execution import BucketMigrationExecutionMixin
from .bucket_migration.persistence import BucketMigrationPersistenceMixin
from .bucket_migration.planning import BucketMigrationPlanningMixin
from .bucket_migration.precheck import BucketMigrationPrecheckPlanner
from .bucket_migration.precheck_inspection import BucketMigrationInspector
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
        self._configuration = BucketConfigurationService()
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
