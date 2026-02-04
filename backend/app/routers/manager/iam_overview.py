# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.db import S3Account
from app.routers.dependencies import get_account_context, require_iam_capable_manager
from app.services.rgw_iam import get_iam_service
from app.utils.s3_endpoint import resolve_s3_client_options

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/manager/iam", tags=["manager-iam-overview"])


def _service_for_account(account: S3Account):
    access_key, secret_key = account.effective_rgw_credentials()
    if not access_key or not secret_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="S3Account root keys missing")
    endpoint, region, _, verify_tls = resolve_s3_client_options(account)
    return get_iam_service(
        access_key,
        secret_key,
        endpoint=endpoint,
        region=region,
        verify_tls=verify_tls,
    )


@router.get("/overview")
def iam_overview(
    account: S3Account = Depends(get_account_context),
    _: dict = Depends(require_iam_capable_manager),
) -> dict:
    service = _service_for_account(account)
    warnings: list[str] = []

    def _capture(label: str, func):
        try:
            return func()
        except RuntimeError as exc:
            logger.debug("IAM overview fallback for %s: %s", label, exc)
            warnings.append(f"{label}: {exc}")
            return []

    users = _capture("users", service.list_users)
    groups = _capture("groups", service.list_groups)
    roles = _capture("roles", service.list_roles)
    policies = _capture("policies", service.list_policies)
    return {
        "iam_users": len(users),
        "iam_groups": len(groups),
        "iam_roles": len(roles),
        "iam_policies": len(policies),
        "warnings": warnings,
    }
