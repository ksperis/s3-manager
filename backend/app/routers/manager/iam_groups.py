# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db_models import S3Account, User
from app.models.iam import IAMGroup, IAMGroupCreate, IAMUser
from app.models.policy import InlinePolicy, Policy
from app.routers.dependencies import (
    get_account_context,
    get_audit_logger,
    require_iam_capable_manager,
)
from app.services.audit_service import AuditService
from app.services.rgw_iam import RGWIAMService, get_iam_service

router = APIRouter(prefix="/manager/iam/groups", tags=["manager-iam-groups"])


def get_account_and_service(account: S3Account) -> tuple[S3Account, RGWIAMService]:
    access_key, secret_key = account.effective_rgw_credentials()
    if not access_key or not secret_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="S3Account root keys missing")
    service = get_iam_service(access_key, secret_key)
    return account, service


@router.get("", response_model=list[IAMGroup])
def list_groups(
    account: S3Account = Depends(get_account_context),
    db: Session = Depends(get_db),
    _: dict = Depends(require_iam_capable_manager),
) -> list[IAMGroup]:
    _, service = get_account_and_service(account)
    try:
        return service.list_groups()
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("", response_model=IAMGroup, status_code=status.HTTP_201_CREATED)
def create_group(
    payload: IAMGroupCreate,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> IAMGroup:
    _, service = get_account_and_service(account)
    try:
        result = service.create_group(payload.name)
        if payload.inline_policies:
            for inline in payload.inline_policies:
                service.put_group_inline_policy(payload.name, inline.name, inline.document)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="create_iam_group",
            entity_type="iam_group",
            entity_id=payload.name,
            account=account,
            metadata={"inline_policies": [p.name for p in payload.inline_policies] if payload.inline_policies else []},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{group_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_name: str,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    _, service = get_account_and_service(account)
    try:
        service.delete_group(group_name)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_iam_group",
            entity_type="iam_group",
            entity_id=group_name,
            account=account,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{group_name}/users", response_model=list[IAMUser])
def list_group_users(
    group_name: str,
    account: S3Account = Depends(get_account_context),
    _: dict = Depends(require_iam_capable_manager),
) -> list[IAMUser]:
    _, service = get_account_and_service(account)
    try:
        return service.list_group_users(group_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/{group_name}/users", response_model=IAMUser, status_code=status.HTTP_201_CREATED)
def add_user_to_group(
    group_name: str,
    payload: IAMUser,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> IAMUser:
    _, service = get_account_and_service(account)
    try:
        service.add_user_to_group(group_name, payload.name)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="add_user_to_group",
            entity_type="iam_group",
            entity_id=group_name,
            account=account,
            metadata={"user": payload.name},
        )
        return IAMUser(name=payload.name)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{group_name}/users/{user_name}", status_code=status.HTTP_204_NO_CONTENT)
def remove_user_from_group(
    group_name: str,
    user_name: str,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    _, service = get_account_and_service(account)
    try:
        service.remove_user_from_group(group_name, user_name)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="remove_user_from_group",
            entity_type="iam_group",
            entity_id=group_name,
            account=account,
            metadata={"user": user_name},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{group_name}/inline-policies", response_model=list[InlinePolicy])
def list_group_inline_policies(
    group_name: str,
    account: S3Account = Depends(get_account_context),
    _: dict = Depends(require_iam_capable_manager),
) -> list[InlinePolicy]:
    _, service = get_account_and_service(account)
    try:
        names = service.list_group_inline_policies(group_name)
        policies: list[InlinePolicy] = []
        for name in names:
            document = service.get_group_inline_policy(group_name, name) or {}
            policies.append(InlinePolicy(name=name, document=document))
        return policies
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{group_name}/inline-policies/{policy_name}", response_model=InlinePolicy)
def put_group_inline_policy(
    group_name: str,
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
        service.put_group_inline_policy(group_name, policy_name, document)
        saved = service.get_group_inline_policy(group_name, policy_name) or document
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="put_group_inline_policy",
            entity_type="iam_group",
            entity_id=group_name,
            account=account,
            metadata={"policy_name": policy_name},
        )
        return InlinePolicy(name=policy_name, document=saved)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{group_name}/inline-policies/{policy_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group_inline_policy(
    group_name: str,
    policy_name: str,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    _, service = get_account_and_service(account)
    try:
        service.delete_group_inline_policy(group_name, policy_name)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_group_inline_policy",
            entity_type="iam_group",
            entity_id=group_name,
            account=account,
            metadata={"policy_name": policy_name},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{group_name}/policies", response_model=list[Policy])
def list_group_policies(
    group_name: str,
    account: S3Account = Depends(get_account_context),
    _: dict = Depends(require_iam_capable_manager),
) -> list[Policy]:
    _, service = get_account_and_service(account)
    try:
        return service.list_group_policies(group_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/{group_name}/policies", response_model=Policy, status_code=status.HTTP_201_CREATED)
def attach_group_policy(
    group_name: str,
    payload: Policy,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> Policy:
    _, service = get_account_and_service(account)
    try:
        service.attach_group_policy(group_name, payload.arn)
        fetched = service.get_policy(payload.arn)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="attach_group_policy",
            entity_type="iam_group",
            entity_id=group_name,
            account=account,
            metadata={"policy_arn": payload.arn},
        )
        if fetched:
            return fetched
        return Policy(name=payload.name, arn=payload.arn, path=payload.path, default_version_id=payload.default_version_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{group_name}/policies/{policy_arn:path}", status_code=status.HTTP_204_NO_CONTENT)
def detach_group_policy(
    group_name: str,
    policy_arn: str,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    _, service = get_account_and_service(account)
    try:
        service.detach_group_policy(group_name, policy_arn)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="detach_group_policy",
            entity_type="iam_group",
            entity_id=group_name,
            account=account,
            metadata={"policy_arn": policy_arn},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
