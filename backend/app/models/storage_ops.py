# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Literal, Optional

from pydantic import BaseModel

from app.models.ceph_admin import CephAdminBucketSummary
from app.models.pagination import PaginatedResponse


StorageOpsContextKind = Literal["account", "connection"]


class StorageOpsBucketSummary(CephAdminBucketSummary):
    context_id: str
    context_name: str
    context_kind: StorageOpsContextKind
    endpoint_name: Optional[str] = None
    bucket_name: Optional[str] = None


class PaginatedStorageOpsBucketsResponse(PaginatedResponse):
    items: list[StorageOpsBucketSummary]
