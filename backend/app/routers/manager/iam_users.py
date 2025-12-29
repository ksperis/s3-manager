# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db_models import S3Account, User
from app.models.iam import AccessKey, IAMUser, IAMUserCreate, IAMUserWithKey
from app.models.policy import InlinePolicy, Policy
from app.routers.dependencies import (
    get_account_context,
    get_audit_logger,
    require_iam_capable_manager,
)
from app.services.audit_service import AuditService
from app.services.rgw_iam import RGWIAMService, get_iam_service
from app.utils.s3_endpoint import resolve_s3_endpoint

router = APIRouter(prefix="/manager/iam/users", tags=["manager-iam-users"])


def get_account_and_service(account: S3Account) -> tuple[S3Account, RGWIAMService]:
    access_key, secret_key = account.effective_rgw_credentials()
    if not access_key or not secret_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="S3Account root keys missing")
    service = get_iam_service(access_key, secret_key, endpoint=resolve_s3_endpoint(account))
    return account, service


@router.get("", response_model=list[IAMUser])
def list_users(
    account: S3Account = Depends(get_account_context),
    db: Session = Depends(get_db),
    _: dict = Depends(require_iam_capable_manager),
) -> list[IAMUser]:
    _, service = get_account_and_service(account)
    try:
        return service.list_users()
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("", response_model=IAMUserWithKey, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: IAMUserCreate,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> IAMUserWithKey:
    _, service = get_account_and_service(account)
    try:
        created_user, created_key = service.create_user(payload.name, create_key=payload.create_key)
        # Optionally attach user to groups
        if payload.groups:
            for group_name in payload.groups:
                service.add_user_to_group(group_name, payload.name)
        # Optionally attach managed policies
        if payload.policies:
            for policy_arn in payload.policies:
                service.attach_user_policy(payload.name, policy_arn)
        if payload.inline_policies:
            for inline in payload.inline_policies:
                service.put_user_inline_policy(payload.name, inline.name, inline.document)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="create_iam_user",
            entity_type="iam_user",
            entity_id=payload.name,
            account=account,
            metadata={
                "create_key": payload.create_key,
                "groups": payload.groups or [],
                "policies": payload.policies or [],
                "inline_policies": [p.name for p in payload.inline_policies] if payload.inline_policies else [],
                "access_key_created": bool(created_key),
            },
        )
        return IAMUserWithKey(**created_user.model_dump(), access_key=created_key)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{user_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_name: str,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    _, service = get_account_and_service(account)
    try:
        service.delete_user(user_name)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_iam_user",
            entity_type="iam_user",
            entity_id=user_name,
            account=account,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{user_name}/keys", response_model=list[AccessKey])
def list_access_keys(
    user_name: str,
    account: S3Account = Depends(get_account_context),
    _: dict = Depends(require_iam_capable_manager),
) -> list[AccessKey]:
    _, service = get_account_and_service(account)
    try:
        return service.list_access_keys(user_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/{user_name}/keys", response_model=AccessKey, status_code=status.HTTP_201_CREATED)
def create_access_key(
    user_name: str,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> AccessKey:
    _, service = get_account_and_service(account)
    try:
        key = service.create_access_key(user_name)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="create_access_key",
            entity_type="iam_user",
            entity_id=user_name,
            account=account,
            metadata={"access_key_id": key.access_key_id},
        )
        return key
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{user_name}/keys/{access_key_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_access_key(
    user_name: str,
    access_key_id: str,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    _, service = get_account_and_service(account)
    try:
        service.delete_access_key(user_name, access_key_id)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_access_key",
            entity_type="iam_user",
            entity_id=user_name,
            account=account,
            metadata={"access_key_id": access_key_id},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{user_name}/inline-policies", response_model=list[InlinePolicy])
def list_user_inline_policies(
    user_name: str,
    account: S3Account = Depends(get_account_context),
    _: dict = Depends(require_iam_capable_manager),
) -> list[InlinePolicy]:
    _, service = get_account_and_service(account)
    try:
        names = service.list_user_inline_policies(user_name)
        policies: list[InlinePolicy] = []
        for name in names:
            document = service.get_user_inline_policy(user_name, name) or {}
            policies.append(InlinePolicy(name=name, document=document))
        return policies
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{user_name}/inline-policies/{policy_name}", response_model=InlinePolicy)
def put_user_inline_policy(
    user_name: str,
    policy_name: str,
    payload: InlinePolicy,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> InlinePolicy:
    if payload.name and payload.name != policy_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Inline policy name in payload does not match the URL."
        )
    _, service = get_account_and_service(account)
    try:
        document = payload.document
        service.put_user_inline_policy(user_name, policy_name, document)
        saved = service.get_user_inline_policy(user_name, policy_name) or document
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="put_user_inline_policy",
            entity_type="iam_user",
            entity_id=user_name,
            account=account,
            metadata={"policy_name": policy_name},
        )
        return InlinePolicy(name=policy_name, document=saved)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{user_name}/inline-policies/{policy_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user_inline_policy(
    user_name: str,
    policy_name: str,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    _, service = get_account_and_service(account)
    try:
        service.delete_user_inline_policy(user_name, policy_name)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_user_inline_policy",
            entity_type="iam_user",
            entity_id=user_name,
            account=account,
            metadata={"policy_name": policy_name},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{user_name}/policies", response_model=list[Policy])
def list_user_policies(
    user_name: str,
    account: S3Account = Depends(get_account_context),
    _: dict = Depends(require_iam_capable_manager),
) -> list[Policy]:
    _, service = get_account_and_service(account)
    try:
        return service.list_user_policies(user_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/{user_name}/policies", response_model=Policy, status_code=status.HTTP_201_CREATED)
def attach_user_policy(
    user_name: str,
    payload: Policy,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> Policy:
    _, service = get_account_and_service(account)
    try:
        service.attach_user_policy(user_name, payload.arn)
        fetched = service.get_policy(payload.arn)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="attach_user_policy",
            entity_type="iam_user",
            entity_id=user_name,
            account=account,
            metadata={"policy_arn": payload.arn},
        )
        if fetched:
            return fetched
        return Policy(name=payload.name, arn=payload.arn, path=payload.path, default_version_id=payload.default_version_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{user_name}/policies/{policy_arn:path}", status_code=status.HTTP_204_NO_CONTENT)
def detach_user_policy(
    user_name: str,
    policy_arn: str,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    _, service = get_account_and_service(account)
    try:
        service.detach_user_policy(user_name, policy_arn)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="detach_user_policy",
            entity_type="iam_user",
            entity_id=user_name,
            account=account,
            metadata={"policy_arn": policy_arn},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
