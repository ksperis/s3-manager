# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import List, Optional
import logging
from io import BytesIO

from botocore.exceptions import BotoCoreError, ClientError

from app.db import S3Account
from app.models.object import ListObjectsResponse, S3Object
from app.services.s3_client import _delete_objects, get_s3_client
from app.utils.s3_endpoint import resolve_s3_client_options

logger = logging.getLogger(__name__)


class ObjectsService:
    def _client(self, account: S3Account):
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3Account root keys missing")
        endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(account)
        return get_s3_client(
            access_key,
            secret_key,
            endpoint=endpoint,
            region=region,
            force_path_style=force_path_style,
            verify_tls=verify_tls,
        )

    def list_objects(
        self,
        bucket_name: str,
        account: S3Account,
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

    def create_folder(self, bucket_name: str, account: S3Account, folder_prefix: str) -> None:
        client = self._client(account)
        key = folder_prefix if folder_prefix.endswith("/") else f"{folder_prefix}/"
        try:
            client.put_object(Bucket=bucket_name, Key=key, Body=b"")
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to create folder '{key}' in bucket '{bucket_name}': {exc}") from exc
        logger.debug("Created folder %s in bucket %s", key, bucket_name)

    def delete_objects(self, bucket_name: str, account: S3Account, keys: List[str]) -> None:
        if not keys:
            return
        client = self._client(account)
        try:
            _delete_objects(client, bucket_name, [{"Key": key} for key in keys])
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to delete objects in bucket '{bucket_name}': {exc}") from exc
        logger.debug("Deleted %s objects from bucket %s", len(keys), bucket_name)

    def upload_object(
        self,
        bucket_name: str,
        account: S3Account,
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

    def generate_download_url(
        self,
        bucket_name: str,
        account: S3Account,
        key: str,
        expires_in: int = 300,
    ) -> str:
        client = self._client(account)
        try:
            return client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket_name, "Key": key},
                ExpiresIn=expires_in,
            )
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to generate download URL for '{key}': {exc}") from exc


def get_objects_service() -> ObjectsService:
    return ObjectsService()
