# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.portal_buckets import PortalBucketCreateRequest, PortalBucketCreateResponse
from app.routers.dependencies import get_audit_logger
from app.routers.portal.dependencies import PortalContext, require_portal_permission
from app.services.audit_service import AuditService
from app.services.portal_bucket_provisioning_service import (
    PortalBucketProvisioningService,
    get_portal_bucket_provisioning_service,
)


router = APIRouter(prefix="/buckets", tags=["portal-buckets"])


@router.post("", response_model=PortalBucketCreateResponse, status_code=status.HTTP_201_CREATED)
def create_bucket(
    payload: PortalBucketCreateRequest,
    ctx: PortalContext = Depends(require_portal_permission("portal.bucket.create")),
    service: PortalBucketProvisioningService = Depends(lambda db=Depends(get_db): get_portal_bucket_provisioning_service(db)),
    audit: AuditService = Depends(get_audit_logger),
    db: Session = Depends(get_db),
) -> PortalBucketCreateResponse:
    # Ensure account instance is attached to the current DB session.
    account = db.merge(ctx.account)
    try:
        created, executor_user = service.create_bucket(account, payload)
        audit.record_action(
            user=ctx.actor,
            scope="portal",
            action="create_bucket",
            surface="portal",
            workflow="bucket.create",
            entity_type="bucket",
            entity_id=created.name,
            account=ctx.account,
            executor_type="bucket_provisioner",
            executor_principal=executor_user,
            delta={"bucket": created.name, "versioning": created.versioning, "tags": created.tags},
            status="success",
        )
        return created
    except ValueError as exc:
        audit.record_action(
            user=ctx.actor,
            scope="portal",
            action="create_bucket",
            surface="portal",
            workflow="bucket.create",
            entity_type="bucket",
            entity_id=payload.name,
            account=ctx.account,
            executor_type="bucket_provisioner",
            executor_principal="bucket-provisioner",
            delta={"bucket": payload.name, "versioning": payload.versioning},
            status="failure",
            error=str(exc),
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        audit.record_action(
            user=ctx.actor,
            scope="portal",
            action="create_bucket",
            surface="portal",
            workflow="bucket.create",
            entity_type="bucket",
            entity_id=payload.name,
            account=ctx.account,
            executor_type="bucket_provisioner",
            executor_principal="bucket-provisioner",
            delta={"bucket": payload.name, "versioning": payload.versioning},
            status="failure",
            error=str(exc),
        )
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

