# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from pydantic import Field

from app.models.base import ApiModel


class Topic(ApiModel):
    name: str
    arn: str
    configuration: Optional[dict] = Field(
        default=None,
        description="Topic attributes that can be configured via the SNS API",
    )


class TopicCreate(ApiModel):
    name: str = Field(..., min_length=1)
    configuration: Optional[dict] = None


class TopicPolicy(ApiModel):
    policy: dict = Field(default_factory=dict)


class TopicConfiguration(ApiModel):
    configuration: dict = Field(default_factory=dict)
