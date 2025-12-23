# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from typing import Optional
from urllib.parse import urlencode

from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import get_settings
from app.db_models import S3Account
from app.models.browser import (
    BrowserBucket,
    BrowserObject,
    BrowserObjectVersion,
    BucketCorsRule,
    BucketCorsStatus,
    CompleteMultipartUploadRequest,
    CopyObjectPayload,
    DeleteObjectsPayload,
    ListBrowserObjectsResponse,
    ListMultipartUploadsResponse,
    ListObjectVersionsResponse,
    ListPartsResponse,
    MultipartPart,
    MultipartUploadInitRequest,
    MultipartUploadInitResponse,
    MultipartUploadItem,
    ObjectMetadata,
    ObjectTag,
    ObjectTags,
    PresignPartRequest,
    PresignPartResponse,
    PresignRequest,
    PresignedUrl,
    StsStatus,
)
from app.services.s3_client import _delete_objects, get_s3_client
from app.services.sts_service import get_sts_client

logger = logging.getLogger(__name__)
settings = get_settings()


def _resolve_endpoint(account: S3Account) -> str:
    if getattr(account, "storage_endpoint", None):
        endpoint = getattr(account.storage_endpoint, "endpoint_url", None)
        if endpoint:
            return endpoint
    endpoint_url = getattr(account, "storage_endpoint_url", None)
    return endpoint_url or settings.s3_endpoint


