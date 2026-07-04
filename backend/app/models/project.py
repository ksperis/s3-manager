# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.db import AccountRole
from app.models.pagination import PaginatedResponse


PROJECT_PORTAL_ROLES = {AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value}


def validate_project_role(value: Optional[str]) -> str:
    normalized = (value or "").strip().lower()
    if normalized not in PROJECT_PORTAL_ROLES:
        raise ValueError("Project role must be portal_user or portal_manager")
    return normalized


class ProjectAccountLinkInput(BaseModel):
    account_id: int
    display_name: Optional[str] = Field(default=None, max_length=120)
    sort_order: int = 0

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = " ".join(value.split())
        return cleaned or None


class ProjectUserLinkInput(BaseModel):
    user_id: int
    account_role: str

    @field_validator("account_role")
    @classmethod
    def normalize_account_role(cls, value: Optional[str]) -> str:
        return validate_project_role(value)


class ProjectGroupLinkInput(BaseModel):
    group_id: int
    account_role: str

    @field_validator("account_role")
    @classmethod
    def normalize_account_role(cls, value: Optional[str]) -> str:
        return validate_project_role(value)


class ProjectAccountLink(BaseModel):
    account_id: int
    account_name: str
    display_name: str
    sort_order: int = 0
    rgw_account_id: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    storage_endpoint_name: Optional[str] = None
    storage_endpoint_url: Optional[str] = None
    storage_endpoint_zonegroup: Optional[str] = None


class ProjectUserLink(BaseModel):
    user_id: int
    user_email: str
    account_role: str


class ProjectGroupLink(BaseModel):
    group_id: int
    group_name: str
    account_role: str


class ProjectBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: Optional[str] = Field(default=None, max_length=4000)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Project name is required")
        return cleaned

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class ProjectCreate(ProjectBase):
    account_links: list[ProjectAccountLinkInput] = Field(default_factory=list)
    user_links: list[ProjectUserLinkInput] = Field(default_factory=list)
    group_links: list[ProjectGroupLinkInput] = Field(default_factory=list)


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    description: Optional[str] = Field(default=None, max_length=4000)
    account_links: Optional[list[ProjectAccountLinkInput]] = None
    user_links: Optional[list[ProjectUserLinkInput]] = None
    group_links: Optional[list[ProjectGroupLinkInput]] = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Project name is required")
        return cleaned

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class Project(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    account_links: list[ProjectAccountLink] = Field(default_factory=list)
    user_links: list[ProjectUserLink] = Field(default_factory=list)
    group_links: list[ProjectGroupLink] = Field(default_factory=list)
    account_count: int = 0
    user_count: int = 0
    group_count: int = 0
    created_at: datetime
    updated_at: datetime


class ProjectSummary(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    account_count: int = 0
    user_count: int = 0
    group_count: int = 0


class PaginatedProjectsResponse(PaginatedResponse):
    items: list[Project]


class ProjectProvisionAccountsRequest(BaseModel):
    endpoint_ids: list[int] = Field(min_length=1)
    base_name: Optional[str] = Field(default=None, max_length=80)
    email: Optional[str] = Field(default=None, max_length=320)


class ProjectProvisionAccountsResponse(BaseModel):
    project: Project
    created_account_ids: list[int] = Field(default_factory=list)
    reused_endpoint_ids: list[int] = Field(default_factory=list)


class PortalProjectAccount(BaseModel):
    account_id: int
    account_name: str
    display_name: str
    rgw_account_id: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    storage_endpoint_name: Optional[str] = None
    storage_endpoint_url: Optional[str] = None
    storage_endpoint_zonegroup: Optional[str] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_objects: Optional[int] = None


class PortalProject(BaseModel):
    id: str
    db_id: int
    name: str
    description: Optional[str] = None
    account_role: str
    accounts: list[PortalProjectAccount] = Field(default_factory=list)
