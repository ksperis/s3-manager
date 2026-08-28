# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.sensitive_data import sanitize_error_detail
from app.models.access_context import ManagerActor
from app.models.policy import Policy, PolicyCreate
from app.routers.dependencies import (
    get_account_context,
    get_audit_service,
    require_iam_capable_manager,
)
from app.services.audit_service import AuditService
from app.services.policies_service import PoliciesService, get_policies_service
from app.services.s3_execution_context import S3ExecutionContext

router = APIRouter(prefix="/manager/iam/policies", tags=["manager-iam-policies"])
PoliciesContext = tuple[S3ExecutionContext, PoliciesService]


def get_policies_context(
    account: S3ExecutionContext = Depends(get_account_context),
) -> PoliciesContext:
    try:
        service = get_policies_service(account)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    return account, service


@router.get("", response_model=list[Policy])
def list_policies(
    policies_context: PoliciesContext = Depends(get_policies_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> list[Policy]:
    _, service = policies_context
    try:
        return service.list_policies()
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=sanitize_error_detail(str(exc))) from exc


@router.get("/{policy_arn}", response_model=Policy)
def get_policy(
    policy_arn: str,
    policies_context: PoliciesContext = Depends(get_policies_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> Policy:
    _, service = policies_context
    policy = service.get_policy(policy_arn, include_document=True)
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found")
    return policy


@router.post("", response_model=Policy, status_code=status.HTTP_201_CREATED)
def create_policy(
    payload: PolicyCreate,
    policies_context: PoliciesContext = Depends(get_policies_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> Policy:
    account, service = policies_context
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=sanitize_error_detail(str(exc))) from exc


@router.delete("/{policy_arn}", status_code=status.HTTP_204_NO_CONTENT)
def delete_policy(
    policy_arn: str,
    policies_context: PoliciesContext = Depends(get_policies_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    account, service = policies_context
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
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=sanitize_error_detail(str(exc))) from exc
