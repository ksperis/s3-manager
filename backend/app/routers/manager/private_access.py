# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.access_context import ManagerActor
from app.services.s3_execution_context import S3ExecutionContext
from app.models.managed_private_access import (
    ManagedIAMPrivateAccessRequest,
    ManagedPrivateAccessResult,
    ManagedRGWUserPrivateAccessRequest,
)
from app.routers.dependencies import (
    get_account_context,
    get_current_account_user,
    require_iam_capable_manager,
    require_manager_ceph_s3_user_keys,
)
from app.core.sensitive_data import sanitize_error_detail
from app.services.managed_private_access_service import (
    ManagedPrivateAccessCleanupPending,
    ManagedPrivateAccessConflict,
    ManagedPrivateAccessError,
    ManagedPrivateAccessForbidden,
    ManagedPrivateAccessService,
)

router = APIRouter(prefix="/manager/private-access", tags=["manager-private-access"])


def _translate_error(exc: ManagedPrivateAccessError) -> HTTPException:
    if isinstance(exc, ManagedPrivateAccessForbidden):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=sanitize_error_detail(str(exc)))
    if isinstance(exc, ManagedPrivateAccessCleanupPending):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=sanitize_error_detail({"message": str(exc), "provisioning_id": exc.provisioning_id}),
        )
    if isinstance(exc, ManagedPrivateAccessConflict):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=sanitize_error_detail(str(exc)))
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc)))


@router.post("/iam", response_model=ManagedPrivateAccessResult, status_code=status.HTTP_201_CREATED)
def create_iam_private_access(
    payload: ManagedIAMPrivateAccessRequest,
    account: S3ExecutionContext = Depends(get_account_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> ManagedPrivateAccessResult:
    try:
        return ManagedPrivateAccessService(db).provision_iam(
            user=user,
            account=account,
            payload=payload,
        )
    except ManagedPrivateAccessError as exc:
        raise _translate_error(exc) from exc


@router.post("/rgw-user", response_model=ManagedPrivateAccessResult, status_code=status.HTTP_201_CREATED)
def create_rgw_user_private_access(
    payload: ManagedRGWUserPrivateAccessRequest,
    account: S3ExecutionContext = Depends(require_manager_ceph_s3_user_keys),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> ManagedPrivateAccessResult:
    try:
        return ManagedPrivateAccessService(db).provision_rgw_user(
            user=user,
            account=account,
            payload=payload,
        )
    except ManagedPrivateAccessError as exc:
        raise _translate_error(exc) from exc


@router.post("/{connection_id}/retry-cleanup", status_code=status.HTTP_204_NO_CONTENT)
def retry_private_access_cleanup(
    connection_id: int,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> Response:
    try:
        ManagedPrivateAccessService(db).retry_cleanup(user=user, connection_id=connection_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Managed cleanup not found") from exc
    except ManagedPrivateAccessError as exc:
        raise _translate_error(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/provisionings/{provisioning_id}/retry-cleanup", status_code=status.HTTP_204_NO_CONTENT)
def retry_private_access_provisioning_cleanup(
    provisioning_id: int,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> Response:
    try:
        ManagedPrivateAccessService(db).retry_provisioning_cleanup(
            user=user,
            provisioning_id=provisioning_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Managed provisioning cleanup not found") from exc
    except ManagedPrivateAccessError as exc:
        raise _translate_error(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
