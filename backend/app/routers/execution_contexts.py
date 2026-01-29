# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, S3Connection, S3User, User, UserS3Account, UserS3Connection, UserS3User
from app.models.execution_context import ExecutionContext, ExecutionContextCapabilities
from app.routers.dependencies import get_current_account_user
from app.services.s3_users_service import S3UsersService
from app.utils.s3_connection_endpoint import resolve_connection_details
from app.utils.storage_endpoint_features import features_to_capabilities, normalize_features_config

router = APIRouter(prefix="/me", tags=["me"])


def _build_account_context(account: S3Account) -> ExecutionContext:
    endpoint = account.storage_endpoint
    endpoint_caps = (
        features_to_capabilities(normalize_features_config(endpoint.provider, endpoint.features_config))
        if endpoint
        else None
    )
    sts_capable = bool(endpoint_caps.get("sts")) if endpoint_caps else False
    return ExecutionContext(
        kind="account",
        id=str(account.id),
        display_name=account.name,
        rgw_account_id=account.rgw_account_id,
        endpoint_id=endpoint.id if endpoint else None,
        endpoint_name=endpoint.name if endpoint else None,
        endpoint_url=endpoint.endpoint_url if endpoint else None,
        storage_endpoint_capabilities=endpoint_caps,
        capabilities=ExecutionContextCapabilities(
            iam_capable=True,
            sts_capable=sts_capable,
            admin_api_capable=True,
        ),
    )


def _build_legacy_user_context(
    s3_user: S3User,
    quota_max_size_gb: Optional[float],
    quota_max_objects: Optional[int],
) -> ExecutionContext:
    endpoint = s3_user.storage_endpoint
    endpoint_caps = (
        features_to_capabilities(normalize_features_config(endpoint.provider, endpoint.features_config))
        if endpoint
        else None
    )
    return ExecutionContext(
        kind="legacy_user",
        id=f"s3u-{s3_user.id}",
        display_name=s3_user.name,
        quota_max_size_gb=quota_max_size_gb,
        quota_max_objects=quota_max_objects,
        endpoint_id=endpoint.id if endpoint else None,
        endpoint_name=endpoint.name if endpoint else None,
        endpoint_url=endpoint.endpoint_url if endpoint else None,
        storage_endpoint_capabilities=endpoint_caps,
        capabilities=ExecutionContextCapabilities(
            iam_capable=False,
            sts_capable=False,
            admin_api_capable=False,
        ),
    )


def _build_connection_context(connection: S3Connection) -> ExecutionContext:
    details = resolve_connection_details(connection)
    sns_enabled = False
    if connection.storage_endpoint:
        sns_enabled = bool(
            normalize_features_config(connection.storage_endpoint.provider, connection.storage_endpoint.features_config)
            .get("sns", {})
            .get("enabled")
        )
    return ExecutionContext(
        kind="connection",
        id=f"conn-{connection.id}",
        display_name=connection.name,
        endpoint_id=None,
        endpoint_name=(details.endpoint_name or details.provider or "Custom endpoint"),
        endpoint_url=details.endpoint_url,
        storage_endpoint_capabilities={
            "admin": False,
            "sts": False,
            "usage": False,
            "metrics": False,
            "static_website": False,
            "iam": False,
            "sns": sns_enabled,
        },
        capabilities=ExecutionContextCapabilities(
            iam_capable=False,
            sts_capable=False,
            admin_api_capable=False,
        ),
    )


@router.get("/execution-contexts", response_model=list[ExecutionContext])
def list_execution_contexts(
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> list[ExecutionContext]:
    s3_users_service = S3UsersService(db)
    links = (
        db.query(UserS3Account)
        .filter(UserS3Account.user_id == user.id)
        .all()
    )
    account_ids = {link.account_id for link in links}
    accounts = (
        db.query(S3Account).filter(S3Account.id.in_(account_ids)).all()
        if account_ids
        else []
    )

    s3_links = (
        db.query(UserS3User)
        .filter(UserS3User.user_id == user.id)
        .all()
    )
    s3_ids = {link.s3_user_id for link in s3_links}
    s3_users = (
        db.query(S3User).filter(S3User.id.in_(s3_ids)).all()
        if s3_ids
        else []
    )

    user_connection_ids = (
        db.query(UserS3Connection.s3_connection_id)
        .filter(UserS3Connection.user_id == user.id)
    )
    connections = (
        db.query(S3Connection)
        .filter(
            (S3Connection.is_public.is_(True))
            | (S3Connection.owner_user_id == user.id)
            | (S3Connection.id.in_(user_connection_ids))
        )
        .all()
    )

    results: list[ExecutionContext] = []
    for account in accounts:
        results.append(_build_account_context(account))
    for s3_user in s3_users:
        quota_max_size_gb, quota_max_objects = s3_users_service.get_user_quota(s3_user)
        results.append(_build_legacy_user_context(s3_user, quota_max_size_gb, quota_max_objects))
    for connection in connections:
        results.append(_build_connection_context(connection))
    return results
