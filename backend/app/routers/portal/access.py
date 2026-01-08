# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db_models import StorageEndpoint, User
from app.models.portal_access import (
    PortalAccessGrant,
    PortalExternalAccessCredentials,
    PortalExternalAccessStatus,
    PortalGrantAssignRequest,
)
from app.routers.dependencies import get_audit_logger
from app.routers.portal.dependencies import PortalContext, get_portal_context
from app.services.audit_service import AuditService
from app.services.portal_external_access_service import PortalExternalAccessService, get_portal_external_access_service
from app.services.portal_grants_service import PortalGrantsService


router = APIRouter(prefix="/access", tags=["portal-access"])


def _endpoint_from_ctx(db: Session, ctx: PortalContext) -> StorageEndpoint:
    endpoint = ctx.endpoint
    if endpoint:
        return endpoint
    if getattr(ctx.account, "storage_endpoint_id", None):
        found = db.query(StorageEndpoint).filter(StorageEndpoint.id == ctx.account.storage_endpoint_id).first()
        if found:
            return found
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Storage endpoint is not configured")


@router.get("/me", response_model=PortalExternalAccessStatus)
def get_my_external_access(
    ctx: PortalContext = Depends(get_portal_context),
    db: Session = Depends(get_db),
    service: PortalExternalAccessService = Depends(lambda db=Depends(get_db): get_portal_external_access_service(db)),
) -> PortalExternalAccessStatus:
    endpoint = _endpoint_from_ctx(db, ctx)
    return service.get_status(ctx.account, ctx.actor, endpoint)


