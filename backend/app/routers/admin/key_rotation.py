# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.key_rotation import KeyRotationRequest, KeyRotationResponse
from app.routers.dependencies import get_audit_logger, get_current_super_admin
from app.services.audit_service import AuditService
from app.services.key_rotation_service import KeyRotationService, get_key_rotation_service

router = APIRouter(prefix="/admin/key-rotation", tags=["admin-key-rotation"])


def get_service(db: Session = Depends(get_db)) -> KeyRotationService:
    return get_key_rotation_service(db)


@router.post("", response_model=KeyRotationResponse)
def rotate_keys(
    payload: KeyRotationRequest,
    service: KeyRotationService = Depends(get_service),
    current_user: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_logger),
) -> KeyRotationResponse:
    try:
        result = service.rotate_keys(payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    audit.record_action(
        user=current_user,
        scope="admin",
        action="rotate_s3_keys",
        entity_type="key_rotation",
        entity_id=None,
        metadata={
            "endpoint_ids": payload.endpoint_ids,
            "key_types": [entry.value for entry in payload.key_types],
            "deactivate_only": payload.deactivate_only,
            "summary": result.summary.model_dump(),
        },
    )
    return result
