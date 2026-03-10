# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, User
from app.models.iam import IAMRole, IAMRoleCreate, IAMRoleUpdate
from app.models.policy import InlinePolicy, Policy
from app.routers.dependencies import (
    get_account_context,
    get_audit_logger,
    require_iam_capable_manager,
)
from app.routers.manager.iam_common import (
    ensure_inline_policy_name,
    get_account_and_service,
    load_inline_policies,
    resolve_attached_policy,
    save_inline_policy,
)
from app.services.audit_service import AuditService

DEFAULT_ASSUME_ROLE = """
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": "*" },
      "Action": "sts:AssumeRole"
    }
  ]
}
""".strip()

router = APIRouter(prefix="/manager/iam/roles", tags=["manager-iam-roles"])


@router.get("", response_model=list[IAMRole])
def list_roles(
    account: S3Account = Depends(get_account_context),
    db: Session = Depends(get_db),
    _: dict = Depends(require_iam_capable_manager),
) -> list[IAMRole]:
    _, service = get_account_and_service(account)
    try:
        return service.list_roles()
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("", response_model=IAMRole, status_code=status.HTTP_201_CREATED)
def create_role(
    payload: IAMRoleCreate,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> IAMRole:
    _, service = get_account_and_service(account)
    assume_policy = payload.assume_role_policy_document or DEFAULT_ASSUME_ROLE
    if isinstance(assume_policy, str):
        try:
            assume_policy = json.loads(assume_policy)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assume role policy must be valid JSON") from exc
    try:
        result = service.create_role(payload.name, assume_policy, path=payload.path)
        if payload.inline_policies:
            for inline in payload.inline_policies:
                service.put_role_inline_policy(payload.name, inline.name, inline.document)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="create_iam_role",
            entity_type="iam_role",
            entity_id=payload.name,
            account=account,
            metadata={"inline_policies": [p.name for p in payload.inline_policies] if payload.inline_policies else []},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{role_name}", response_model=IAMRole)
def get_role(
    role_name: str,
    account: S3Account = Depends(get_account_context),
    _: dict = Depends(require_iam_capable_manager),
) -> IAMRole:
    _, service = get_account_and_service(account)
    try:
        role = service.get_role(role_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    return role


@router.delete("/{role_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(
    role_name: str,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    _, service = get_account_and_service(account)
    try:
        service.delete_role(role_name)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_iam_role",
            entity_type="iam_role",
            entity_id=role_name,
            account=account,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{role_name}", response_model=IAMRole)
def update_role(
    role_name: str,
    payload: IAMRoleUpdate,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> IAMRole:
    _, service = get_account_and_service(account)
    try:
        existing = service.get_role(role_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")

    if payload.path is not None and payload.path != existing.path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Updating an IAM role path is not supported. Create a new role with the desired path.",
        )

    assume_policy = payload.assume_role_policy_document
    if isinstance(assume_policy, str):
        try:
            assume_policy = json.loads(assume_policy)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assume role policy must be valid JSON") from exc

    updated = existing
    if assume_policy is not None:
        try:
            service.update_role_assume_policy(role_name, assume_policy)
            updated = service.get_role(role_name) or existing
            audit_service.record_action(
                user=current_user,
                scope="manager",
                action="update_iam_role",
                entity_type="iam_role",
                entity_id=role_name,
                account=account,
                metadata={"assume_role_policy_updated": True},
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return updated


@router.get("/{role_name}/inline-policies", response_model=list[InlinePolicy])
def list_role_inline_policies(
    role_name: str,
    account: S3Account = Depends(get_account_context),
    _: dict = Depends(require_iam_capable_manager),
) -> list[InlinePolicy]:
    _, service = get_account_and_service(account)
    try:
        return load_inline_policies(
            role_name,
            list_names_fn=service.list_role_inline_policies,
            get_policy_fn=service.get_role_inline_policy,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{role_name}/inline-policies/{policy_name}", response_model=InlinePolicy)
def put_role_inline_policy(
    role_name: str,
    policy_name: str,
    payload: InlinePolicy,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> InlinePolicy:
    ensure_inline_policy_name(payload, policy_name)
    _, service = get_account_and_service(account)
    try:
        saved = save_inline_policy(
            role_name,
            policy_name=policy_name,
            document=payload.document,
            put_policy_fn=service.put_role_inline_policy,
            get_policy_fn=service.get_role_inline_policy,
        )
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="put_role_inline_policy",
            entity_type="iam_role",
            entity_id=role_name,
            account=account,
            metadata={"policy_name": policy_name},
        )
        return saved
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{role_name}/inline-policies/{policy_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role_inline_policy(
    role_name: str,
    policy_name: str,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    _, service = get_account_and_service(account)
    try:
        service.delete_role_inline_policy(role_name, policy_name)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_role_inline_policy",
            entity_type="iam_role",
            entity_id=role_name,
            account=account,
            metadata={"policy_name": policy_name},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{role_name}/policies", response_model=list[Policy])
def list_role_policies(
    role_name: str,
    account: S3Account = Depends(get_account_context),
    _: dict = Depends(require_iam_capable_manager),
) -> list[Policy]:
    _, service = get_account_and_service(account)
    try:
        return service.list_role_policies(role_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/{role_name}/policies", response_model=Policy, status_code=status.HTTP_201_CREATED)
def attach_role_policy(
    role_name: str,
    payload: Policy,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> Policy:
    _, service = get_account_and_service(account)
    try:
        service.attach_role_policy(role_name, payload.arn)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="attach_role_policy",
            entity_type="iam_role",
            entity_id=role_name,
            account=account,
            metadata={"policy_arn": payload.arn},
        )
        return resolve_attached_policy(payload, get_policy_fn=service.get_policy)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{role_name}/policies/{policy_arn:path}", status_code=status.HTTP_204_NO_CONTENT)
def detach_role_policy(
    role_name: str,
    policy_arn: str,
    account: S3Account = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    _, service = get_account_and_service(account)
    try:
        service.detach_role_policy(role_name, policy_arn)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="detach_role_policy",
            entity_type="iam_role",
            entity_id=role_name,
            account=account,
            metadata={"policy_arn": policy_arn},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
