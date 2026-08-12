# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal, Optional

from sqlalchemy.orm import Session

from app.db import S3User as S3UserModel
from app.models.browser import BrowserUsageSummary
from app.services.s3_accounts_service import S3AccountsService
from app.services.s3_execution_context import S3ExecutionContext
from app.services.s3_users_service import S3UsersService
from app.utils.size_units import size_to_bytes

BrowserUsageSource = Literal["account", "s3_user", "portal", "connection"]


class BrowserUsageSummaryService:
    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def _source(account: S3ExecutionContext) -> tuple[BrowserUsageSource, str]:
        if account.portal_browser_role:
            return "portal", "Storage Spaces"
        if account.s3_connection_id is not None:
            return "connection", "Connection"
        if account.s3_user_id is not None:
            return "s3_user", "S3 User"
        return "account", "Account"

    @staticmethod
    def _quota_gib_to_bytes(value: Optional[float]) -> Optional[int]:
        if value is None:
            return None
        try:
            return size_to_bytes(value, "gib")
        except ValueError:
            return None

    @staticmethod
    def _unavailable(*, source: BrowserUsageSource, label: str) -> BrowserUsageSummary:
        return BrowserUsageSummary(available=False, source=source, label=label)

    def _available(
        self,
        *,
        source: BrowserUsageSource,
        label: str,
        used_bytes: Optional[int],
        object_count: Optional[int],
        quota_max_size_gb: Optional[float],
        quota_max_objects: Optional[int],
    ) -> BrowserUsageSummary:
        if used_bytes is None:
            return self._unavailable(source=source, label=label)
        return BrowserUsageSummary(
            available=True,
            source=source,
            label=label,
            used_bytes=used_bytes,
            object_count=object_count,
            quota_max_size_bytes=self._quota_gib_to_bytes(quota_max_size_gb),
            quota_max_objects=quota_max_objects,
        )

    def _for_account(
        self,
        account: S3ExecutionContext,
        *,
        source: BrowserUsageSource,
        label: str,
    ) -> BrowserUsageSummary:
        service = S3AccountsService(self.db)
        used_bytes, object_count, _bucket_count = service.get_account_usage(account)
        if used_bytes is None:
            return self._unavailable(source=source, label=label)
        quota_max_size_gb, quota_max_objects = service.get_account_quota(account)
        return self._available(
            source=source,
            label=label,
            used_bytes=used_bytes,
            object_count=object_count,
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
        )

    def _for_s3_user(
        self,
        account: S3ExecutionContext,
        *,
        source: BrowserUsageSource,
        label: str,
    ) -> BrowserUsageSummary:
        s3_user_id = account.s3_user_id
        if not isinstance(s3_user_id, int) or s3_user_id <= 0:
            return self._unavailable(source=source, label=label)
        s3_user = self.db.query(S3UserModel).filter(S3UserModel.id == s3_user_id).first()
        if not s3_user:
            return self._unavailable(source=source, label=label)
        service = S3UsersService(self.db)
        used_bytes, object_count, _bucket_count = service.get_user_usage(s3_user)
        if used_bytes is None:
            return self._unavailable(source=source, label=label)
        quota_max_size_gb, quota_max_objects = service.get_user_quota(s3_user)
        return self._available(
            source=source,
            label=label,
            used_bytes=used_bytes,
            object_count=object_count,
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
        )

    def build(self, account: S3ExecutionContext) -> BrowserUsageSummary:
        source, label = self._source(account)
        if source == "connection":
            return self._unavailable(source=source, label=label)
        if source == "s3_user":
            return self._for_s3_user(account, source=source, label=label)
        return self._for_account(account, source=source, label=label)


def get_browser_usage_summary_service(db: Session) -> BrowserUsageSummaryService:
    return BrowserUsageSummaryService(db)
