# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional, Union

from app.models.base import ApiModel
from app.models.policy import InlinePolicy

class IAMUser(ApiModel):
    name: str
    user_id: Optional[str] = None
    arn: Optional[str] = None
    groups: Optional[list[str]] = None
    policies: Optional[list[str]] = None
    inline_policies: Optional[list[str]] = None
    has_keys: bool = False
    is_private_access_managed: bool = False
    managed_connection_id: Optional[int] = None


class AccessKey(ApiModel):
    access_key_id: str
    status: Optional[str] = None
    created_at: Optional[str] = None
    secret_access_key: Optional[str] = None
    is_private_access_managed: bool = False
    managed_connection_id: Optional[int] = None


class AccessKeyStatusChange(ApiModel):
    active: bool


class IAMUserCreate(ApiModel):
    name: str
    create_key: bool = False
    groups: Optional[list[str]] = None
    policies: Optional[list[str]] = None
    inline_policies: Optional[list[InlinePolicy]] = None


class IAMUserWithKey(IAMUser):
    access_key: Optional[AccessKey] = None


class IAMGroup(ApiModel):
    name: str
    arn: Optional[str] = None
    policies: Optional[list[str]] = None


class IAMGroupCreate(ApiModel):
    name: str
    inline_policies: Optional[list[InlinePolicy]] = None


class IAMRole(ApiModel):
    name: str
    arn: Optional[str] = None
    path: Optional[str] = None
    policies: Optional[list[str]] = None
    assume_role_policy_document: Optional[Union[dict, str]] = None


class IAMRoleCreate(ApiModel):
    name: str
    path: Optional[str] = None
    assume_role_policy_document: Optional[Union[dict, str]] = None
    inline_policies: Optional[list[InlinePolicy]] = None


class IAMRoleUpdate(ApiModel):
    path: Optional[str] = None
    assume_role_policy_document: Optional[Union[dict, str]] = None
