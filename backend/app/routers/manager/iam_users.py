# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.services.s3_execution_context import S3ExecutionContext
from app.models.iam import AccessKey, AccessKeyStatusChange, IAMUser, IAMUserCreate, IAMUserWithKey
from app.models.policy import InlinePolicy, Policy
from app.routers.dependencies import (
    get_account_context,
    get_audit_service,
    require_iam_capable_manager,
)
from app.utils.http_errors import raise_http_exception_from_exception
from app.routers.manager.iam_common import (
    ensure_inline_policy_name,
    get_account_and_service,
    load_inline_policies,
    resolve_attached_policy,
    save_inline_policy,
)
from app.services.audit_service import AuditService
from app.services.managed_private_access_service import ManagedPrivateAccessService

router = APIRouter(prefix="/manager/iam/users", tags=["manager-iam-users"])


@router.get("", response_model=list[IAMUser])
def list_users(
    account: S3ExecutionContext = Depends(get_account_context),
    db: Session = Depends(get_db),
    _: dict = Depends(require_iam_capable_manager),
) -> list[IAMUser]:
    _, service = get_account_and_service(account)
    try:
        users = service.list_users()
        source = ManagedPrivateAccessService.iam_source_reference(account)
        if source is not None:
            managed = {
                row.iam_username: row
                for row in ManagedPrivateAccessService(db).managed_resources_for_source(*source)
                if row.iam_username
            }
            for item in users:
                provisioning = managed.get(item.name)
                if provisioning is not None:
                    item.is_private_access_managed = True
                    item.managed_connection_id = provisioning.s3_connection_id
        return users
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.post("", response_model=IAMUserWithKey, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: IAMUserCreate,
    account: S3ExecutionContext = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
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
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.delete("/{user_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> None:
    source = ManagedPrivateAccessService.iam_source_reference(account)
    if source is not None:
        managed = ManagedPrivateAccessService(db).managed_iam_user(*source, user_name)
        if managed is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This IAM user belongs to a managed private access; delete its private connection instead",
            )
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
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.get("/{user_name}/keys", response_model=list[AccessKey])
def list_access_keys(
    user_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    _: dict = Depends(require_iam_capable_manager),
    db: Session = Depends(get_db),
) -> list[AccessKey]:
    _, service = get_account_and_service(account)
    try:
        keys = service.list_access_keys(user_name)
        source = ManagedPrivateAccessService.iam_source_reference(account)
        if source is not None:
            managed = {
                row.access_key_id: row
                for row in ManagedPrivateAccessService(db).managed_resources_for_source(*source)
                if row.iam_username == user_name and row.access_key_id
            }
            for key in keys:
                provisioning = managed.get(key.access_key_id)
                if provisioning is not None:
                    key.is_private_access_managed = True
                    key.managed_connection_id = provisioning.s3_connection_id
        return keys
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.post("/{user_name}/keys", response_model=AccessKey, status_code=status.HTTP_201_CREATED)
def create_access_key(
    user_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> AccessKey:
    source = ManagedPrivateAccessService.iam_source_reference(account)
    if source is not None and ManagedPrivateAccessService(db).managed_iam_user(*source, user_name) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Managed private access IAM users cannot receive keys through the generic endpoint",
        )
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
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.put("/{user_name}/keys/{access_key_id}/status", response_model=AccessKey)
def update_access_key_status(
    user_name: str,
    access_key_id: str,
    payload: AccessKeyStatusChange,
    account: S3ExecutionContext = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> AccessKey:
    source = ManagedPrivateAccessService.iam_source_reference(account)
    if source is not None and ManagedPrivateAccessService(db).managed_key(*source, access_key_id) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This key belongs to a managed private access; update or delete its private connection instead",
        )
    _, service = get_account_and_service(account)
    status_value = "Active" if payload.active else "Inactive"
    try:
        service.update_access_key_status(user_name, access_key_id, status_value)
        updated = next(
            (key for key in service.list_access_keys(user_name) if key.access_key_id == access_key_id),
            None,
        )
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_access_key_status",
            entity_type="iam_user",
            entity_id=user_name,
            account=account,
            metadata={"access_key_id": access_key_id, "active": payload.active},
        )
        if updated:
            return updated
        return AccessKey(access_key_id=access_key_id, status=status_value)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.delete("/{user_name}/keys/{access_key_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_access_key(
    user_name: str,
    access_key_id: str,
    account: S3ExecutionContext = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> None:
    source = ManagedPrivateAccessService.iam_source_reference(account)
    if source is not None and ManagedPrivateAccessService(db).managed_key(*source, access_key_id) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This key belongs to a managed private access; delete its private connection instead",
        )
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
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.get("/{user_name}/inline-policies", response_model=list[InlinePolicy])
def list_user_inline_policies(
    user_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    _: dict = Depends(require_iam_capable_manager),
) -> list[InlinePolicy]:
    _, service = get_account_and_service(account)
    try:
        return load_inline_policies(
            user_name,
            list_names_fn=service.list_user_inline_policies,
            get_policy_fn=service.get_user_inline_policy,
        )
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.put("/{user_name}/inline-policies/{policy_name}", response_model=InlinePolicy)
def put_user_inline_policy(
    user_name: str,
    policy_name: str,
    payload: InlinePolicy,
    account: S3ExecutionContext = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> InlinePolicy:
    ensure_inline_policy_name(payload, policy_name)
    _, service = get_account_and_service(account)
    try:
        saved = save_inline_policy(
            user_name,
            policy_name=policy_name,
            document=payload.document,
            put_policy_fn=service.put_user_inline_policy,
            get_policy_fn=service.get_user_inline_policy,
        )
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="put_user_inline_policy",
            entity_type="iam_user",
            entity_id=user_name,
            account=account,
            metadata={"policy_name": policy_name},
        )
        return saved
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.delete("/{user_name}/inline-policies/{policy_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user_inline_policy(
    user_name: str,
    policy_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
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
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.get("/{user_name}/policies", response_model=list[Policy])
def list_user_policies(
    user_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    _: dict = Depends(require_iam_capable_manager),
) -> list[Policy]:
    _, service = get_account_and_service(account)
    try:
        return service.list_user_policies(user_name)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.post("/{user_name}/policies", response_model=Policy, status_code=status.HTTP_201_CREATED)
def attach_user_policy(
    user_name: str,
    payload: Policy,
    account: S3ExecutionContext = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> Policy:
    _, service = get_account_and_service(account)
    try:
        service.attach_user_policy(user_name, payload.arn)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="attach_user_policy",
            entity_type="iam_user",
            entity_id=user_name,
            account=account,
            metadata={"policy_arn": payload.arn},
        )
        return resolve_attached_policy(payload, get_policy_fn=service.get_policy)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.delete("/{user_name}/policies/{policy_arn:path}", status_code=status.HTTP_204_NO_CONTENT)
def detach_user_policy(
    user_name: str,
    policy_arn: str,
    account: S3ExecutionContext = Depends(get_account_context),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
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
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
