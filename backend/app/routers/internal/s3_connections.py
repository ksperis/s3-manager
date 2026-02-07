# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Connection, StorageEndpoint
from app.routers.dependencies import require_internal_cron_token
from app.services.rgw_admin import RGWAdminError, get_rgw_admin_client
from app.utils.storage_endpoint_features import resolve_admin_endpoint

router = APIRouter(prefix="/internal/s3-connections", tags=["internal-s3-connections"])
logger = logging.getLogger(__name__)


@router.post("/cleanup")
def cleanup_temporary_connections(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    now = datetime.utcnow()
    rows = (
        db.query(S3Connection)
        .filter(S3Connection.is_temporary.is_(True))
        .filter(S3Connection.expires_at.isnot(None))
        .filter(S3Connection.expires_at <= now)
        .all()
    )
    deleted = 0
    for conn in rows:
        if conn.temp_user_uid and conn.temp_access_key_id and conn.storage_endpoint_id:
            endpoint = conn.storage_endpoint or (
                db.query(StorageEndpoint).filter(StorageEndpoint.id == conn.storage_endpoint_id).first()
            )
            if endpoint:
                admin_endpoint = resolve_admin_endpoint(endpoint)
                if admin_endpoint and endpoint.admin_access_key and endpoint.admin_secret_key:
                    try:
                        admin = get_rgw_admin_client(
                            access_key=endpoint.admin_access_key,
                            secret_key=endpoint.admin_secret_key,
                            endpoint=admin_endpoint,
                            region=endpoint.region,
                        )
                        admin.delete_access_key(conn.temp_user_uid, conn.temp_access_key_id, tenant=None)
                    except RGWAdminError as exc:
                        logger.warning(
                            "Failed to delete temp access key %s for %s: %s",
                            conn.temp_access_key_id,
                            conn.temp_user_uid,
                            exc,
                        )
        db.delete(conn)
        deleted += 1
    if deleted:
        db.commit()
    return {"expired": len(rows), "deleted": deleted}
