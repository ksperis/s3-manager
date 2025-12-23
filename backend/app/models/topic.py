# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from pydantic import BaseModel, Field


class Topic(BaseModel):
    name: str
    arn: str
    owner: Optional[str] = None
    subscriptions_confirmed: Optional[int] = Field(default=None, description="Number of confirmed subscriptions")
    subscriptions_pending: Optional[int] = Field(default=None, description="Number of pending subscriptions")
    configuration: Optional[dict] = Field(
        default=None,
        description="Topic attributes that can be configured via the SNS API",
    )


class TopicCreate(BaseModel):
    name: str = Field(..., min_length=1)
    configuration: Optional[dict] = None


class TopicPolicy(BaseModel):
    policy: dict = Field(default_factory=dict)


class TopicConfiguration(BaseModel):
    configuration: dict = Field(default_factory=dict)
