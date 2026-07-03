# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from .execution_cleanup import BucketMigrationCleanupMixin
from .execution_context import BucketMigrationExecutionContextMixin
from .execution_control import BucketMigrationExecutionControlMixin
from .execution_item_runner import BucketMigrationItemRunnerMixin
from .execution_object_sync import BucketMigrationObjectSyncMixin
from .execution_policy_grants import BucketMigrationPolicyGrantsMixin


class BucketMigrationExecutionMixin(
    BucketMigrationExecutionControlMixin,
    BucketMigrationItemRunnerMixin,
    BucketMigrationPolicyGrantsMixin,
    BucketMigrationObjectSyncMixin,
    BucketMigrationCleanupMixin,
    BucketMigrationExecutionContextMixin,
):
    pass
