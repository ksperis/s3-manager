# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, EmailStr, Field, field_validator


PortalAdminRequestType = Literal["portal_user_access", "portal_user_removal", "account_quota_change"]
PortalAdminRequestStatus = Literal["pending", "processing", "approved", "rejected", "failed"]
PortalQuotaDirection = Literal["increase", "decrease"]
PortalQuotaUnit = Literal["MiB", "GiB", "TiB"]


def _normalize_optional_request_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = " ".join(value.split())
    return cleaned or None


class PortalUserAccessRequestCreate(BaseModel):
    request_type: Literal["portal_user_access"]
    target_name: str = Field(min_length=1, max_length=120)
    target_email: EmailStr
    reason: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("target_name")
    @classmethod
    def _normalize_target_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Name is required")
        return cleaned

    _normalize_reason = field_validator("reason")(_normalize_optional_request_text)


class PortalUserRemovalRequestCreate(BaseModel):
    request_type: Literal["portal_user_removal"]
    target_email: EmailStr
    target_name: Optional[str] = Field(default=None, max_length=120)
    reason: Optional[str] = Field(default=None, max_length=2000)

    _normalize_optional_text = field_validator("target_name", "reason")(_normalize_optional_request_text)


class PortalAccountQuotaChangeRequestCreate(BaseModel):
    request_type: Literal["account_quota_change"]
    direction: PortalQuotaDirection
    target_quota_value: float = Field(gt=0)
    target_quota_unit: PortalQuotaUnit = "GiB"
    reason: Optional[str] = Field(default=None, max_length=2000)

    _normalize_reason = field_validator("reason")(_normalize_optional_request_text)


PortalAdminRequestCreate = Annotated[
    Union[PortalUserAccessRequestCreate, PortalUserRemovalRequestCreate, PortalAccountQuotaChangeRequestCreate],
    Field(discriminator="request_type"),
]


class PortalAdminRequestMessageCreate(BaseModel):
    message: str = Field(min_length=1, max_length=2000)

    @field_validator("message")
    @classmethod
    def _normalize_message(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Message is required")
        return cleaned


class PortalAdminRequestDecision(BaseModel):
    message: Optional[str] = Field(default=None, max_length=2000)

    _normalize_optional_message = field_validator("message")(_normalize_optional_request_text)


class PortalAdminRequestMessageOut(BaseModel):
    id: int
    author_user_id: Optional[int] = None
    author_email: str
    author_role: Optional[str] = None
    message: str
    created_at: datetime


class PortalAdminRequestOut(BaseModel):
    id: int
    account_id: int
    account_name: Optional[str] = None
    request_type: PortalAdminRequestType
    status: PortalAdminRequestStatus
    payload: dict[str, Any]
    result: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None
    requester_user_id: Optional[int] = None
    requester_email: str
    decided_by_user_id: Optional[int] = None
    decided_by_email: Optional[str] = None
    decided_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    messages: list[PortalAdminRequestMessageOut] = Field(default_factory=list)
