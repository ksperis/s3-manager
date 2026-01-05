# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional, Union

from pydantic import BaseModel

from app.models.policy import InlinePolicy

class IAMUser(BaseModel):
    name: str
    user_id: Optional[str] = None
    arn: Optional[str] = None
    groups: Optional[list[str]] = None
    policies: Optional[list[str]] = None
    inline_policies: Optional[list[str]] = None
    has_keys: bool = False


class AccessKey(BaseModel):
    access_key_id: str
    status: Optional[str] = None
    created_at: Optional[str] = None
    secret_access_key: Optional[str] = None


class AccessKeyStatusChange(BaseModel):
    active: bool


class IAMUserCreate(BaseModel):
    name: str
    create_key: bool = False
    groups: Optional[list[str]] = None
    policies: Optional[list[str]] = None
    inline_policies: Optional[list[InlinePolicy]] = None


class IAMUserWithKey(IAMUser):
    access_key: Optional[AccessKey] = None


class IAMGroup(BaseModel):
    name: str
    arn: Optional[str] = None
    policies: Optional[list[str]] = None


class IAMGroupCreate(BaseModel):
    name: str
    inline_policies: Optional[list[InlinePolicy]] = None


class IAMRole(BaseModel):
    name: str
    arn: Optional[str] = None
    path: Optional[str] = None
    policies: Optional[list[str]] = None
    assume_role_policy_document: Optional[Union[dict, str]] = None


class IAMRoleCreate(BaseModel):
    name: str
    path: Optional[str] = None
    assume_role_policy_document: Optional[Union[dict, str]] = None
    inline_policies: Optional[list[InlinePolicy]] = None


class IAMRoleUpdate(BaseModel):
    path: Optional[str] = None
    assume_role_policy_document: Optional[Union[dict, str]] = None
