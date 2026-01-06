# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Union

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db_models import S3Account, S3User, User, UserS3Account, UserS3User, UserRole
from app.models.s3_account import S3Account as S3AccountSchema
from app.models.session import ManagerSessionPrincipal
from app.routers.dependencies import get_current_account_admin
from app.services.s3_accounts_service import get_s3_accounts_service
from app.services.s3_users_service import get_s3_users_service
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
                user.account_name or user.account_id or "RGW account"
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

    results: list[S3AccountSchema] = []
    for acc in accounts:
        endpoint = acc.storage_endpoint
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
    return results
