# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional
from app.models.base import ApiModel


class Policy(ApiModel):
    name: str
    arn: str
    path: Optional[str] = None
    default_version_id: Optional[str] = None
    document: Optional[dict] = None


class PolicyCreate(ApiModel):
    name: str
    document: dict


class InlinePolicy(ApiModel):
    name: str
    document: dict
