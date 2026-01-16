# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.s3_connection import S3Connection, S3ConnectionCreate, S3ConnectionUpdate
from app.routers.dependencies import get_current_user
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
    service = S3ConnectionsService(db)
    try:
        return service.create(user.id, payload)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.put("/{connection_id}", response_model=S3Connection)

def update_connection(
    connection_id: int,
    payload: S3ConnectionUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    service = S3ConnectionsService(db)
    try:
        return service.update(user.id, connection_id, payload)
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)

def delete_connection(
    connection_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    service = S3ConnectionsService(db)
    try:
        service.delete(user.id, connection_id)
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
