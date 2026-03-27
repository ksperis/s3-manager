# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.utils.tagging import (
    DEFAULT_TAG_COLOR_KEY,
    DEFAULT_TAG_SCOPE,
    TAG_DOMAIN_ADMIN_MANAGED,
    TAG_DOMAIN_ENDPOINT,
    normalize_tag_color_key,
    normalize_tag_items_input,
    normalize_tag_label,
    normalize_tag_scope,
)


class TagDefinitionSummary(BaseModel):
    id: int
    label: str
    color_key: str = DEFAULT_TAG_COLOR_KEY
    scope: Literal["administrative", "standard"] = DEFAULT_TAG_SCOPE


class TagDefinitionInput(BaseModel):
    label: str
    color_key: str = DEFAULT_TAG_COLOR_KEY
    scope: Literal["administrative", "standard"] = DEFAULT_TAG_SCOPE

    @field_validator("label", mode="before")
    @classmethod
    def normalize_label(cls, value: object) -> str:
        return normalize_tag_label(value)

    @field_validator("color_key", mode="before")
    @classmethod
    def normalize_color_key(cls, value: object) -> str:
        return normalize_tag_color_key(value)

    @field_validator("scope", mode="before")
    @classmethod
    def normalize_scope(cls, value: object) -> str:
        return normalize_tag_scope(value)


class TagDefinitionListResponse(BaseModel):
    items: list[TagDefinitionSummary] = Field(default_factory=list)


class TagCatalogDomainQuery(BaseModel):
    domain: Literal[TAG_DOMAIN_ADMIN_MANAGED, TAG_DOMAIN_ENDPOINT]


def validate_tag_definition_list(value: object, *, allow_none: bool = False) -> Optional[list[dict[str, str]]]:
    return normalize_tag_items_input(value, allow_none=allow_none)
