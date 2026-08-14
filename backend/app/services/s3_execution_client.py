# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Any

from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.s3_endpoint import resolve_s3_client_kwargs


def require_s3_execution_credentials(
    account: S3ExecutionTarget,
    *,
    error_message: str,
) -> tuple[str, str]:
    access_key, secret_key = account.effective_rgw_credentials()
    if not access_key or not secret_key:
        raise RuntimeError(error_message)
    return access_key, secret_key


def s3_execution_client_kwargs(account: S3ExecutionTarget) -> dict[str, Any]:
    return {
        **resolve_s3_client_kwargs(account),
        "session_token": account.session_token(),
    }
