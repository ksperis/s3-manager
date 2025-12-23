# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class S3Object(BaseModel):
    key: str
    size: int
    last_modified: Optional[datetime] = None
    storage_class: Optional[str] = None


class ListObjectsResponse(BaseModel):
    prefix: str
    objects: List[S3Object]
    prefixes: List[str]
    is_truncated: bool = False
    next_continuation_token: Optional[str] = None
