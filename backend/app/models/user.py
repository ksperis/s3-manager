# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr
from app.models.pagination import PaginatedResponse


class LinkedS3User(BaseModel):
    id: int
    name: str


class LinkedS3Connection(BaseModel):
    id: int
    name: str


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
    auth_provider: Optional[str] = None
    last_login_at: Optional[datetime] = None


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_root: bool = False


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    is_root: Optional[bool] = None
    s3_user_ids: Optional[list[int]] = None
    s3_connection_ids: Optional[list[int]] = None


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
