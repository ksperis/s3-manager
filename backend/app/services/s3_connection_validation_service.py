# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy.orm import Session

from app.db import StorageEndpoint
from app.models.s3_connection import (
    S3ConnectionCredentialsValidationRequest,
    S3ConnectionCredentialsValidationResult,
)
from app.services import s3_client
from app.utils.s3_endpoint import validate_user_supplied_s3_endpoint

AUTH_ERROR_CODES = {
    "InvalidAccessKeyId",
    "SignatureDoesNotMatch",
    "InvalidToken",
    "ExpiredToken",
    "AuthFailure",
}


class S3ConnectionValidationService:
    def __init__(self, db: Session):
        self.db = db

    def validate_credentials(
        self,
        payload: S3ConnectionCredentialsValidationRequest,
        *,
        enforce_manual_endpoint_policy: bool = False,
    ) -> S3ConnectionCredentialsValidationResult:
        access_key_id = payload.access_key_id.strip()
        secret_access_key = payload.secret_access_key.strip()
        if not access_key_id or not secret_access_key:
            raise ValueError("Access key and secret key are required.")

        endpoint_url, region, force_path_style, verify_tls = self._resolve_target(
            payload,
            enforce_manual_endpoint_policy=enforce_manual_endpoint_policy,
        )
        try:
            client = s3_client.get_s3_client(
                access_key=access_key_id,
                secret_key=secret_access_key,
                endpoint=endpoint_url,
                region=region,
                force_path_style=force_path_style,
                verify_tls=verify_tls,
            )
            client.list_buckets()
            return S3ConnectionCredentialsValidationResult(
                ok=True,
                severity="success",
                code=None,
                message="Credentials validated.",
            )
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code") or "").strip()
            if code == "AccessDenied":
                return S3ConnectionCredentialsValidationResult(
                    ok=True,
                    severity="warning",
                    code=code,
                    message="Credentials are valid but permissions are limited (AccessDenied).",
                )
            if code in AUTH_ERROR_CODES:
                return S3ConnectionCredentialsValidationResult(
                    ok=False,
                    severity="error",
                    code=code,
                    message="Invalid S3 credentials.",
                )
            return S3ConnectionCredentialsValidationResult(
                ok=False,
                severity="error",
                code=code or None,
                message="Unable to validate credentials on this endpoint.",
            )
        except (BotoCoreError, RuntimeError):
            return S3ConnectionCredentialsValidationResult(
                ok=False,
                severity="error",
                code="EndpointConnectionError",
                message="Unable to reach the S3 endpoint (network/TLS/endpoint issue).",
            )

    def _resolve_target(
        self,
        payload: S3ConnectionCredentialsValidationRequest,
        *,
        enforce_manual_endpoint_policy: bool,
    ) -> tuple[str, str | None, bool, bool]:
        if payload.storage_endpoint_id is not None:
            endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == payload.storage_endpoint_id).first()
            if not endpoint:
                raise KeyError("Storage endpoint not found")
            endpoint_url = (endpoint.endpoint_url or "").strip().rstrip("/")
            if not endpoint_url:
                raise ValueError("Endpoint URL is required.")
            return endpoint_url, endpoint.region, bool(getattr(endpoint, "force_path_style", False)), True

        endpoint_url = (payload.endpoint_url or "").strip().rstrip("/")
        if not endpoint_url:
            raise ValueError("Endpoint URL is required.")
        if enforce_manual_endpoint_policy:
            if not bool(payload.verify_tls):
                raise ValueError("Manual endpoint validation requires TLS verification.")
            endpoint_url = validate_user_supplied_s3_endpoint(endpoint_url, field_name="Endpoint URL")
        return endpoint_url, payload.region, bool(payload.force_path_style), bool(payload.verify_tls)
