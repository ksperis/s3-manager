# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.core.config import get_settings

_settings = get_settings()


def _default_portal_cors_origins() -> list[str]:
    return list(_settings.cors_origins or [])


def _default_portal_manager_actions() -> list[str]:
    return ["iam:*", "s3:*"]


def _default_portal_user_actions() -> list[str]:
    return ["s3:ListAllMyBuckets"]


def _default_portal_bucket_access_actions() -> list[str]:
    return [
        "s3:GetBucketLocation",
        "s3:ListBucket",
        "s3:ListBucketVersions",
        "s3:ListBucketMultipartUploads",
        "s3:GetObject",
        "s3:GetObjectVersion",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts",
        "s3:GetBucketVersioning",
        "s3:GetBucketCORS",
        "s3:GetBucketAcl",
        "s3:GetBucketPolicy",
        "s3:GetLifecycleConfiguration",
    ]


class PortalIAMPolicySettings(BaseModel):
    actions: list[str] = Field(default_factory=list)
    advanced_policy: Optional[dict] = None

    @field_validator("actions", mode="before")
    @classmethod
    def normalize_actions(cls, value: Optional[list[str]]) -> list[str]:
        if not value:
            return []
        if isinstance(value, str):
            return [entry.strip() for entry in value.split(",") if entry.strip()]
        return [entry for entry in value if isinstance(entry, str) and entry.strip()]


class PortalBucketDefaults(BaseModel):
    versioning: bool = True
    enable_cors: bool = True
    enable_lifecycle: bool = True
    cors_allowed_origins: list[str] = Field(default_factory=_default_portal_cors_origins)


class PortalSettings(BaseModel):
    allow_portal_key: bool = False
    allow_portal_user_bucket_create: bool = False
    iam_group_manager_policy: PortalIAMPolicySettings = Field(
        default_factory=lambda: PortalIAMPolicySettings(actions=_default_portal_manager_actions())
    )
    iam_group_user_policy: PortalIAMPolicySettings = Field(
        default_factory=lambda: PortalIAMPolicySettings(actions=_default_portal_user_actions())
    )
    bucket_access_policy: PortalIAMPolicySettings = Field(
        default_factory=lambda: PortalIAMPolicySettings(actions=_default_portal_bucket_access_actions())
    )
    bucket_defaults: PortalBucketDefaults = Field(default_factory=PortalBucketDefaults)


class ManagerSettings(BaseModel):
    allow_manager_user_usage_stats: bool = True


class AppSettings(BaseModel):
    portal: PortalSettings = PortalSettings()
    manager: ManagerSettings = ManagerSettings()
