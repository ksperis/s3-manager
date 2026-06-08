# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Literal, Optional
from pydantic import BaseModel, Field


class Policy(BaseModel):
    name: str
    arn: str
    path: Optional[str] = None
    default_version_id: Optional[str] = None
    document: Optional[dict] = None


class PolicyCreate(BaseModel):
    name: str
    document: dict


class InlinePolicy(BaseModel):
    name: str
    document: dict


class InlinePolicyInventoryItem(BaseModel):
    entity_type: Literal["user", "group", "role"]
    entity_name: str
    policies: list[InlinePolicy] = Field(default_factory=list)
    error: Optional[str] = None
