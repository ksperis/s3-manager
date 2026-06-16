# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Any, Optional

from pydantic import BaseModel, Field


class TopicSubscription(BaseModel):
    name: str
    bucket: Optional[str] = None
    endpoint_address: Optional[str] = None
    endpoint_topic: Optional[str] = None
    endpoint_args: dict[str, Any] = Field(default_factory=dict)
    persistent: Optional[bool] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class Topic(BaseModel):
    name: str
    arn: str
    owner: Optional[str] = None
    is_ceph: bool = Field(default=False, description="Topic was listed through the Ceph RGW-specific path")
    subscriptions_confirmed: Optional[int] = Field(default=None, description="Number of confirmed subscriptions")
    subscriptions_pending: Optional[int] = Field(default=None, description="Number of pending subscriptions")
    subscriptions: list[TopicSubscription] = Field(
        default_factory=list,
        description="Ceph RGW notification bindings reconstructed from ListTopics",
    )
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
