# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.s3_connection import (
    S3Connection,
    S3ConnectionCreate,
    S3ConnectionCredentialsUpdate,
    S3ConnectionUpdate,
)
from app.routers.dependencies import get_current_user
from app.services.audit_service import AuditService
from app.services.s3_connections_service import S3ConnectionsService

router = APIRouter(prefix="/connections", tags=["connections"])


@router.get("", response_model=list[S3Connection])

def list_connections(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    service = S3ConnectionsService(db)
    return service.list_for_user(user.id)


@router.post("", response_model=S3Connection, status_code=status.HTTP_201_CREATED)

def create_connection(
    payload: S3ConnectionCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if payload.is_public:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Public connections must be created by an admin")
    if payload.storage_endpoint_id is None and not (payload.endpoint_url or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Endpoint URL is required for manual connections")
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
                "access_key_id": created.access_key_id,
            },
        )
        return created
    except Exception as exc:
        # Avoid leaking internal details or sensitive hints.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to create S3Connection (invalid payload or duplicate name)",
        ) from exc


@router.put("/{connection_id}", response_model=S3Connection)

def update_connection(
    connection_id: int,
    payload: S3ConnectionUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if payload.is_public is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Public connections can only be managed by an admin")
    service = S3ConnectionsService(db)
    audit = AuditService(db)
    try:
        payload_data = payload.model_dump(exclude_unset=True)
        if "storage_endpoint_id" in payload_data and payload.storage_endpoint_id is None and payload.endpoint_url is None:
            from app.utils.s3_connection_endpoint import resolve_connection_details

            existing = service.get_owned(user.id, connection_id)
            if not resolve_connection_details(existing).endpoint_url:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Endpoint URL is required for manual connections")
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
            },
        )
        return updated
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")


@router.put("/{connection_id}/credentials", response_model=S3Connection)

def rotate_connection_credentials(
    connection_id: int,
    payload: S3ConnectionCredentialsUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    service = S3ConnectionsService(db)
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


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)

def delete_connection(
    connection_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    service = S3ConnectionsService(db)
    audit = AuditService(db)
    try:
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
    return None


@router.get("/{connection_id}/capabilities", response_model=dict)

def get_connection_capabilities(
    connection_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    service = S3ConnectionsService(db)
    try:
        return service.get_capabilities(user.id, connection_id)
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
