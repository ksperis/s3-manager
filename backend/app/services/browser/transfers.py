# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import os
import re
from typing import Optional
from urllib.parse import unquote

from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import get_settings
from app.models.browser import BrowserStsCredentials, SseCustomerContext, StsStatus
from app.services.s3_execution_context import S3ExecutionTarget
from ._shared import _resolve_endpoint
from .sts import BrowserStsRequestError, request_browser_sts_session

settings = get_settings()


class BrowserTransfersMixin:
    def check_sts(self, account: S3ExecutionTarget) -> StsStatus:
        try:
            request_browser_sts_session(account)
        except RuntimeError as exc:
            return StsStatus(available=False, error=str(exc))
        return StsStatus(available=True)

    def get_sts_credentials(self, account: S3ExecutionTarget) -> BrowserStsCredentials:
        try:
            session = request_browser_sts_session(account)
        except BrowserStsRequestError as exc:
            raise RuntimeError(f"Unable to request STS credentials: {exc}") from exc
        credentials = session.credentials
        return BrowserStsCredentials(
            access_key_id=credentials.access_key_id,
            secret_access_key=credentials.secret_access_key,
            session_token=credentials.session_token,
            expiration=credentials.expiration,
            endpoint=_resolve_endpoint(account),
            region=session.region or settings.seed_s3_region,
        )

    def proxy_upload(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        key: str,
        file_obj,
        content_type: Optional[str],
        sse_customer: Optional[SseCustomerContext] = None,
    ) -> None:
        client = self._client(account, request_profile="long_running")
        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type
        extra_args.update(self._sse_customer_params(sse_customer))
        try:
            file_obj.seek(0)
            if extra_args:
                client.upload_fileobj(file_obj, bucket_name, key, ExtraArgs=extra_args)
            else:
                client.upload_fileobj(file_obj, bucket_name, key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to upload '{key}': {exc}") from exc
        self.invalidate_object_list_cache_for_account(account, bucket_name)

    def upload_via_proxy(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        file,
        *,
        key: str,
        content_type: Optional[str],
        sse_customer: Optional[SseCustomerContext] = None,
    ) -> None:
        file_obj = getattr(file, "file", file)
        resolved_content_type = content_type or getattr(file, "content_type", None) or "application/octet-stream"
        self.proxy_upload(bucket_name, account, key, file_obj, resolved_content_type, sse_customer=sse_customer)

    def _filename_from_content_disposition(self, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        extended_match = re.search(r"filename\*\s*=\s*([^;]+)", value, re.IGNORECASE)
        if extended_match:
            raw = extended_match.group(1).strip().strip('"')
            if "''" in raw:
                _, encoded = raw.split("''", 1)
            else:
                encoded = raw
            resolved = unquote(encoded)
            candidate = os.path.basename(resolved)
            if candidate:
                return candidate
        basic_match = re.search(r"filename\s*=\s*\"?([^\";]+)\"?", value, re.IGNORECASE)
        if basic_match:
            candidate = os.path.basename(basic_match.group(1).strip())
            if candidate:
                return candidate
        return None

    def download_object(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        key: str,
        *,
        version_id: Optional[str] = None,
        sse_customer: Optional[SseCustomerContext] = None,
    ):
        client = self._client(account, request_profile="long_running")
        kwargs = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        kwargs.update(self._sse_customer_params(sse_customer))
        try:
            resp = client.get_object(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to download '{key}': {exc}") from exc
        body = resp.get("Body")
        if not body:
            raise RuntimeError(f"Unable to download '{key}': empty response body")
        stream = body.iter_chunks(chunk_size=1024 * 1024) if hasattr(body, "iter_chunks") else body
        content_type = resp.get("ContentType")
        filename = self._filename_from_content_disposition(resp.get("ContentDisposition"))
        if not filename:
            filename = os.path.basename(key) or key or "download"
        return stream, content_type, filename
