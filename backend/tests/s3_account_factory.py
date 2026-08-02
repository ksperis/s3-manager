# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from typing import Any

from sqlalchemy.orm import Session

from app.db import S3Account, StorageEndpoint, StorageProvider


def make_s3_account(db: Session, **values: Any) -> S3Account:
    """Build a persisted-account fixture with an explicit, valid endpoint."""
    if values.get("storage_endpoint_id") is None and values.get("storage_endpoint") is None:
        values.pop("storage_endpoint", None)
        endpoint = (
            db.query(StorageEndpoint)
            .filter(StorageEndpoint.is_default.is_(True))
            .order_by(StorageEndpoint.id.asc())
            .first()
        )
        if endpoint is None:
            endpoint = StorageEndpoint(
                name="test-default-ceph",
                endpoint_url="https://s3.test.invalid",
                provider=StorageProvider.CEPH.value,
                admin_access_key="TEST-ADMIN-AK",
                admin_secret_key="TEST-ADMIN-SK",
                features_config=(
                    "features:\n"
                    "  admin:\n    enabled: true\n"
                    "  account:\n    enabled: true\n"
                    "  usage:\n    enabled: true\n"
                    "  metrics:\n    enabled: true\n"
                ),
                is_default=True,
                is_editable=True,
            )
            db.add(endpoint)
            db.flush()
        values["storage_endpoint_id"] = endpoint.id
    return S3Account(**values)
