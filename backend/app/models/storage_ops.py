# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Literal, Optional

from pydantic import BaseModel

from app.models.ceph_admin import CephAdminBucketSummary
from app.models.pagination import PaginatedResponse


StorageOpsContextKind = Literal["account", "connection", "s3_user"]


class StorageOpsBucketSummary(CephAdminBucketSummary):
    context_id: str
    context_name: str
    context_kind: StorageOpsContextKind
    endpoint_name: Optional[str] = None
    bucket_name: Optional[str] = None


class PaginatedStorageOpsBucketsResponse(PaginatedResponse):
    items: list[StorageOpsBucketSummary]


class StorageOpsSummary(BaseModel):
    total_contexts: int
    total_accounts: int
    total_s3_users: int
    total_connections: int
    total_shared_connections: int
    total_private_connections: int
    total_endpoints: int
