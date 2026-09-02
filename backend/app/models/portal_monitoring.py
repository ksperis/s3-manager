# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal activity and alert API contracts."""

from datetime import datetime
from typing import Literal, Optional

from app.models.base import ApiModel


PortalAlertTone = Literal["info", "warning", "danger"]


class PortalActivityItem(ApiModel):
    id: int
    created_at: datetime
    actor: str
    action: str
    target: str
    storage_space_id: Optional[str] = None
    storage_space_name: Optional[str] = None
    ip_address: Optional[str] = None
    status: str = "success"


class PortalAlert(ApiModel):
    id: str
    tone: PortalAlertTone
    title: str
    description: str
    severity_label: str
    storage_space_id: Optional[str] = None
    created_at: Optional[datetime] = None
