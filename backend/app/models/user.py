# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator
from app.models.pagination import PaginatedResponse

UiLanguage = Literal["en", "fr", "de"]
UiThemePreference = Literal["light", "dark"]
MIN_PASSWORD_LENGTH = 12
PASSWORD_POLICY_ERROR = f"Password must be at least {MIN_PASSWORD_LENGTH} characters long"


def validate_password_policy(password: str) -> None:
    value = str(password or "")
    if len(value) < MIN_PASSWORD_LENGTH or not value.strip():
        raise ValueError(PASSWORD_POLICY_ERROR)


class LinkedS3User(BaseModel):
    id: int
    name: str


class LinkedS3Connection(BaseModel):
    id: int
    name: str
    access_manager: Optional[bool] = None
    access_browser: Optional[bool] = None


class LinkedUiGroup(BaseModel):
    id: int
    name: str


class LinkedPortalProject(BaseModel):
    id: int
    name: str
    account_role: str


class AccountMembership(BaseModel):
    account_id: int
    account_admin: Optional[bool] = None
    account_role: Optional[str] = None


class ManagerToolAccess(BaseModel):
    bucket_compare: bool = False
    bucket_integrity_check: bool = False
    bucket_migration: bool = False
    feature_rules: bool = False
    bucket_quota: bool = False
    bucket_purge: bool = False
    ceph_s3_user_keys: bool = False


class UiPreferences(BaseModel):
    theme: Optional[UiThemePreference] = None
    selected_portal_account_id: Optional[str] = None

    @field_validator("selected_portal_account_id")
    @classmethod
    def normalize_selected_portal_account_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None


class UserSummary(BaseModel):
    id: int
    email: EmailStr
    role: Optional[str] = None
    iam_username: Optional[str] = None


class User(BaseModel):
    id: int
    email: EmailStr
    full_name: Optional[str] = None
    display_name: Optional[str] = None
    picture_url: Optional[str] = None
    is_active: bool = True
    is_admin: bool = False
    is_root: bool = False
    can_access_ceph_admin: bool = False
    can_access_storage_ops: bool = False
    manager_tool_access: ManagerToolAccess = Field(default_factory=ManagerToolAccess)
    browser_advanced_features_enabled: bool = False
    ui_language: Optional[UiLanguage] = None
    quota_alerts_enabled: bool = True
    quota_alerts_global_watch: bool = False
    ui_preferences: UiPreferences = Field(default_factory=UiPreferences)
    auth_provider: Optional[str] = None
    last_login_at: Optional[datetime] = None


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_root: bool = False
    can_access_ceph_admin: bool = False
    can_access_storage_ops: bool = False
    manager_tool_access: Optional[ManagerToolAccess] = None
    browser_advanced_features_enabled: bool = False
    group_ids: Optional[list[int]] = None


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    is_root: Optional[bool] = None
    can_access_ceph_admin: Optional[bool] = None
    can_access_storage_ops: Optional[bool] = None
    manager_tool_access: Optional[ManagerToolAccess] = None
    browser_advanced_features_enabled: Optional[bool] = None
    s3_user_ids: Optional[list[int]] = None
    s3_connection_ids: Optional[list[int]] = None
    group_ids: Optional[list[int]] = None


class UserSelfUpdate(BaseModel):
    full_name: Optional[str] = None
    ui_language: Optional[UiLanguage] = None
    quota_alerts_enabled: Optional[bool] = None
    quota_alerts_global_watch: Optional[bool] = None
    ui_preferences: Optional[UiPreferences] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


class UserAssignS3Account(BaseModel):
    account_id: int
    account_root: Optional[bool] = None
    account_admin: Optional[bool] = None
    account_role: Optional[str] = None


class EffectiveUserAccess(BaseModel):
    can_access_ceph_admin: bool = False
    can_access_storage_ops: bool = False
    manager_tool_access: ManagerToolAccess = Field(default_factory=ManagerToolAccess)
    browser_advanced_features_enabled: bool = False
    accounts: list[int] = []
    account_links: list[AccountMembership] = []
    portal_projects: list[LinkedPortalProject] = []
    s3_users: list[int] = []
    s3_user_details: list[LinkedS3User] = []
    s3_connections: list[int] = []
    s3_connection_details: list[LinkedS3Connection] = []


class UserOut(BaseModel):
    id: int
    email: str
    full_name: Optional[str] = None
    display_name: Optional[str] = None
    picture_url: Optional[str] = None
    is_active: bool = True
    is_admin: bool = False
    role: Optional[str] = None
    is_root: bool = False
    can_access_ceph_admin: bool = False
    can_access_storage_ops: bool = False
    manager_tool_access: ManagerToolAccess = Field(default_factory=ManagerToolAccess)
    browser_advanced_features_enabled: bool = False
    ui_language: Optional[UiLanguage] = None
    quota_alerts_enabled: bool = True
    quota_alerts_global_watch: bool = False
    ui_preferences: UiPreferences = Field(default_factory=UiPreferences)
    accounts: list[int] = []
    account_links: list[AccountMembership] = []
    group_ids: list[int] = []
    group_details: list[LinkedUiGroup] = []
    s3_users: list[int] = []
    s3_user_details: list[LinkedS3User] = []
    s3_connections: list[int] = []
    s3_connection_details: list[LinkedS3Connection] = []
    effective_access: Optional[EffectiveUserAccess] = None
    auth_provider: Optional[str] = None
    last_login_at: Optional[datetime] = None


class PaginatedUsersResponse(PaginatedResponse):
    items: list[UserOut]
