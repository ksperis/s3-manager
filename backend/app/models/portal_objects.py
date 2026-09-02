# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal storage-object API contracts."""

from datetime import datetime
from typing import Literal, Optional

from app.models.base import ApiModel


PortalStorageObjectPreviewType = Literal["text", "image", "unavailable"]


class PortalStorageObjectDeleteResponse(ApiModel):
    key: str
    message: str


class PortalStorageObjectDetail(ApiModel):
    key: str
    name: str
    size: Optional[int] = None
    last_modified: Optional[datetime] = None
    content_type: Optional[str] = None
    storage_class: Optional[str] = None
    encryption: Optional[str] = None
    preview_type: PortalStorageObjectPreviewType = "unavailable"
    preview_text: Optional[str] = None
    preview_unavailable_reason: Optional[str] = None
