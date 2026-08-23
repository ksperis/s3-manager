# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from collections.abc import Callable
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from app.db import StorageEndpoint
from app.models.storage_endpoint import (
    StorageEndpointFeatureDetectionRequest,
    StorageEndpointFeatureDetectionResult,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.utils.normalize import normalize_optional_string
from app.utils.s3_endpoint import normalize_s3_endpoint

RGWAdminClientFactory = Callable[..., RGWAdminClient]


@dataclass(frozen=True)
class _FeatureDetectionCredentials:
    access_key: Optional[str]
    secret_key: Optional[str]

    @property
    def complete(self) -> bool:
        return bool(self.access_key and self.secret_key)

    @property
    def partial(self) -> bool:
        return bool(self.access_key or self.secret_key) and not self.complete


@dataclass(frozen=True)
class _FeatureDetectionContext:
    admin_endpoint: str
    region: Optional[str]
    verify_tls: bool
    admin_credentials: _FeatureDetectionCredentials
    supervision_credentials: _FeatureDetectionCredentials


class StorageEndpointFeatureDetector:
    def __init__(
        self,
        db: Session,
        client_factory: RGWAdminClientFactory,
    ) -> None:
        self.db = db
        self.client_factory = client_factory

    @staticmethod
    def _credentials(
        access_key: Optional[str],
        secret_key: Optional[str],
        *,
        stored_access_key: Optional[str] = None,
        stored_secret_key: Optional[str] = None,
    ) -> _FeatureDetectionCredentials:
        normalized_access_key = normalize_optional_string(access_key)
        normalized_secret_key = normalize_optional_string(secret_key)
        if (
            normalized_access_key
            and not normalized_secret_key
            and normalized_access_key == (stored_access_key or "")
        ):
            normalized_secret_key = stored_secret_key
        return _FeatureDetectionCredentials(
            normalized_access_key,
            normalized_secret_key,
        )

    def _context(
        self,
        payload: StorageEndpointFeatureDetectionRequest,
    ) -> _FeatureDetectionContext:
        endpoint_url = normalize_s3_endpoint(payload.endpoint_url)
        if not endpoint_url:
            raise ValueError("Endpoint URL is required.")

        stored_endpoint: Optional[StorageEndpoint] = None
        if payload.endpoint_id is not None:
            stored_endpoint = (
                self.db.query(StorageEndpoint)
                .filter(StorageEndpoint.id == payload.endpoint_id)
                .first()
            )
            if not stored_endpoint:
                raise ValueError("Endpoint not found.")

        region = normalize_optional_string(payload.region) or (
            stored_endpoint.region if stored_endpoint else None
        )
        admin_endpoint = normalize_s3_endpoint(payload.admin_endpoint) or endpoint_url
        if payload.verify_tls is not None:
            verify_tls = bool(payload.verify_tls)
        elif stored_endpoint is not None:
            verify_tls = bool(getattr(stored_endpoint, "verify_tls", True))
        else:
            verify_tls = True

        admin_credentials = self._credentials(
            payload.admin_access_key,
            payload.admin_secret_key,
            stored_access_key=(
                stored_endpoint.admin_access_key if stored_endpoint else None
            ),
            stored_secret_key=(
                stored_endpoint.admin_secret_key if stored_endpoint else None
            ),
        )
        supervision_credentials = self._credentials(
            payload.supervision_access_key,
            payload.supervision_secret_key,
            stored_access_key=(
                stored_endpoint.supervision_access_key if stored_endpoint else None
            ),
            stored_secret_key=(
                stored_endpoint.supervision_secret_key if stored_endpoint else None
            ),
        )
        return _FeatureDetectionContext(
            admin_endpoint=admin_endpoint,
            region=region,
            verify_tls=verify_tls,
            admin_credentials=admin_credentials,
            supervision_credentials=supervision_credentials,
        )

    def _client(
        self,
        context: _FeatureDetectionContext,
        credentials: _FeatureDetectionCredentials,
    ) -> RGWAdminClient:
        return self.client_factory(
            access_key=credentials.access_key,
            secret_key=credentials.secret_key,
            endpoint=context.admin_endpoint,
            region=context.region,
            verify_tls=context.verify_tls,
        )

    def _detect_admin_features(
        self,
        context: _FeatureDetectionContext,
        result: StorageEndpointFeatureDetectionResult,
    ) -> Optional[RGWAdminClient]:
        credentials = context.admin_credentials
        admin_client = None
        if credentials.complete:
            try:
                admin_client = self._client(context, credentials)
                admin_payload = admin_client.get_user_by_access_key(
                    credentials.access_key,
                    allow_not_found=True,
                )
                if admin_payload:
                    result.admin = True
                else:
                    result.admin_error = "Admin access key is not recognized by RGW."
            except RGWAdminError as exc:
                result.admin_error = str(exc)
        elif credentials.partial:
            result.admin_error = (
                "Admin detection requires both access key and secret key."
            )
        return admin_client

    @staticmethod
    def _detect_account_feature(
        admin_client: Optional[RGWAdminClient],
        result: StorageEndpointFeatureDetectionResult,
    ) -> None:
        if admin_client is None:
            return
        try:
            # A not_found result still proves that the RGW account API exists.
            admin_client.get_account(
                "RGW00000000000000000",
                allow_not_found=True,
                allow_not_implemented=True,
            )
            result.account = admin_client.account_api_supported is True
            if not result.account:
                result.account_error = "RGW account API is unavailable."
        except RGWAdminError as exc:
            result.account_error = str(exc)

    def _detect_supervision_features(
        self,
        context: _FeatureDetectionContext,
        result: StorageEndpointFeatureDetectionResult,
    ) -> None:
        credentials = context.supervision_credentials
        if credentials.partial:
            message = "Supervision detection requires both access key and secret key."
            result.metrics_error = message
            result.usage_error = message
            return
        if not credentials.complete:
            return

        supervision_client = None
        try:
            supervision_client = self._client(context, credentials)
            supervision_client.get_all_buckets(with_stats=False)
            result.metrics = True
        except RGWAdminError as exc:
            result.metrics_error = str(exc)

        if supervision_client is None:
            return
        try:
            usage_payload = supervision_client.get_usage(
                show_entries=False,
                show_summary=False,
            )
            if isinstance(usage_payload, dict) and usage_payload.get("not_found"):
                result.usage_error = "RGW usage logs endpoint is unavailable."
            else:
                result.usage = True
        except RGWAdminError as exc:
            result.usage_error = str(exc)

    def detect(
        self,
        payload: StorageEndpointFeatureDetectionRequest,
    ) -> StorageEndpointFeatureDetectionResult:
        context = self._context(payload)
        result = StorageEndpointFeatureDetectionResult()
        admin_client = self._detect_admin_features(context, result)
        self._detect_account_feature(admin_client, result)
        self._detect_supervision_features(context, result)

        if result.metrics and not result.usage:
            result.warnings.append(
                "Usage logs do not appear enabled on this RGW endpoint; activity traffic stats will not be available."
            )
        return result
