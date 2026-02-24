# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Union

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, S3Connection, S3User, User, UserS3Account, UserS3Connection, UserS3User, is_admin_ui_role
from app.models.s3_account import S3Account as S3AccountSchema
from app.models.session import ManagerSessionPrincipal
from app.routers.dependencies import get_current_account_admin
from app.services.s3_accounts_service import get_s3_accounts_service
from app.services.s3_users_service import get_s3_users_service
from app.utils.s3_connection_endpoint import resolve_connection_details
from app.utils.storage_endpoint_features import features_to_capabilities, normalize_features_config

router = APIRouter(prefix="/manager/accounts", tags=["manager-accounts"])


@router.get("", response_model=list[S3AccountSchema])
def list_manager_accounts(
    user: Union[User, ManagerSessionPrincipal] = Depends(get_current_account_admin),
    db: Session = Depends(get_db),
) -> list[S3AccountSchema]:
    quota_service = get_s3_accounts_service(db, allow_missing_admin=True)
    s3_users_service = get_s3_users_service(db)
    if isinstance(user, ManagerSessionPrincipal):
        accounts: list[S3AccountSchema] = []
        if user.account_id:
            account = (
                db.query(S3Account)
                .filter(S3Account.rgw_account_id == user.account_id)
                .first()
            )
            name = account.name if account else (
                user.account_name or user.account_id or "S3 account"
            )
            account_db_id = account.id if account else None
            endpoint = account.storage_endpoint if account else None
            quota_max_size_gb = quota_max_objects = None
            if account:
                quota_max_size_gb, quota_max_objects = quota_service.get_account_quota(account)
            accounts.append(
                S3AccountSchema(
                    id=str(account_db_id or user.account_id or "0"),
                    name=name,
                    rgw_account_id=user.account_id,
                    quota_max_size_gb=quota_max_size_gb,
                    quota_max_objects=quota_max_objects,
                    storage_endpoint_id=endpoint.id if endpoint else None,
                    storage_endpoint_name=endpoint.name if endpoint else None,
                    storage_endpoint_url=endpoint.endpoint_url if endpoint else None,
                    storage_endpoint_capabilities=(
                        features_to_capabilities(normalize_features_config(endpoint.provider, endpoint.features_config))
                        if endpoint
                        else None
                    ),
                )
            )
        return accounts

    links = (
        db.query(UserS3Account)
        .filter(UserS3Account.user_id == user.id)
        .all()
    )
    account_ids = {l.account_id for l in links}
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

    # User-scoped S3 connections (credential-first) used for the daily /manager S3 configuration console.
    # These are intentionally not part of the platform account model; we expose them here only so the
    # manager can switch context.
    user_connection_ids = (
        db.query(UserS3Connection.s3_connection_id)
        .filter(UserS3Connection.user_id == user.id)
    )
    connections = (
        db.query(S3Connection)
        .filter(
            (S3Connection.is_public.is_(True))
            | (S3Connection.owner_user_id == user.id)
            | ((S3Connection.is_shared.is_(True)) & (S3Connection.id.in_(user_connection_ids)))
        )
        .filter(S3Connection.is_temporary.is_(False))
        .all()
    )

    results: list[S3AccountSchema] = []
    for acc in accounts:
        endpoint = acc.storage_endpoint
        root_link = None
        if is_admin_ui_role(user.role):
            root_link = (
                db.query(UserS3Account)
                .filter(
                    UserS3Account.account_id == acc.id,
                    UserS3Account.is_root.is_(True),
                )
                .join(User)
                .with_entities(User.email, User.id)
                .first()
            )
        quota_max_size_gb, quota_max_objects = quota_service.get_account_quota(acc)
        results.append(
            S3AccountSchema(
                id=str(acc.id),
                name=acc.name,
                rgw_account_id=acc.rgw_account_id,
                quota_max_size_gb=quota_max_size_gb,
                quota_max_objects=quota_max_objects,
                root_user_email=root_link[0] if root_link else None,
                root_user_id=root_link[1] if root_link else None,
                storage_endpoint_id=endpoint.id if endpoint else None,
                storage_endpoint_name=endpoint.name if endpoint else None,
                storage_endpoint_url=endpoint.endpoint_url if endpoint else None,
                storage_endpoint_capabilities=(
                    features_to_capabilities(normalize_features_config(endpoint.provider, endpoint.features_config))
                    if endpoint
                    else None
                ),
            )
        )
    for s3_user in s3_users:
        endpoint = s3_user.storage_endpoint
        quota_max_size_gb, quota_max_objects = s3_users_service.get_user_quota(s3_user)
        results.append(
            S3AccountSchema(
                id=f"s3u-{s3_user.id}",
                name=s3_user.name,
                rgw_account_id=None,
                rgw_user_uid=s3_user.rgw_user_uid,
                is_s3_user=True,
                email=s3_user.email,
                quota_max_size_gb=quota_max_size_gb,
                quota_max_objects=quota_max_objects,
                storage_endpoint_id=endpoint.id if endpoint else None,
                storage_endpoint_name=endpoint.name if endpoint else None,
                storage_endpoint_url=endpoint.endpoint_url if endpoint else None,
                storage_endpoint_capabilities=(
                    features_to_capabilities(normalize_features_config(endpoint.provider, endpoint.features_config))
                    if endpoint
                    else None
                ),
            )
        )

    for conn in connections:
        details = resolve_connection_details(conn)
        sns_enabled = False
        if conn.storage_endpoint:
            sns_enabled = bool(
                normalize_features_config(conn.storage_endpoint.provider, conn.storage_endpoint.features_config)
                .get("sns", {})
                .get("enabled")
            )
        # We reuse the S3Account schema for the manager selector by using a dedicated id prefix.
        # Capabilities are intentionally minimal and disable platform-only features (usage/metrics/admin).
        results.append(
            S3AccountSchema(
                id=f"conn-{conn.id}",
                name=conn.name,
                rgw_account_id=None,
                rgw_user_uid=None,
                is_s3_user=False,
                email=None,
                quota_max_size_gb=None,
                quota_max_objects=None,
                storage_endpoint_id=None,
                storage_endpoint_name=(details.endpoint_name or details.provider or "Custom endpoint"),
                storage_endpoint_url=details.endpoint_url,
                storage_endpoint_capabilities={
                    "admin": False,
                    "sts": False,
                    "usage": False,
                    "metrics": False,
                    "static_website": False,
                    "iam": bool(conn.iam_capable),
                    "sns": sns_enabled,
                    "sse": False,
                },
            )
        )
    return results
