# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional
from pydantic import BaseModel


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
