# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import List, Optional

from app.models.base import ApiModel


class S3Object(ApiModel):
    key: str
    size: int
    last_modified: Optional[datetime] = None
    storage_class: Optional[str] = None


class ListObjectsResponse(ApiModel):
    prefix: str
    objects: List[S3Object]
    prefixes: List[str]
    is_truncated: bool = False
    next_continuation_token: Optional[str] = None
