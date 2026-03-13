# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr
from app.models.pagination import PaginatedResponse

UiLanguage = Literal["en", "fr", "de"]
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


class AccountMembership(BaseModel):
    account_id: int
    account_role: Optional[str] = None
    account_admin: Optional[bool] = None


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
    ui_language: Optional[UiLanguage] = None
    quota_alerts_enabled: bool = True
    quota_alerts_global_watch: bool = False
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


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    is_root: Optional[bool] = None
    can_access_ceph_admin: Optional[bool] = None
    can_access_storage_ops: Optional[bool] = None
    s3_user_ids: Optional[list[int]] = None
    s3_connection_ids: Optional[list[int]] = None


class UserSelfUpdate(BaseModel):
    full_name: Optional[str] = None
    ui_language: Optional[UiLanguage] = None
    quota_alerts_enabled: Optional[bool] = None
    quota_alerts_global_watch: Optional[bool] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


class UserAssignS3Account(BaseModel):
    account_id: int
    account_root: Optional[bool] = None
    account_role: Optional[str] = None
    account_admin: Optional[bool] = None


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
    ui_language: Optional[UiLanguage] = None
    quota_alerts_enabled: bool = True
    quota_alerts_global_watch: bool = False
    accounts: list[int] = []
    account_links: list[AccountMembership] = []
    s3_users: list[int] = []
    s3_user_details: list[LinkedS3User] = []
    s3_connections: list[int] = []
    s3_connection_details: list[LinkedS3Connection] = []
    auth_provider: Optional[str] = None
    last_login_at: Optional[datetime] = None


class PaginatedUsersResponse(PaginatedResponse):
    items: list[UserOut]
