# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ManagerActivityEntry(BaseModel):
    id: int
    created_at: datetime
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    account_id: Optional[int] = None
    account_name: Optional[str] = None
    status: str
    user_email: str
