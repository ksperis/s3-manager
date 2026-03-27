# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.models.pagination import PaginatedResponse
from app.models.tagging import TagDefinitionInput, TagDefinitionSummary, validate_tag_definition_list


class S3User(BaseModel):
    id: int
    name: str
    rgw_user_uid: str
    email: Optional[str] = None
    created_at: Optional[datetime] = None
    user_ids: list[int] = []
    quota_max_size_gb: Optional[float] = None
    quota_max_objects: Optional[int] = None
    storage_endpoint_id: Optional[int] = None
    storage_endpoint_name: Optional[str] = None
    storage_endpoint_url: Optional[str] = None
    bucket_count: Optional[int] = None
    tags: list[TagDefinitionSummary] = Field(default_factory=list)


class S3UserCreate(BaseModel):
    name: str
    uid: Optional[str] = None
    email: Optional[str] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[str] = None
    quota_max_objects: Optional[int] = None
    storage_endpoint_id: Optional[int] = None
    tags: list[TagDefinitionInput] = Field(default_factory=list)

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: object) -> list[dict[str, str]]:
        return validate_tag_definition_list(value, allow_none=False) or []


class S3UserImport(BaseModel):
    uid: str
    name: Optional[str] = None
    email: Optional[str] = None
    storage_endpoint_id: Optional[int] = None


class S3UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    user_ids: Optional[list[int]] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[str] = None
    quota_max_objects: Optional[int] = None
    storage_endpoint_id: Optional[int] = None
    tags: Optional[list[TagDefinitionInput]] = None

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_optional_tags(cls, value: object) -> Optional[list[dict[str, str]]]:
        return validate_tag_definition_list(value, allow_none=True)


class S3UserAccessKey(BaseModel):
    access_key_id: str
    status: Optional[str] = None
    created_at: Optional[datetime] = None
    is_ui_managed: bool = False
    is_active: Optional[bool] = None


class S3UserGeneratedKey(BaseModel):
    access_key_id: str
    secret_access_key: str
    created_at: Optional[datetime] = None


class S3UserAccessKeyStatusChange(BaseModel):
    active: bool


class S3UserSummary(BaseModel):
    id: int
    name: str
    rgw_user_uid: str
    storage_endpoint_id: Optional[int] = None
    storage_endpoint_name: Optional[str] = None
    storage_endpoint_url: Optional[str] = None
    tags: list[TagDefinitionSummary] = Field(default_factory=list)


class PaginatedS3UsersResponse(PaginatedResponse):
    items: list[S3User]
