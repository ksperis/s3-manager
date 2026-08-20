# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import List, Optional
import logging
from io import BytesIO

from botocore.exceptions import BotoCoreError, ClientError

from app.services.s3_execution_context import S3ExecutionTarget
from app.models.object import ListObjectsResponse, S3Object
from app.services.s3_client import get_s3_client
from app.services.s3_execution_client import (
    require_s3_execution_credentials,
    s3_execution_client_kwargs,
)

logger = logging.getLogger(__name__)


class ObjectsService:
    def _client(self, account: S3ExecutionTarget):
        access_key, secret_key = require_s3_execution_credentials(
            account,
            error_message="Execution context credentials are missing",
        )
        client_options = s3_execution_client_kwargs(account)
        return get_s3_client(
            access_key,
            secret_key,
            request_profile="long_running",
            **client_options,
        )

    def list_objects(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        prefix: str = "",
        continuation_token: Optional[str] = None,
        max_keys: int = 1000,
    ) -> ListObjectsResponse:
        client = self._client(account)
        kwargs = {
            "Bucket": bucket_name,
            "Prefix": prefix or "",
            "Delimiter": "/",
            "MaxKeys": max_keys,
        }
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token

        try:
            resp = client.list_objects_v2(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list objects for '{bucket_name}': {exc}") from exc

        objects: List[S3Object] = []
        for obj in resp.get("Contents", []):
            key = obj.get("Key")
            if not key:
                continue
            # Skip folder markers (prefix itself)
            if prefix and key.rstrip("/") == prefix.rstrip("/") and obj.get("Size", 0) == 0:
                continue
            objects.append(
                S3Object(
                    key=key,
                    size=int(obj.get("Size") or 0),
                    last_modified=obj.get("LastModified"),
                    storage_class=obj.get("StorageClass"),
                )
            )

        prefixes = [p.get("Prefix") for p in resp.get("CommonPrefixes", []) if p.get("Prefix")]

        return ListObjectsResponse(
            prefix=prefix,
            objects=objects,
            prefixes=prefixes,
            is_truncated=bool(resp.get("IsTruncated")),
            next_continuation_token=resp.get("NextContinuationToken"),
        )

    def upload_object(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        key: str,
        file_obj,
        content_type: Optional[str] = None,
    ) -> None:
        client = self._client(account)
        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type
        stream = file_obj if hasattr(file_obj, "read") else BytesIO(file_obj)
        try:
            client.upload_fileobj(stream, bucket_name, key, ExtraArgs=extra_args or None)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to upload object '{key}' in bucket '{bucket_name}': {exc}") from exc
        logger.debug("Uploaded object %s to bucket %s", key, bucket_name)

def get_objects_service() -> ObjectsService:
    return ObjectsService()
