# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from typing import Optional

from sqlalchemy.orm import Session

from app.db.s3_connection import S3Connection as DBS3Connection
from app.db.storage_endpoint import StorageEndpoint
from app.models.s3_connection import (
    S3_CONNECTION_CUSTOM_ENDPOINT_FIELDS,
    S3ConnectionCreate,
    S3ConnectionUpdate,
)
from app.models.s3_connection_admin import (
    S3ConnectionAdminCreate,
    S3ConnectionAdminUpdate,
)
from app.utils.s3_connection_endpoint import (
    build_custom_endpoint_config,
    custom_endpoint_update_base,
)
from app.utils.s3_endpoint import validate_user_supplied_s3_endpoint


class StorageEndpointNotFoundError(ValueError):
    pass


class S3ConnectionEndpointPlanner:
    """Resolve one canonical managed or custom endpoint before persistence."""

    def __init__(self, db: Session):
        self.db = db

    def plan(
        self,
        row: Optional[DBS3Connection],
        payload: (
            S3ConnectionCreate
            | S3ConnectionUpdate
            | S3ConnectionAdminCreate
            | S3ConnectionAdminUpdate
        ),
        *,
        enforce_manual_endpoint_policy: bool,
    ) -> tuple[Optional[int], Optional[str]]:
        fields_set = payload.model_fields_set
        if "storage_endpoint_id" in fields_set:
            desired_endpoint_id = payload.storage_endpoint_id
        elif row is not None:
            desired_endpoint_id = row.storage_endpoint_id
        else:
            desired_endpoint_id = None
        custom_fields = S3_CONNECTION_CUSTOM_ENDPOINT_FIELDS & fields_set
        if desired_endpoint_id is not None:
            if custom_fields:
                raise ValueError(
                    "Custom endpoint fields cannot be combined with a managed storage endpoint"
                )
            endpoint = (
                self.db.query(StorageEndpoint)
                .filter(StorageEndpoint.id == desired_endpoint_id)
                .first()
            )
            if endpoint is None:
                raise StorageEndpointNotFoundError("Storage endpoint not found")
            return desired_endpoint_id, None

        if row is not None and row.storage_endpoint_id is None:
            current = custom_endpoint_update_base(row.custom_endpoint_config)
        else:
            current = custom_endpoint_update_base(None)
        endpoint_url = (
            payload.endpoint_url
            if "endpoint_url" in fields_set
            else current.endpoint_url
        )
        region = payload.region if "region" in fields_set else current.region
        force_path_style = (
            payload.force_path_style
            if "force_path_style" in fields_set
            else current.force_path_style
        )
        verify_tls = (
            payload.verify_tls
            if "verify_tls" in fields_set
            else current.verify_tls
        )
        provider = (
            payload.provider_hint
            if "provider_hint" in fields_set
            else current.provider
        )
        if force_path_style is None or verify_tls is None:
            raise ValueError(
                "force_path_style and verify_tls cannot be null for a custom endpoint"
            )
        normalized_endpoint_url = endpoint_url or ""
        if enforce_manual_endpoint_policy:
            normalized_endpoint_url = self._validate_manual_endpoint(
                normalized_endpoint_url,
                verify_tls,
            )
        return None, build_custom_endpoint_config(
            normalized_endpoint_url,
            region,
            force_path_style,
            verify_tls,
            provider,
        )

    @staticmethod
    def _validate_manual_endpoint(
        endpoint_url: Optional[str],
        verify_tls: bool,
    ) -> str:
        normalized = (endpoint_url or "").strip()
        if not normalized:
            raise ValueError("Endpoint URL is required.")
        if not verify_tls:
            raise ValueError("Manual private connections require TLS verification.")
        return validate_user_supplied_s3_endpoint(
            normalized,
            field_name="Endpoint URL",
        )
