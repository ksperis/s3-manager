# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal server access-log API contracts."""

from datetime import datetime
from typing import Literal, Optional, Union

from pydantic import Field, model_validator

from app.models.base import ApiModel


PortalServerAccessDirection = Literal["Upload", "Download"]
PortalServerAccessLogFilterField = Literal["action", "space", "path", "identity", "result"]
PortalServerAccessLogFilterOp = Literal[
    "eq",
    "neq",
    "contains",
    "starts_with",
    "ends_with",
    "in",
    "not_in",
    "is_null",
    "not_null",
]


class PortalServerAccessRequesterIdentity(ApiModel):
    label: str
    kind: Literal["portal_user", "external_access", "rgw_user", "rgw_account", "unknown"]
    detail: Optional[str] = None
    access_key_id: Optional[str] = None
    iam_username: Optional[str] = None
    user_id: Optional[int] = None
    email: Optional[str] = None
    resolved: bool = False


class PortalServerAccessLogFilterRule(ApiModel):
    field: PortalServerAccessLogFilterField
    op: PortalServerAccessLogFilterOp
    value: Optional[Union[str, int, float, bool, list[str], list[int], list[float], list[bool]]] = None

    @model_validator(mode="after")
    def validate_rule(self):
        if self.op not in ("is_null", "not_null") and self.value is None:
            raise ValueError("Portal server access log filter rule requires value.")
        return self


class PortalServerAccessLogFilterQuery(ApiModel):
    match: Literal["all", "any"] = "all"
    rules: list[PortalServerAccessLogFilterRule] = Field(default_factory=list)


class PortalServerAccessLogEntry(ApiModel):
    id: str
    source: Literal["server_access_logging"] = "server_access_logging"
    timestamp: datetime
    storage_space_id: Optional[str] = None
    storage_space_name: Optional[str] = None
    bucket_name: str
    operation: str
    operation_category: Literal["upload", "download", "delete", "metadata", "list", "other"]
    object_key: Optional[str] = None
    object_name: Optional[str] = None
    direction: Optional[PortalServerAccessDirection] = None
    status_code: Optional[int] = None
    error_code: Optional[str] = None
    bytes_sent: Optional[int] = None
    object_size: Optional[int] = None
    requester: Optional[str] = None
    requester_identity: Optional[PortalServerAccessRequesterIdentity] = None
    client_ip: Optional[str] = None
    auth_type: Optional[str] = None
    request_id: Optional[str] = None
    request_uri: Optional[str] = None
    user_agent: Optional[str] = None
    log_object_key: str


class PortalServerAccessLogPage(ApiModel):
    entries: list[PortalServerAccessLogEntry]
    total: int
    limit: int
    offset: int
