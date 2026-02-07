# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional, Literal

from pydantic import BaseModel


class ExecutionContextCapabilities(BaseModel):
    iam_capable: bool
    sts_capable: bool
    admin_api_capable: bool


class ExecutionContext(BaseModel):
    kind: Literal["account", "connection", "legacy_user"]
    id: str
    display_name: str
    hidden: bool = False
    rgw_account_id: Optional[str] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_objects: Optional[int] = None
    endpoint_id: Optional[int] = None
    endpoint_name: Optional[str] = None
    endpoint_url: Optional[str] = None
    storage_endpoint_capabilities: Optional[dict[str, bool]] = None
    capabilities: ExecutionContextCapabilities