class BrowserService:
    def _client(self, account: S3Account):
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3 credentials missing for this account")
        session_token = account.session_token() if hasattr(account, "session_token") else getattr(account, "_session_token", None)
        return get_s3_client(
            access_key,
            secret_key,
            endpoint=_resolve_endpoint(account),
            session_token=session_token,
        )

    def _clean_etag(self, etag: Optional[str]) -> Optional[str]:
        if not etag:
            return None
        return etag.strip('"')

    def get_bucket_cors_status(self, bucket_name: str, account: S3Account) -> BucketCorsStatus:
        client = self._client(account)
        try:
            resp = client.get_bucket_cors(Bucket=bucket_name)
        except (ClientError, BotoCoreError) as exc:
            code = None
            if isinstance(exc, ClientError):
                code = exc.response.get("Error", {}).get("Code")
            if code in {"NoSuchCORSConfiguration", "NoSuchCORS"}:
                return BucketCorsStatus(enabled=False, rules=[])
            return BucketCorsStatus(enabled=False, rules=[], error=str(exc))
        rules = []
        for rule in resp.get("CORSRules", []) or []:
            rules.append(
                BucketCorsRule(
                    allowed_origins=rule.get("AllowedOrigins") or [],
                    allowed_methods=rule.get("AllowedMethods") or [],
                    allowed_headers=rule.get("AllowedHeaders") or [],
                    expose_headers=rule.get("ExposeHeaders") or [],
                    max_age_seconds=rule.get("MaxAgeSeconds"),
                )
            )
        return BucketCorsStatus(enabled=bool(rules), rules=rules)

    def check_sts(self, account: S3Account) -> StsStatus:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            return StsStatus(available=False, error="S3 credentials missing for this account")
        session_token = account.session_token() if hasattr(account, "session_token") else getattr(account, "_session_token", None)
        endpoint = settings.sts_endpoint or _resolve_endpoint(account)
        client = get_sts_client(access_key, secret_key, endpoint=endpoint, session_token=session_token)
        try:
            client.get_caller_identity()
            return StsStatus(available=True)
        except (ClientError, BotoCoreError) as exc:
            return StsStatus(available=False, error=str(exc))

    def proxy_upload(self, bucket_name: str, account: S3Account, key: str, file_obj, content_type: Optional[str]) -> None:
        client = self._client(account)
        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type
        try:
            file_obj.seek(0)
            if extra_args:
                client.upload_fileobj(file_obj, bucket_name, key, ExtraArgs=extra_args)
            else:
                client.upload_fileobj(file_obj, bucket_name, key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to upload '{key}': {exc}") from exc

    def proxy_download(self, bucket_name: str, account: S3Account, key: str):
        client = self._client(account)
        try:
            return client.get_object(Bucket=bucket_name, Key=key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to download '{key}': {exc}") from exc

    def list_buckets(self, account: S3Account) -> list[BrowserBucket]:
        client = self._client(account)
        try:
            resp = client.list_buckets()
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list buckets: {exc}") from exc
        buckets: list[BrowserBucket] = []
        for bucket in resp.get("Buckets", []):
            name = bucket.get("Name")
            if not name:
                continue
            buckets.append(BrowserBucket(name=name, creation_date=bucket.get("CreationDate")))
        return buckets

    def list_objects(
        self,
        bucket_name: str,
        account: S3Account,
        prefix: str = "",
        continuation_token: Optional[str] = None,
        max_keys: int = 1000,
    ) -> ListBrowserObjectsResponse:
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
        objects: list[BrowserObject] = []
        for obj in resp.get("Contents", []):
            key = obj.get("Key")
            if not key:
                continue
            if prefix and key.rstrip("/") == prefix.rstrip("/") and obj.get("Size", 0) == 0:
                continue
            objects.append(
                BrowserObject(
                    key=key,
                    size=int(obj.get("Size") or 0),
                    last_modified=obj.get("LastModified"),
                    storage_class=obj.get("StorageClass"),
                    etag=self._clean_etag(obj.get("ETag")),
                )
            )
        prefixes = [p.get("Prefix") for p in resp.get("CommonPrefixes", []) if p.get("Prefix")]
        return ListBrowserObjectsResponse(
            prefix=prefix,
            objects=objects,
            prefixes=prefixes,
            is_truncated=bool(resp.get("IsTruncated")),
            next_continuation_token=resp.get("NextContinuationToken"),
        )

    def list_object_versions(
        self,
        bucket_name: str,
        account: S3Account,
        prefix: str = "",
        key_marker: Optional[str] = None,
        version_id_marker: Optional[str] = None,
        max_keys: int = 1000,
    ) -> ListObjectVersionsResponse:
        client = self._client(account)
        kwargs = {
            "Bucket": bucket_name,
            "Prefix": prefix or "",
            "MaxKeys": max_keys,
        }
        if key_marker:
            kwargs["KeyMarker"] = key_marker
        if version_id_marker:
            kwargs["VersionIdMarker"] = version_id_marker
        try:
            resp = client.list_object_versions(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list object versions for '{bucket_name}': {exc}") from exc
        versions: list[BrowserObjectVersion] = []
        delete_markers: list[BrowserObjectVersion] = []
        for ver in resp.get("Versions", []):
            key = ver.get("Key")
            if not key:
                continue
            versions.append(
                BrowserObjectVersion(
                    key=key,
                    version_id=ver.get("VersionId"),
                    is_latest=bool(ver.get("IsLatest")),
                    last_modified=ver.get("LastModified"),
                    size=int(ver.get("Size") or 0),
                    etag=self._clean_etag(ver.get("ETag")),
                    storage_class=ver.get("StorageClass"),
                )
            )
        for marker in resp.get("DeleteMarkers", []):
            key = marker.get("Key")
            if not key:
                continue
            delete_markers.append(
                BrowserObjectVersion(
                    key=key,
                    version_id=marker.get("VersionId"),
                    is_latest=bool(marker.get("IsLatest")),
                    is_delete_marker=True,
                    last_modified=marker.get("LastModified"),
                )
            )
        return ListObjectVersionsResponse(
            prefix=prefix or None,
            versions=versions,
            delete_markers=delete_markers,
            is_truncated=bool(resp.get("IsTruncated")),
            key_marker=resp.get("KeyMarker"),
            version_id_marker=resp.get("VersionIdMarker"),
            next_key_marker=resp.get("NextKeyMarker"),
            next_version_id_marker=resp.get("NextVersionIdMarker"),
        )

    def head_object(
        self,
        bucket_name: str,
        account: S3Account,
        key: str,
        version_id: Optional[str] = None,
    ) -> ObjectMetadata:
        client = self._client(account)
        kwargs = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            resp = client.head_object(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to fetch metadata for '{key}': {exc}") from exc
        metadata = resp.get("Metadata") or {}
        return ObjectMetadata(
            key=key,
            size=int(resp.get("ContentLength") or 0),
            etag=self._clean_etag(resp.get("ETag")),
            last_modified=resp.get("LastModified"),
            content_type=resp.get("ContentType"),
            storage_class=resp.get("StorageClass"),
            metadata=metadata,
            version_id=resp.get("VersionId") or version_id,
        )

    def get_object_tags(
        self,
        bucket_name: str,
        account: S3Account,
        key: str,
        version_id: Optional[str] = None,
    ) -> ObjectTags:
        client = self._client(account)
        kwargs = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            resp = client.get_object_tagging(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to fetch tags for '{key}': {exc}") from exc
        tagset = resp.get("TagSet") or []
        tags = [
            ObjectTag(key=tag.get("Key") or "", value=tag.get("Value") or "")
            for tag in tagset
            if tag.get("Key") is not None
        ]
        return ObjectTags(key=key, tags=tags, version_id=resp.get("VersionId") or version_id)

    def put_object_tags(
        self,
        bucket_name: str,
        account: S3Account,
        key: str,
        tags: list[ObjectTag],
        version_id: Optional[str] = None,
    ) -> ObjectTags:
        client = self._client(account)
        tag_set = [
            {"Key": tag.key, "Value": tag.value}
            for tag in tags
            if tag.key is not None and str(tag.key).strip()
        ]
        kwargs = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            if tag_set:
                client.put_object_tagging(**kwargs, Tagging={"TagSet": tag_set})
            else:
                client.delete_object_tagging(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to update tags for '{key}': {exc}") from exc
        return ObjectTags(key=key, tags=tags, version_id=version_id)

    def presign(
        self,
        bucket_name: str,
        account: S3Account,
        payload: PresignRequest,
    ) -> PresignedUrl:
        client = self._client(account)
        expires = payload.expires_in or 900
        params = {"Bucket": bucket_name, "Key": payload.key}
        headers: dict[str, str] = {}
        if payload.version_id:
            params["VersionId"] = payload.version_id
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
                    params["ContentType"] = payload.content_type
                    headers["Content-Type"] = payload.content_type
                url = client.generate_presigned_url(
                    "put_object",
                    Params=params,
                    ExpiresIn=expires,
                )
                return PresignedUrl(url=url, method="PUT", expires_in=expires, headers=headers)
            if payload.operation == "post_object":
                fields = {}
                conditions: list[dict | list] = []
                if payload.content_type:
                    fields["Content-Type"] = payload.content_type
                    conditions.append({"Content-Type": payload.content_type})
                if payload.content_length is not None:
                    conditions.append(["content-length-range", 0, payload.content_length])
                result = client.generate_presigned_post(
                    bucket_name,
                    payload.key,
                    Fields=fields or None,
                    Conditions=conditions or None,
                    ExpiresIn=expires,
                )
                return PresignedUrl(
                    url=result.get("url") or "",
                    method="POST",
                    expires_in=expires,
                    fields=result.get("fields") or {},
                    headers=headers,
                )
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to generate presigned URL for '{payload.operation}': {exc}") from exc
        raise RuntimeError("Unsupported presign operation")

    def copy_object(
        self,
        bucket_name: str,
        account: S3Account,
        payload: CopyObjectPayload,
    ) -> None:
        client = self._client(account)
        copy_source: dict[str, str] = {
            "Bucket": bucket_name,
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
            kwargs["MetadataDirective"] = "REPLACE"
            kwargs["Metadata"] = payload.metadata or {}
        if payload.replace_tags:
            tag_str = urlencode({tag.key: tag.value for tag in payload.tags if tag.key})
            kwargs["TaggingDirective"] = "REPLACE"
            if tag_str:
                kwargs["Tagging"] = tag_str
        if payload.acl:
            kwargs["ACL"] = payload.acl
        try:
            client.copy_object(**kwargs)
            if payload.move:
                delete_kwargs = {"Bucket": bucket_name, "Key": payload.source_key}
                if payload.source_version_id:
                    delete_kwargs["VersionId"] = payload.source_version_id
                client.delete_object(**delete_kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to copy object '{payload.source_key}' -> '{payload.destination_key}': {exc}") from exc

    def delete_objects(
        self,
        bucket_name: str,
        account: S3Account,
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
            _delete_objects(client, bucket_name, items)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to delete objects in bucket '{bucket_name}': {exc}") from exc
        return len(items)

    def create_folder(
        self,
        bucket_name: str,
        account: S3Account,
        prefix: str,
    ) -> None:
        client = self._client(account)
        key = prefix if prefix.endswith("/") else f"{prefix}/"
        try:
            client.put_object(Bucket=bucket_name, Key=key, Body=b"")
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to create folder '{key}': {exc}") from exc

    def initiate_multipart_upload(
        self,
        bucket_name: str,
        account: S3Account,
        payload: MultipartUploadInitRequest,
    ) -> MultipartUploadInitResponse:
        client = self._client(account)
        kwargs = {"Bucket": bucket_name, "Key": payload.key}
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
        account: S3Account,
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

    def list_parts(
        self,
        bucket_name: str,
        account: S3Account,
        key: str,
        upload_id: str,
        part_number_marker: Optional[int] = None,
        max_parts: int = 1000,
    ) -> ListPartsResponse:
        client = self._client(account)
        kwargs = {
            "Bucket": bucket_name,
            "Key": key,
            "UploadId": upload_id,
            "MaxParts": max_parts,
        }
        if part_number_marker:
            kwargs["PartNumberMarker"] = part_number_marker
        try:
            resp = client.list_parts(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list parts for '{key}': {exc}") from exc
        parts: list[MultipartPart] = []
        for part in resp.get("Parts", []):
            parts.append(
                MultipartPart(
                    part_number=int(part.get("PartNumber") or 0),
                    etag=self._clean_etag(part.get("ETag")) or "",
                    size=int(part.get("Size") or 0),
                    last_modified=part.get("LastModified"),
                )
            )
        return ListPartsResponse(
            parts=parts,
            is_truncated=bool(resp.get("IsTruncated")),
            next_part_number=resp.get("NextPartNumberMarker"),
        )

    def presign_part(
        self,
        bucket_name: str,
        account: S3Account,
        payload: PresignPartRequest,
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
        try:
            url = client.generate_presigned_url(
                "upload_part",
                Params=params,
                ExpiresIn=expires,
            )
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to presign part {payload.part_number} for '{payload.key}': {exc}") from exc
        return PresignPartResponse(url=url, expires_in=expires)

    def complete_multipart_upload(
        self,
        bucket_name: str,
        account: S3Account,
        key: str,
        upload_id: str,
        payload: CompleteMultipartUploadRequest,
    ) -> None:
        if not payload.parts:
            raise RuntimeError("No parts provided to complete multipart upload")
        client = self._client(account)
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

    def abort_multipart_upload(
        self,
        bucket_name: str,
        account: S3Account,
        key: str,
        upload_id: str,
    ) -> None:
        client = self._client(account)
        try:
            client.abort_multipart_upload(Bucket=bucket_name, Key=key, UploadId=upload_id)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to abort multipart upload for '{key}': {exc}") from exc


def get_browser_service() -> BrowserService:
    return BrowserService()
