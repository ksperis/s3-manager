# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable

from fastapi import HTTPException, status

from app.db import S3Account
from app.models.policy import InlinePolicy, Policy
from app.services.rgw_iam import RGWIAMService, get_iam_service
from app.utils.s3_endpoint import resolve_s3_client_options


def get_account_and_service(account: S3Account) -> tuple[S3Account, RGWIAMService]:
    access_key, secret_key = account.effective_rgw_credentials()
    if not access_key or not secret_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="S3Account root keys missing")
    endpoint, region, _, verify_tls = resolve_s3_client_options(account)
    service = get_iam_service(
        access_key,
        secret_key,
        endpoint=endpoint,
        region=region,
        verify_tls=verify_tls,
    )
    return account, service


def ensure_inline_policy_name(payload: InlinePolicy, policy_name: str) -> None:
    if payload.name and payload.name != policy_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inline policy name in payload does not match the URL.",
        )


def load_inline_policies(
    entity_name: str,
    *,
    list_names_fn: Callable[[str], list[str]],
    get_policy_fn: Callable[[str, str], dict[str, Any] | None],
) -> list[InlinePolicy]:
    names = list_names_fn(entity_name)
    policies: list[InlinePolicy] = []
    for name in names:
        document = get_policy_fn(entity_name, name) or {}
        policies.append(InlinePolicy(name=name, document=document))
    return policies


def save_inline_policy(
    entity_name: str,
    *,
    policy_name: str,
    document: dict[str, Any],
    put_policy_fn: Callable[[str, str, dict[str, Any]], None],
    get_policy_fn: Callable[[str, str], dict[str, Any] | None],
) -> InlinePolicy:
    put_policy_fn(entity_name, policy_name, document)
    saved = get_policy_fn(entity_name, policy_name) or document
    return InlinePolicy(name=policy_name, document=saved)


def resolve_attached_policy(
    payload: Policy,
    *,
    get_policy_fn: Callable[[str], Policy | None],
) -> Policy:
    fetched = get_policy_fn(payload.arn)
    if fetched:
        return fetched
    return Policy(name=payload.name, arn=payload.arn, path=payload.path, default_version_id=payload.default_version_id)
