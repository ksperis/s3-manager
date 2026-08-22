# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.models.base import ApiModel
from app.models.tagging import TagDefinitionSummary
from app.utils.tagging import DEFAULT_TAG_COLOR_KEY, normalize_tag_color_key, normalize_tag_label


BucketUiTagVisibility = Literal["private", "shared"]


class BucketUiTagDefinitionSummary(TagDefinitionSummary):
    scope: Literal["standard"] = "standard"
    visibility: BucketUiTagVisibility


class BucketUiTagPhysicalTarget(ApiModel):
    endpoint_id: int
    tenant: str = ""
    name: str


class BucketUiTagCatalogResponse(ApiModel):
    definitions: list[BucketUiTagDefinitionSummary] = Field(default_factory=list)


class BucketUiTagOrphanSummary(ApiModel):
    target: BucketUiTagPhysicalTarget
    tags: list[BucketUiTagDefinitionSummary] = Field(default_factory=list)


class BucketUiTagOrphansResponse(ApiModel):
    orphans: list[BucketUiTagOrphanSummary] = Field(default_factory=list)


class CephAdminBucketUiTagTarget(ApiModel):
    name: str
    tenant: str = ""

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: object) -> str:
        return normalize_tag_label(value)

    @field_validator("tenant", mode="before")
    @classmethod
    def normalize_tenant(cls, value: object) -> str:
        return str(value or "").strip()


class StorageOpsBucketUiTagTarget(ApiModel):
    context_id: str | None = None
    endpoint_id: int | None = Field(default=None, ge=1)
    tenant: str = ""
    name: str

    @field_validator("name", mode="before")
    @classmethod
    def normalize_required_text(cls, value: object) -> str:
        return normalize_tag_label(value)

    @field_validator("context_id", mode="before")
    @classmethod
    def normalize_context_id(cls, value: object) -> str | None:
        cleaned = str(value or "").strip()
        return cleaned or None

    @field_validator("tenant", mode="before")
    @classmethod
    def normalize_storage_tenant(cls, value: object) -> str:
        return str(value or "").strip()

    @model_validator(mode="after")
    def validate_reference(self):
        if bool(self.context_id) == bool(self.endpoint_id):
            raise ValueError("target must provide either context_id or endpoint_id.")
        return self


class _BucketUiTagCreateBase(ApiModel):
    label: str
    color_key: str = DEFAULT_TAG_COLOR_KEY

    @field_validator("label", mode="before")
    @classmethod
    def normalize_label(cls, value: object) -> str:
        return normalize_tag_label(value)

    @field_validator("color_key", mode="before")
    @classmethod
    def normalize_color(cls, value: object) -> str:
        return normalize_tag_color_key(value)


class CephAdminBucketUiTagCreate(_BucketUiTagCreateBase):
    visibility: BucketUiTagVisibility = "private"


class StorageOpsBucketUiTagCreate(_BucketUiTagCreateBase):
    pass


class _BucketUiTagPatchBase(ApiModel):
    add_tag_ids: list[int] = Field(default_factory=list)
    remove_tag_ids: list[int] = Field(default_factory=list)
    remove_all: bool = False
    require_absent: bool = False

    @field_validator("add_tag_ids", "remove_tag_ids", mode="after")
    @classmethod
    def normalize_ids(cls, value: list[int]) -> list[int]:
        result: list[int] = []
        seen: set[int] = set()
        for raw in value:
            identifier = int(raw)
            if identifier <= 0:
                raise ValueError("tag identifiers must be positive integers.")
            if identifier not in seen:
                seen.add(identifier)
                result.append(identifier)
        return result

    @model_validator(mode="after")
    def validate_operation(self):
        if self.require_absent and not self.remove_all:
            raise ValueError("require_absent is only valid with remove_all.")
        if self.remove_all and (self.add_tag_ids or getattr(self, "create_tags", [])):
            raise ValueError("remove_all cannot be combined with additions.")
        return self


class CephAdminBucketUiTagPatchRequest(_BucketUiTagPatchBase):
    targets: list[CephAdminBucketUiTagTarget] = Field(min_length=1, max_length=200)
    create_tags: list[CephAdminBucketUiTagCreate] = Field(default_factory=list)


class StorageOpsBucketUiTagPatchRequest(_BucketUiTagPatchBase):
    targets: list[StorageOpsBucketUiTagTarget] = Field(min_length=1, max_length=200)
    create_tags: list[StorageOpsBucketUiTagCreate] = Field(default_factory=list)
