# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, HTTPException, status

from app.db_models import S3Account, User
from app.models.policy import Policy, PolicyCreate
from app.routers.dependencies import (
    get_account_context,
    get_audit_logger,
    require_iam_capable_manager,
)
from app.services.audit_service import AuditService
from app.services.policies_service import PoliciesService, get_policies_service

router = APIRouter(prefix="/manager/iam/policies", tags=["manager-iam-policies"])


def get_account_and_service(account: S3Account) -> tuple[S3Account, PoliciesService]:
    try:
        service = get_policies_service(account)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return account, service


@router.get("", response_model=list[Policy])
def list_policies(
    service_and_acc=Depends(lambda account=Depends(get_account_context): get_account_and_service(account)),
    _: dict = Depends(require_iam_capable_manager),
) -> list[Policy]:
    _, service = service_and_acc
    try:
        return service.list_policies()
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{policy_arn}", response_model=Policy)
def get_policy(
    policy_arn: str,
    service_and_acc=Depends(lambda account=Depends(get_account_context): get_account_and_service(account)),
    _: dict = Depends(require_iam_capable_manager),
) -> Policy:
    _, service = service_and_acc
    policy = service.get_policy(policy_arn, include_document=True)
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found")
    return policy


@router.post("", response_model=Policy, status_code=status.HTTP_201_CREATED)
def create_policy(
    payload: PolicyCreate,
    service_and_acc=Depends(lambda account=Depends(get_account_context): get_account_and_service(account)),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> Policy:
    account, service = service_and_acc
    try:
        result = service.create_policy(payload.name, payload.document)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="create_managed_policy",
            entity_type="iam_policy",
            entity_id=result.arn,
            account=account,
            metadata={"name": payload.name},
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{policy_arn}", status_code=status.HTTP_204_NO_CONTENT)
def delete_policy(
    policy_arn: str,
    service_and_acc=Depends(lambda account=Depends(get_account_context): get_account_and_service(account)),
    current_user: User = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    account, service = service_and_acc
    try:
        service.delete_policy(policy_arn)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_managed_policy",
            entity_type="iam_policy",
            entity_id=policy_arn,
            account=account,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
