# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import datetime
from typing import Any, ClassVar, Literal, Optional, Self

from pydantic import Field, model_validator

from app.models.base import ApiModel
from app.models.pagination import PaginatedResponse
from app.models.tagging import (
    OptionalTagDefinitionList,
    RequiredTagDefinitionList,
    TagDefinitionSummary,
)

CredentialOwnerType = Literal["iam_user", "account_user", "s3_user"]
S3_CONNECTION_CUSTOM_ENDPOINT_FIELDS = {
    "endpoint_url",
    "region",
    "force_path_style",
    "verify_tls",
    "provider_hint",
}
S3_CONNECTION_ENDPOINT_FIELDS = S3_CONNECTION_CUSTOM_ENDPOINT_FIELDS | {
    "storage_endpoint_id"
}


class _CanonicalEndpointPayload(ApiModel):
    endpoint_conflict_scope: ClassVar[str]

    @model_validator(mode="after")
    def ensure_canonical_endpoint(self) -> Self:
        if getattr(self, "storage_endpoint_id", None) is None:
            return self
        conflicting = sorted(
            S3_CONNECTION_CUSTOM_ENDPOINT_FIELDS & self.model_fields_set
        )
        if conflicting:
            raise ValueError(
                f"{self.endpoint_conflict_scope} custom endpoint fields cannot be combined "
                "with storage_endpoint_id"
            )
        return self


class S3Connection(ApiModel):
    id: int
    name: str
    provider_hint: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    created_by_user_id: int
    is_shared: bool = False
    is_active: bool = True
    access_manager: bool = False
    access_browser: bool = True
    server_managed: bool = False
    managed_access_state: Optional[str] = None
    credential_owner_type: Optional[CredentialOwnerType] = None
    credential_owner_identifier: Optional[str] = None
    endpoint_url: str
    region: Optional[str] = None
    access_key_id: str
    force_path_style: bool = False
    verify_tls: bool = True
    capabilities: dict[str, Any] = Field(default_factory=dict)
    tags: list[TagDefinitionSummary] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None


class S3ConnectionCreate(_CanonicalEndpointPayload):
    endpoint_conflict_scope = "S3 connection"

    name: str
    provider_hint: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    access_manager: bool = False
    access_browser: bool = True
    credential_owner_type: Optional[CredentialOwnerType] = None
    credential_owner_identifier: Optional[str] = None
    endpoint_url: Optional[str] = None
    region: Optional[str] = None
    access_key_id: str
    secret_access_key: str
    force_path_style: bool = False
    verify_tls: bool = True
    tags: RequiredTagDefinitionList = Field(default_factory=list)


class S3ConnectionUpdate(_CanonicalEndpointPayload):
    endpoint_conflict_scope = "S3 connection"

    name: Optional[str] = None
    provider_hint: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    is_active: Optional[bool] = None
    access_manager: Optional[bool] = None
    access_browser: Optional[bool] = None
    credential_owner_type: Optional[CredentialOwnerType] = None
    credential_owner_identifier: Optional[str] = None
    endpoint_url: Optional[str] = None
    region: Optional[str] = None
    access_key_id: Optional[str] = None
    secret_access_key: Optional[str] = None
    force_path_style: Optional[bool] = None
    verify_tls: Optional[bool] = None
    tags: OptionalTagDefinitionList = None


class S3ConnectionCredentialsUpdate(ApiModel):
    """Write-only credential rotation payload.

    The API never returns secrets back to the client.
    """


    access_key_id: str
    secret_access_key: str


class S3ConnectionCredentialsValidationRequest(_CanonicalEndpointPayload):
    endpoint_conflict_scope = "S3 credential validation"

    storage_endpoint_id: Optional[int] = None
    endpoint_url: Optional[str] = None
    region: Optional[str] = None
    access_key_id: str
    secret_access_key: str
    force_path_style: bool = False
    verify_tls: bool = True


class S3ConnectionCredentialsValidationResult(ApiModel):
    ok: bool
    severity: Literal["success", "warning", "error"]
    code: Optional[str] = None
    message: str


class PaginatedS3ConnectionsResponse(PaginatedResponse):
    items: list[S3Connection]
