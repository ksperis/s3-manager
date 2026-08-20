# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional

from pydantic import Field

from app.models.base import ApiModel


class S3Object(ApiModel):
    key: str
    size: int
    last_modified: Optional[datetime] = None
    storage_class: Optional[str] = None


class ListObjectsResponse(ApiModel):
    prefix: str
    objects: list[S3Object]
    prefixes: list[str]
    is_truncated: bool = False
    next_continuation_token: Optional[str] = None


class CreateFolderPayload(ApiModel):
    prefix: str = Field(..., description="Folder prefix, trailing slash optional")


class ObjectUploadResponse(ApiModel):
    key: str
    message: str
