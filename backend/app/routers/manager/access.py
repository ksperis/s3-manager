# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from fastapi import HTTPException, status

from app.services.s3_execution_context import S3ExecutionContext


def require_bucket_management_context(account: S3ExecutionContext) -> None:
    capabilities = getattr(account, "manager_capabilities", None)
    if capabilities is not None and not bool(
        getattr(capabilities, "can_manage_buckets", False)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bucket management is not allowed for this context",
        )
