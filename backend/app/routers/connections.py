# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.s3_connection import (
    S3Connection,
    S3ConnectionCreate,
    S3ConnectionCredentialsUpdate,
    S3ConnectionCredentialsValidationRequest,
    S3ConnectionCredentialsValidationResult,
    S3ConnectionUpdate,
)
from app.models.storage_endpoint import StorageEndpointPublic
from app.models.tagging import TagDefinitionListResponse
from app.routers.dependencies import get_current_account_user
from app.services.audit_service import AuditService
from app.services.effective_access_service import EffectiveAccessService
from app.services.s3_connection_endpoint_planner import StorageEndpointNotFoundError
from app.services.s3_connections_service import S3ConnectionsService
from app.services.managed_private_access_service import (
    ManagedPrivateAccessCleanupPending,
    ManagedPrivateAccessService,
)
from app.services.s3_connection_validation_service import S3ConnectionValidationService
from app.services.storage_endpoints_service import get_storage_endpoints_service
from app.services.tags_service import TagsService, serialize_tag_summaries
from app.utils.tagging import TAG_DOMAIN_PRIVATE_CONNECTION_USER
from app.core.sensitive_data import sanitize_error_detail

router = APIRouter(prefix="/connections", tags=["connections"])


_SENSITIVE_UPDATE_FIELDS = frozenset(
    {
        "provider_hint",
        "storage_endpoint_id",
        "credential_owner_type",
        "credential_owner_identifier",
        "endpoint_url",
        "region",
        "access_key_id",
        "secret_access_key",
        "force_path_style",
        "verify_tls",
    }
)


def _ensure_manual_private_connection_creation_allowed(db: Session, user: User) -> None:
    if EffectiveAccessService(db).resolve_user(user).can_create_manual_private_connections:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Manual private S3 connection creation is not allowed for this user",
    )


@router.get("", response_model=list[S3Connection])
def list_connections(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_account_user),
):
    service = S3ConnectionsService(db)
    return service.list_owned_private(user.id)


@router.get("/storage-endpoints", response_model=list[StorageEndpointPublic])
def list_private_connection_storage_endpoints(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_account_user),
) -> list[StorageEndpointPublic]:
    _ensure_manual_private_connection_creation_allowed(db, user)
    return [
        StorageEndpointPublic(
            id=endpoint.id,
            name=endpoint.name,
            endpoint_url=endpoint.endpoint_url,
            is_default=endpoint.is_default,
        )
        for endpoint in get_storage_endpoints_service(db).list_endpoints()
    ]


@router.get("/tag-definitions", response_model=TagDefinitionListResponse)
def list_private_connection_tag_definitions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_account_user),
) -> TagDefinitionListResponse:
    service = TagsService(db)
    return TagDefinitionListResponse(
        items=service.list_definitions(
            domain_kind=TAG_DOMAIN_PRIVATE_CONNECTION_USER,
            owner_user_id=user.id,
        )
    )


@router.post("/validate-credentials", response_model=S3ConnectionCredentialsValidationResult)
def validate_connection_credentials(
    payload: S3ConnectionCredentialsValidationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_account_user),
):
    _ensure_manual_private_connection_creation_allowed(db, user)
    service = S3ConnectionValidationService(db)
    try:
        return service.validate_credentials(payload, enforce_manual_endpoint_policy=True)
    except KeyError as exc:
        detail = exc.args[0] if exc.args else "Storage endpoint not found"
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc


@router.post("", response_model=S3Connection, status_code=status.HTTP_201_CREATED)
def create_connection(
    payload: S3ConnectionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_account_user),
):
    _ensure_manual_private_connection_creation_allowed(db, user)
    service = S3ConnectionsService(db)
    audit = AuditService(db)
    try:
        created = service.create(user.id, payload)
        audit.record_action(
            user=user,
            scope="browser",
            action="connection.create",
            entity_type="S3Connection",
            entity_id=created.id,
            metadata={
                "name": created.name,
                "endpoint_url": created.endpoint_url,
                "provider_hint": created.provider_hint,
                "is_shared": created.is_shared,
                "created_by_user_id": created.created_by_user_id,
                "access_manager": created.access_manager,
                "access_browser": created.access_browser,
                "can_manage_iam": bool((created.capabilities or {}).get("can_manage_iam", False)),
                "access_key_id": created.access_key_id,
                "tags": serialize_tag_summaries(created.tags),
            },
        )
        return created
    except StorageEndpointNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Storage endpoint not found",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc)))
    except Exception as exc:
        # Avoid leaking internal details or sensitive hints.
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to create S3Connection (invalid payload or duplicate name)",
        ) from exc


