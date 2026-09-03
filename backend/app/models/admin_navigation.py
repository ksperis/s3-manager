# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from pydantic import Field

from app.models.base import ApiModel


class AdminPendingRequestCounts(ApiModel):
    identity_link_requests: int = Field(ge=0)
    portal_requests: int = Field(ge=0)
