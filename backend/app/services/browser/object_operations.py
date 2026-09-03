# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional
from urllib.parse import urlencode

from botocore.exceptions import BotoCoreError, ClientError

from app.models.browser import (
    CompleteMultipartUploadRequest,
    CopyObjectPayload,
    DeleteObjectsPayload,
    ListMultipartUploadsResponse,
    MultipartUploadInitRequest,
    MultipartUploadInitResponse,
    MultipartUploadItem,
    PresignPartRequest,
    PresignPartResponse,
    PresignRequest,
    PresignedUrl,
    SseCustomerContext,
)
from app.services.s3_deletion import delete_objects
from app.services.s3_execution_context import S3ExecutionTarget


class BrowserObjectOperationsMixin:
    def presign(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        payload: PresignRequest,
        sse_customer: Optional[SseCustomerContext] = None,
    ) -> PresignedUrl:
        client = self._client(account)
        expires = payload.expires_in or 900
        params = {"Bucket": bucket_name, "Key": payload.key}
        params.update(self._sse_customer_params(sse_customer))
        headers: dict[str, str] = self._sse_customer_headers(sse_customer)
        if payload.version_id:
            params["VersionId"] = payload.version_id
        if payload.response_content_disposition:
            params["ResponseContentDisposition"] = payload.response_content_disposition
        try:
            if payload.operation == "get_object":
                url = client.generate_presigned_url(
                    "get_object",
                    Params=params,
                    ExpiresIn=expires,
                )
                return PresignedUrl(url=url, method="GET", expires_in=expires, headers=headers)
            if payload.operation == "delete_object":
                url = client.generate_presigned_url(
                    "delete_object",
                    Params=params,
                    ExpiresIn=expires,
                )
                return PresignedUrl(url=url, method="DELETE", expires_in=expires, headers=headers)
            if payload.operation == "put_object":
                if payload.content_type:
                    headers["Content-Type"] = payload.content_type
                url = client.generate_presigned_url(
                    "put_object",
                    Params=params,
                    ExpiresIn=expires,
                )
                return PresignedUrl(url=url, method="PUT", expires_in=expires, headers=headers)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to generate presigned URL for '{payload.operation}': {exc}") from exc
        raise RuntimeError("Unsupported presign operation")

    def copy_object(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        payload: CopyObjectPayload,
    ) -> None:
        client = self._client(account, request_profile="long_running")
        source_bucket = payload.source_bucket or bucket_name
        copy_source: dict[str, str] = {
            "Bucket": source_bucket,
            "Key": payload.source_key,
        }
        if payload.source_version_id:
            copy_source["VersionId"] = payload.source_version_id
        kwargs = {
            "Bucket": bucket_name,
            "Key": payload.destination_key,
            "CopySource": copy_source,
        }
        if payload.replace_metadata:
            source_head_kwargs = {"Bucket": source_bucket, "Key": payload.source_key}
            if payload.source_version_id:
                source_head_kwargs["VersionId"] = payload.source_version_id
            try:
                source_head = client.head_object(**source_head_kwargs)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(
                    f"Unable to fetch metadata for '{payload.source_key}' before copy: {exc}"
                ) from exc
            kwargs["MetadataDirective"] = "REPLACE"
            kwargs["Metadata"] = payload.metadata or {}
            for source_field, target_field in (
                ("ContentType", "ContentType"),
                ("CacheControl", "CacheControl"),
                ("ContentDisposition", "ContentDisposition"),
                ("ContentEncoding", "ContentEncoding"),
                ("ContentLanguage", "ContentLanguage"),
                ("Expires", "Expires"),
                ("StorageClass", "StorageClass"),
            ):
                value = source_head.get(source_field)
                if value is not None:
                    kwargs[target_field] = value
        if payload.replace_tags:
            tag_str = urlencode({tag.key: tag.value for tag in payload.tags if tag.key})
            kwargs["TaggingDirective"] = "REPLACE"
            if tag_str:
                kwargs["Tagging"] = tag_str
        if payload.acl:
            kwargs["ACL"] = payload.acl
        try:
            resp = client.copy_object(**kwargs)
            destination_version_id = resp.get("VersionId")
            if payload.replace_tags:
                tagging_kwargs: dict[str, object] = {
                    "Bucket": bucket_name,
                    "Key": payload.destination_key,
                }
                if destination_version_id:
                    tagging_kwargs["VersionId"] = destination_version_id
                tag_set = [
                    {"Key": tag.key, "Value": tag.value}
                    for tag in payload.tags
                    if tag.key is not None and str(tag.key).strip()
                ]
                if tag_set:
                    client.put_object_tagging(**tagging_kwargs, Tagging={"TagSet": tag_set})
                else:
                    client.delete_object_tagging(**tagging_kwargs)
            if payload.move:
                source_head_kwargs = {"Bucket": source_bucket, "Key": payload.source_key}
                if payload.source_version_id:
                    source_head_kwargs["VersionId"] = payload.source_version_id
                source_head = client.head_object(**source_head_kwargs)
                destination_head_kwargs = {"Bucket": bucket_name, "Key": payload.destination_key}
                if destination_version_id:
                    destination_head_kwargs["VersionId"] = destination_version_id
                destination_head = client.head_object(**destination_head_kwargs)
                source_etag = self._clean_etag(source_head.get("ETag"))
                destination_etag = self._clean_etag(destination_head.get("ETag"))
                source_size = int(source_head.get("ContentLength") or 0)
                destination_size = int(destination_head.get("ContentLength") or 0)
                if source_size != destination_size:
                    raise RuntimeError("Copy verification failed (size mismatch).")
                if not source_etag or not destination_etag:
                    raise RuntimeError("Copy verification failed (missing ETag).")
                if source_etag != destination_etag:
                    raise RuntimeError("Copy verification failed (ETag mismatch).")
                delete_kwargs = {"Bucket": source_bucket, "Key": payload.source_key}
                if payload.source_version_id:
                    delete_kwargs["VersionId"] = payload.source_version_id
                client.delete_object(**delete_kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to copy object '{payload.source_key}' -> '{payload.destination_key}': {exc}") from exc
        self.invalidate_object_list_cache_for_account(account, bucket_name)
        if source_bucket != bucket_name or payload.move:
            self.invalidate_object_list_cache_for_account(account, source_bucket)

    def delete_objects(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        payload: DeleteObjectsPayload,
    ) -> int:
        if not payload.objects:
            return 0
        items: list[dict] = []
        for obj in payload.objects:
            if not obj.key:
                continue
            entry = {"Key": obj.key}
            if obj.version_id:
                entry["VersionId"] = obj.version_id
            items.append(entry)
        if not items:
            return 0
        client = self._client(account)
        try:
            delete_objects(client, bucket_name, items)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to delete objects in bucket '{bucket_name}': {exc}") from exc
        self.invalidate_object_list_cache_for_account(account, bucket_name)
        return len(items)

    def create_folder(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        prefix: str,
    ) -> None:
        client = self._client(account)
        key = prefix if prefix.endswith("/") else f"{prefix}/"
        try:
            client.put_object(Bucket=bucket_name, Key=key, Body=b"")
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to create folder '{key}': {exc}") from exc
        self.invalidate_object_list_cache_for_account(account, bucket_name)

    def initiate_multipart_upload(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        payload: MultipartUploadInitRequest,
        sse_customer: Optional[SseCustomerContext] = None,
    ) -> MultipartUploadInitResponse:
        client = self._client(account, request_profile="long_running")
        kwargs = {"Bucket": bucket_name, "Key": payload.key}
        kwargs.update(self._sse_customer_params(sse_customer))
        if payload.content_type:
            kwargs["ContentType"] = payload.content_type
        if payload.metadata:
            kwargs["Metadata"] = payload.metadata
        if payload.tags:
            tag_str = urlencode({tag.key: tag.value for tag in payload.tags if tag.key})
            if tag_str:
                kwargs["Tagging"] = tag_str
        if payload.acl:
            kwargs["ACL"] = payload.acl
        try:
            resp = client.create_multipart_upload(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to initiate multipart upload for '{payload.key}': {exc}") from exc
        upload_id = resp.get("UploadId")
        if not upload_id:
            raise RuntimeError("Multipart upload failed to return an upload id")
        return MultipartUploadInitResponse(key=payload.key, upload_id=upload_id)

    def list_multipart_uploads(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        prefix: Optional[str] = None,
        key_marker: Optional[str] = None,
        upload_id_marker: Optional[str] = None,
        max_uploads: int = 50,
    ) -> ListMultipartUploadsResponse:
        client = self._client(account)
        kwargs = {"Bucket": bucket_name, "MaxUploads": max_uploads}
        if prefix:
            kwargs["Prefix"] = prefix
        if key_marker:
            kwargs["KeyMarker"] = key_marker
        if upload_id_marker:
            kwargs["UploadIdMarker"] = upload_id_marker
        try:
            resp = client.list_multipart_uploads(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list multipart uploads for '{bucket_name}': {exc}") from exc
        uploads: list[MultipartUploadItem] = []
        for upload in resp.get("Uploads", []) or []:
            uploads.append(
                MultipartUploadItem(
                    key=upload.get("Key"),
                    upload_id=upload.get("UploadId"),
                    initiated=upload.get("Initiated"),
                    storage_class=upload.get("StorageClass"),
                    owner=(upload.get("Owner") or {}).get("DisplayName") or (upload.get("Owner") or {}).get("ID"),
                )
            )
        return ListMultipartUploadsResponse(
            uploads=uploads,
            is_truncated=bool(resp.get("IsTruncated")),
            next_key=resp.get("NextKeyMarker"),
            next_upload_id=resp.get("NextUploadIdMarker"),
        )

    def presign_part(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        payload: PresignPartRequest,
        sse_customer: Optional[SseCustomerContext] = None,
    ) -> PresignPartResponse:
        if not payload.upload_id:
            raise RuntimeError("Upload id is required to presign a part")
        client = self._client(account)
        expires = payload.expires_in or 900
        params = {
            "Bucket": bucket_name,
            "Key": payload.key,
            "UploadId": payload.upload_id,
            "PartNumber": payload.part_number,
        }
        params.update(self._sse_customer_params(sse_customer))
        headers = self._sse_customer_headers(sse_customer)
        try:
            url = client.generate_presigned_url(
                "upload_part",
                Params=params,
                ExpiresIn=expires,
            )
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to presign part {payload.part_number} for '{payload.key}': {exc}") from exc
        return PresignPartResponse(url=url, expires_in=expires, headers=headers)

    def complete_multipart_upload(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        key: str,
        upload_id: str,
        payload: CompleteMultipartUploadRequest,
    ) -> None:
        if not payload.parts:
            raise RuntimeError("No parts provided to complete multipart upload")
        client = self._client(account, request_profile="long_running")
        sorted_parts = sorted(payload.parts, key=lambda part: part.part_number)
        completed = [{"ETag": part.etag, "PartNumber": part.part_number} for part in sorted_parts]
        try:
            client.complete_multipart_upload(
                Bucket=bucket_name,
                Key=key,
                UploadId=upload_id,
                MultipartUpload={"Parts": completed},
            )
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to complete multipart upload for '{key}': {exc}") from exc
        self.invalidate_object_list_cache_for_account(account, bucket_name)

    def abort_multipart_upload(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        key: str,
        upload_id: str,
    ) -> None:
        client = self._client(account, request_profile="long_running")
        try:
            client.abort_multipart_upload(Bucket=bucket_name, Key=key, UploadId=upload_id)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to abort multipart upload for '{key}': {exc}") from exc
        self.invalidate_object_list_cache_for_account(account, bucket_name)
