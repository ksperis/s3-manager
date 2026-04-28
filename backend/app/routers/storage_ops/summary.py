# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Connection, User
from app.models.storage_ops import StorageOpsSummary
from app.routers.dependencies import get_current_storage_ops_admin
from app.routers.execution_contexts import list_execution_contexts

router = APIRouter(prefix="/storage-ops", tags=["storage-ops"])


def _connection_id_from_context_id(context_id: str) -> int | None:
    if not context_id.startswith("conn-"):
        return None
    suffix = context_id.removeprefix("conn-")
    return int(suffix) if suffix.isdigit() else None


def build_storage_ops_summary(*, user: User, db: Session) -> StorageOpsSummary:
    contexts = list_execution_contexts(workspace="manager", user=user, db=db)
    seen_context_ids: set[str] = set()
    account_count = 0
    s3_user_count = 0
    connection_ids: set[int] = set()
    endpoint_ids: set[int] = set()
    endpoint_names: set[str] = set()

    for context in contexts:
        if context.kind not in {"account", "connection", "legacy_user"}:
            continue
        if context.id in seen_context_ids:
            continue
        seen_context_ids.add(context.id)
        if context.endpoint_id is not None:
            endpoint_ids.add(context.endpoint_id)
        elif context.endpoint_name:
            endpoint_names.add(context.endpoint_name)
        if context.kind == "account":
            account_count += 1
            continue
        if context.kind == "legacy_user":
            s3_user_count += 1
            continue
        connection_id = _connection_id_from_context_id(context.id)
        if connection_id is not None:
            connection_ids.add(connection_id)

    shared_connection_count = 0
    if connection_ids:
        rows = (
            db.query(S3Connection.id, S3Connection.is_shared)
            .filter(S3Connection.id.in_(connection_ids))
            .all()
        )
        shared_connection_count = sum(1 for _connection_id, is_shared in rows if is_shared)

    connection_count = len(connection_ids)
    return StorageOpsSummary(
        total_contexts=account_count + s3_user_count + connection_count,
        total_accounts=account_count,
        total_s3_users=s3_user_count,
        total_connections=connection_count,
        total_shared_connections=shared_connection_count,
        total_private_connections=max(connection_count - shared_connection_count, 0),
        total_endpoints=len(endpoint_ids) + len(endpoint_names),
    )


@router.get("/summary", response_model=StorageOpsSummary)
def storage_ops_summary(
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
) -> StorageOpsSummary:
    return build_storage_ops_summary(user=user, db=db)