@router.put("/{connection_id}", response_model=S3Connection)
def update_connection(
    connection_id: int,
    payload: S3ConnectionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_account_user),
):
    service = S3ConnectionsService(db)
    audit = AuditService(db)
    try:
        service.get_owned(user.id, connection_id)
        if _SENSITIVE_UPDATE_FIELDS.intersection(payload.model_fields_set):
            _ensure_manual_private_connection_creation_allowed(db, user)
        updated = service.update(user.id, connection_id, payload)
        audit.record_action(
            user=user,
            scope="browser",
            action="connection.update",
            entity_type="S3Connection",
            entity_id=updated.id,
            metadata={
                "name": updated.name,
                "endpoint_url": updated.endpoint_url,
                "provider_hint": updated.provider_hint,
                "is_shared": updated.is_shared,
                "created_by_user_id": updated.created_by_user_id,
                "access_manager": updated.access_manager,
                "access_browser": updated.access_browser,
                "can_manage_iam": bool((updated.capabilities or {}).get("can_manage_iam", False)),
                "tags": serialize_tag_summaries(updated.tags),
            },
        )
        return updated
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
    except StorageEndpointNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Storage endpoint not found",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc)))


@router.put("/{connection_id}/credentials", response_model=S3Connection)
def rotate_connection_credentials(
    connection_id: int,
    payload: S3ConnectionCredentialsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_account_user),
):
    service = S3ConnectionsService(db)
    try:
        service.get_owned(user.id, connection_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found") from exc
    _ensure_manual_private_connection_creation_allowed(db, user)
    audit = AuditService(db)
    try:
        updated = service.update_credentials(
            user.id,
            connection_id,
            access_key_id=payload.access_key_id,
            secret_access_key=payload.secret_access_key,
        )
        audit.record_action(
            user=user,
            scope="browser",
            action="connection.rotate_credentials",
            entity_type="S3Connection",
            entity_id=updated.id,
            metadata={
                "name": updated.name,
                "endpoint_url": updated.endpoint_url,
                "provider_hint": updated.provider_hint,
                "access_key_id": updated.access_key_id,
            },
        )
        return updated
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=sanitize_error_detail(str(exc))) from exc


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connection(
    connection_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_account_user),
):
    service = S3ConnectionsService(db)
    audit = AuditService(db)
    try:
        if ManagedPrivateAccessService(db).delete_owned_connection(
            user=user,
            connection_id=connection_id,
        ):
            return None
        # Read minimal metadata for audit before deletion
        row = service.get_owned(user.id, connection_id)
        from app.utils.s3_connection_endpoint import resolve_connection_details

        details = resolve_connection_details(row)
        audit_meta = {
            "name": row.name,
            "endpoint_url": details.endpoint_url,
            "provider_hint": details.provider,
        }
        service.delete(user.id, connection_id)
        audit.record_action(
            user=user,
            scope="browser",
            action="connection.delete",
            entity_type="S3Connection",
            entity_id=connection_id,
            metadata=audit_meta,
        )
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
    except ManagedPrivateAccessCleanupPending as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=sanitize_error_detail({"message": str(exc), "provisioning_id": exc.provisioning_id}),
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=sanitize_error_detail(str(exc))) from exc
    return None


@router.get("/{connection_id}/capabilities", response_model=dict)
def get_connection_capabilities(
    connection_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_account_user),
):
    service = S3ConnectionsService(db)
    try:
        return service.get_capabilities(user.id, connection_id)
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
