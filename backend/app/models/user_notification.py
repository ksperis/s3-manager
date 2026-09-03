# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import Field, field_validator, model_validator

from app.models.base import ApiModel

NotificationSeverity = Literal["info", "warning", "error"]


class UserNotificationOut(ApiModel):
    id: int
    type: str
    severity: NotificationSeverity
    title: str
    message: str
    subject_type: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    s3_account_id: Optional[int] = None
    s3_user_id: Optional[int] = None
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    read_at: Optional[datetime] = None


class UserNotificationsResponse(ApiModel):
    items: list[UserNotificationOut]
    unread_count: int = 0


class MarkUserNotificationsReadRequest(ApiModel):
    notification_ids: Optional[list[int]] = None
    all: bool = False

    @field_validator("notification_ids")
    @classmethod
    def normalize_notification_ids(cls, value: Optional[list[int]]) -> Optional[list[int]]:
        if value is None:
            return None
        seen: set[int] = set()
        normalized: list[int] = []
        for item in value:
            item_int = int(item)
            if item_int <= 0 or item_int in seen:
                continue
            seen.add(item_int)
            normalized.append(item_int)
        return normalized

    @model_validator(mode="after")
    def validate_selection(self) -> "MarkUserNotificationsReadRequest":
        if not self.all and not self.notification_ids:
            raise ValueError("notification_ids or all=true is required")
        return self


class MarkUserNotificationsReadResponse(ApiModel):
    updated_count: int = 0
    unread_count: int = 0


class DeleteUserNotificationsResponse(ApiModel):
    deleted_count: int = 0
    unread_count: int = 0
