# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class _StrictTopicModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Topic(_StrictTopicModel):
    name: str
    arn: str
    owner: Optional[str] = None
    is_ceph: bool = Field(default=False, description="Topic was listed through the Ceph RGW-specific path")
    configuration: Optional[dict] = Field(
        default=None,
        description="Topic attributes that can be configured via the SNS API",
    )


class TopicCreate(_StrictTopicModel):
    name: str = Field(..., min_length=1)
    configuration: Optional[dict] = None


class TopicPolicy(_StrictTopicModel):
    policy: dict = Field(default_factory=dict)


class TopicConfiguration(_StrictTopicModel):
    configuration: dict = Field(default_factory=dict)
