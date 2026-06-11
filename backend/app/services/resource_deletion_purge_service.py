# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db import (
    BillingAssignment,
    BillingRateCard,
    BillingStorageDaily,
    BillingUsageDaily,
    BucketUsageStatsSnapshot,
    EndpointHealthCheck,
    EndpointHealthLatest,
    EndpointHealthRollup,
    EndpointHealthStatusSegment,
    QuotaAlertState,
    QuotaUsageDaily,
    QuotaUsageHourly,
)


class ResourceDeletionPurgeService:
    """Hard-delete derived database rows before removing their owning resource."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def purge_account_derived_data(self, account_id: int) -> None:
        self.db.query(BillingAssignment).filter(BillingAssignment.s3_account_id == account_id).delete(
            synchronize_session=False
        )
        self.db.query(BillingUsageDaily).filter(BillingUsageDaily.s3_account_id == account_id).delete(
            synchronize_session=False
        )
        self.db.query(BillingStorageDaily).filter(BillingStorageDaily.s3_account_id == account_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaAlertState).filter(QuotaAlertState.s3_account_id == account_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaUsageHourly).filter(QuotaUsageHourly.s3_account_id == account_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaUsageDaily).filter(QuotaUsageDaily.s3_account_id == account_id).delete(
            synchronize_session=False
        )
        self.db.query(BucketUsageStatsSnapshot).filter(
            BucketUsageStatsSnapshot.scope_kind == "manager",
            BucketUsageStatsSnapshot.scope_id == str(account_id),
        ).delete(synchronize_session=False)

    def purge_s3_user_derived_data(self, s3_user_id: int) -> None:
        self.db.query(BillingAssignment).filter(BillingAssignment.s3_user_id == s3_user_id).delete(
            synchronize_session=False
        )
        self.db.query(BillingUsageDaily).filter(BillingUsageDaily.s3_user_id == s3_user_id).delete(
            synchronize_session=False
        )
        self.db.query(BillingStorageDaily).filter(BillingStorageDaily.s3_user_id == s3_user_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaAlertState).filter(QuotaAlertState.s3_user_id == s3_user_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaUsageHourly).filter(QuotaUsageHourly.s3_user_id == s3_user_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaUsageDaily).filter(QuotaUsageDaily.s3_user_id == s3_user_id).delete(
            synchronize_session=False
        )
        self.db.query(BucketUsageStatsSnapshot).filter(
            BucketUsageStatsSnapshot.scope_kind == "manager",
            BucketUsageStatsSnapshot.scope_id == f"s3u-{s3_user_id}",
        ).delete(synchronize_session=False)

    def purge_endpoint_derived_data(self, endpoint_id: int) -> None:
        self.db.query(BillingAssignment).filter(BillingAssignment.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(BillingUsageDaily).filter(BillingUsageDaily.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(BillingStorageDaily).filter(BillingStorageDaily.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(BillingRateCard).filter(BillingRateCard.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaAlertState).filter(QuotaAlertState.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaUsageHourly).filter(QuotaUsageHourly.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaUsageDaily).filter(QuotaUsageDaily.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(BucketUsageStatsSnapshot).filter(
            BucketUsageStatsSnapshot.scope_kind.in_(("admin_managed", "ceph_admin")),
            BucketUsageStatsSnapshot.scope_id == str(endpoint_id),
        ).delete(synchronize_session=False)
        self.purge_endpoint_healthchecks(endpoint_id)

    def purge_endpoint_healthchecks(self, endpoint_id: int) -> None:
        self.db.query(EndpointHealthCheck).filter(EndpointHealthCheck.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(EndpointHealthLatest).filter(EndpointHealthLatest.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(EndpointHealthStatusSegment).filter(
            EndpointHealthStatusSegment.storage_endpoint_id == endpoint_id
        ).delete(synchronize_session=False)
        self.db.query(EndpointHealthRollup).filter(EndpointHealthRollup.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