@router.get("/users/{user_id}", response_model=PortalExternalAccessStatus)
def get_user_external_access(
    user_id: int,
    ctx: PortalContext = Depends(get_portal_context),
    db: Session = Depends(get_db),
    service: PortalExternalAccessService = Depends(lambda db=Depends(get_db): get_portal_external_access_service(db)),
) -> PortalExternalAccessStatus:
    if not ctx.can("portal.external.team.manage"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    endpoint = _endpoint_from_ctx(db, ctx)
    return service.get_status(ctx.account, target, endpoint)


@router.post("/me/enable", response_model=PortalExternalAccessCredentials, status_code=status.HTTP_201_CREATED)
def enable_my_external_access(
    ctx: PortalContext = Depends(get_portal_context),
    db: Session = Depends(get_db),
    service: PortalExternalAccessService = Depends(lambda db=Depends(get_db): get_portal_external_access_service(db)),
    audit: AuditService = Depends(get_audit_logger),
) -> PortalExternalAccessCredentials:
    if not ctx.can("portal.external.self.manage"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    endpoint = _endpoint_from_ctx(db, ctx)
    try:
        creds = service.enable_external_access(ctx.account, ctx.actor, endpoint)
        audit.record_action(
            user=ctx.actor,
            scope="portal",
            action="enable_external_access",
            surface="portal",
            workflow="external_access.enable",
            entity_type="iam_user",
            entity_id=creds.iam_username,
            account=ctx.account,
            executor_type="rgw_iam",
            executor_principal="account_root",
            delta={"iam_username": creds.iam_username, "access_key_id": creds.access_key_id},
        )
        return creds
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/me/rotate", response_model=PortalExternalAccessCredentials)
def rotate_my_external_access_key(
    ctx: PortalContext = Depends(get_portal_context),
    service: PortalExternalAccessService = Depends(lambda db=Depends(get_db): get_portal_external_access_service(db)),
    audit: AuditService = Depends(get_audit_logger),
) -> PortalExternalAccessCredentials:
    if not ctx.can("portal.external.self.manage"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    try:
        creds = service.rotate_access_key(ctx.account, ctx.actor)
        audit.record_action(
            user=ctx.actor,
            scope="portal",
            action="rotate_external_access_key",
            surface="portal",
            workflow="external_access.rotate_key",
            entity_type="iam_user",
            entity_id=creds.iam_username,
            account=ctx.account,
            executor_type="rgw_iam",
            executor_principal="account_root",
            delta={"iam_username": creds.iam_username, "access_key_id": creds.access_key_id},
        )
        return creds
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/me/revoke", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def revoke_my_external_access(
    ctx: PortalContext = Depends(get_portal_context),
    service: PortalExternalAccessService = Depends(lambda db=Depends(get_db): get_portal_external_access_service(db)),
    audit: AuditService = Depends(get_audit_logger),
) -> Response:
    if not ctx.can("portal.external.self.manage"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    try:
        service.revoke_access(ctx.account, ctx.actor)
        audit.record_action(
            user=ctx.actor,
            scope="portal",
            action="revoke_external_access",
            surface="portal",
            workflow="external_access.revoke",
            entity_type="user",
            entity_id=str(ctx.actor.id),
            account=ctx.account,
            executor_type="rgw_iam",
            executor_principal="account_root",
            delta={"user_id": ctx.actor.id},
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/users/{user_id}/enable", response_model=PortalExternalAccessCredentials, status_code=status.HTTP_201_CREATED)
def enable_user_external_access(
    user_id: int,
    ctx: PortalContext = Depends(get_portal_context),
    db: Session = Depends(get_db),
    service: PortalExternalAccessService = Depends(lambda db=Depends(get_db): get_portal_external_access_service(db)),
    audit: AuditService = Depends(get_audit_logger),
) -> PortalExternalAccessCredentials:
    if not ctx.can("portal.external.team.manage"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    endpoint = _endpoint_from_ctx(db, ctx)
    try:
        creds = service.enable_external_access(ctx.account, target, endpoint)
        audit.record_action(
            user=ctx.actor,
            scope="portal",
            action="enable_external_access_for_user",
            surface="portal",
            workflow="external_access.enable",
            entity_type="iam_user",
            entity_id=creds.iam_username,
            account=ctx.account,
            executor_type="rgw_iam",
            executor_principal="account_root",
            delta={"target_user_id": target.id, "iam_username": creds.iam_username, "access_key_id": creds.access_key_id},
        )
        return creds
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/users/{user_id}/rotate", response_model=PortalExternalAccessCredentials)
def rotate_user_external_access_key(
    user_id: int,
    ctx: PortalContext = Depends(get_portal_context),
    db: Session = Depends(get_db),
    service: PortalExternalAccessService = Depends(lambda db=Depends(get_db): get_portal_external_access_service(db)),
    audit: AuditService = Depends(get_audit_logger),
) -> PortalExternalAccessCredentials:
    if not ctx.can("portal.external.team.manage"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    try:
        creds = service.rotate_access_key(ctx.account, target)
        audit.record_action(
            user=ctx.actor,
            scope="portal",
            action="rotate_external_access_key_for_user",
            surface="portal",
            workflow="external_access.rotate_key",
            entity_type="iam_user",
            entity_id=creds.iam_username,
            account=ctx.account,
            executor_type="rgw_iam",
            executor_principal="account_root",
            delta={"target_user_id": target.id, "iam_username": creds.iam_username, "access_key_id": creds.access_key_id},
        )
        return creds
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/users/{user_id}/revoke", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def revoke_user_external_access(
    user_id: int,
    ctx: PortalContext = Depends(get_portal_context),
    db: Session = Depends(get_db),
    service: PortalExternalAccessService = Depends(lambda db=Depends(get_db): get_portal_external_access_service(db)),
    audit: AuditService = Depends(get_audit_logger),
) -> Response:
    if not ctx.can("portal.external.team.manage"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    try:
        service.revoke_access(ctx.account, target)
        audit.record_action(
            user=ctx.actor,
            scope="portal",
            action="revoke_external_access_for_user",
            surface="portal",
            workflow="external_access.revoke",
            entity_type="user",
            entity_id=str(target.id),
            account=ctx.account,
            executor_type="rgw_iam",
            executor_principal="account_root",
            delta={"target_user_id": target.id},
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/grants", response_model=PortalAccessGrant, status_code=status.HTTP_201_CREATED)
def assign_grant(
    payload: PortalGrantAssignRequest,
    ctx: PortalContext = Depends(get_portal_context),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_logger),
) -> PortalAccessGrant:
    if not ctx.can("portal.external.team.manage"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    endpoint = _endpoint_from_ctx(db, ctx)
    service = PortalGrantsService(db)
    try:
        grant = service.assign_grant(
            actor=ctx.actor,
            actor_role_key=ctx.role_key,
            account=ctx.account,
            endpoint=endpoint,
            request=payload,
        )
        audit.record_action(
            user=ctx.actor,
            scope="portal",
            action="assign_access_grant",
            surface="portal",
            workflow="packages.assign",
            entity_type="access_grant",
            entity_id=str(grant.id),
            account=ctx.account,
            executor_type="rgw_iam",
            executor_principal="account_root",
            delta={
                "target_user_id": payload.user_id,
                "package_key": payload.package_key,
                "bucket": payload.bucket,
                "status": grant.materialization_status,
            },
            error=grant.materialization_error,
            status="success" if grant.materialization_status == "active" else "failure",
        )
        return grant
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete("/grants/{user_id}/{grant_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def revoke_grant(
    user_id: int,
    grant_id: int,
    ctx: PortalContext = Depends(get_portal_context),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_logger),
) -> Response:
    if not ctx.can("portal.external.team.manage"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    service = PortalGrantsService(db)
    service.revoke_grant(account=ctx.account, user_id=user_id, grant_id=grant_id)
    audit.record_action(
        user=ctx.actor,
        scope="portal",
        action="revoke_access_grant",
        surface="portal",
        workflow="packages.revoke",
        entity_type="access_grant",
        entity_id=str(grant_id),
        account=ctx.account,
        executor_type="rgw_iam",
        executor_principal="account_root",
        delta={"target_user_id": user_id, "grant_id": grant_id},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
