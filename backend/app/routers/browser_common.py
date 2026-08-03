# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from pydantic import BaseModel

from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.storage_endpoint_features import resolve_feature_flags


class CreateFolderPayload(BaseModel):
    prefix: str


class ProxyUploadResponse(BaseModel):
    message: str
    key: str


class EnsureCorsPayload(BaseModel):
    origin: Optional[str] = None


def require_sse_feature(account: S3ExecutionTarget) -> None:
    endpoint = getattr(account, "storage_endpoint", None)
    if endpoint is None:
        return
    if not resolve_feature_flags(endpoint).sse_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Server-side encryption is disabled for this endpoint",
        )


def require_replication_feature(account: S3ExecutionTarget) -> None:
    endpoint = getattr(account, "storage_endpoint", None)
    if endpoint is None or not resolve_feature_flags(endpoint).replication_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bucket replication is disabled for this endpoint",
        )

