# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError
from typing import Iterable, Callable, Any, Optional
import logging
import json

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


class BucketNotEmptyError(RuntimeError):
    """Raised when attempting to delete a non-empty bucket without force."""


def get_s3_client(
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
    session_token: Optional[str] = None,
):
    client = boto3.client(
        "s3",
        endpoint_url=(endpoint or settings.s3_endpoint),
        aws_access_key_id=access_key or settings.s3_access_key,
        aws_secret_access_key=secret_key or settings.s3_secret_key,
        aws_session_token=session_token,
        region_name=settings.s3_region,
        config=Config(signature_version="s3v4"),
    )
    return LoggedS3Client(client)


class LoggedS3Client:
    def __init__(self, client: Any) -> None:
        self._client = client

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._client, name)
        if not callable(attr):
            return attr

        def wrapper(*args: Any, **kwargs: Any):
            logger.debug("S3 API call %s args=%s kwargs=%s", name, args, kwargs)
            return attr(*args, **kwargs)

        return wrapper


def _normalize_public_access_block_config(config: Optional[dict]) -> dict:
    normalized = {
        "BlockPublicAcls": False,
        "IgnorePublicAcls": False,
        "BlockPublicPolicy": False,
        "RestrictPublicBuckets": False,
    }
    if not config:
        return normalized
    for key in normalized:
        if key in config and config[key] is not None:
            normalized[key] = bool(config[key])
    return normalized


def list_buckets(
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> list[dict]:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint, session_token=session_token)
    try:
        response = client.list_buckets()
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to list buckets: {exc}") from exc
    buckets = response.get("Buckets", [])
    logger.debug("Listed %s buckets", len(buckets))
    return [{"name": b.get("Name"), "creation_date": b.get("CreationDate")} for b in buckets]


def create_bucket(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint, session_token=session_token)
    try:
        if settings.s3_region and settings.s3_region != "us-east-1":
            client.create_bucket(
                Bucket=bucket_name,
                CreateBucketConfiguration={"LocationConstraint": settings.s3_region},
            )
        else:
            client.create_bucket(Bucket=bucket_name)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to create bucket '{bucket_name}': {exc}") from exc
    logger.debug("Created bucket %s", bucket_name)


def set_bucket_versioning(
    bucket_name: str,
    enabled: bool = True,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint, session_token=session_token)
    status = "Enabled" if enabled else "Suspended"
    try:
        client.put_bucket_versioning(Bucket=bucket_name, VersioningConfiguration={"Status": status})
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to update versioning for bucket '{bucket_name}': {exc}") from exc
    logger.debug("Set versioning for bucket %s to %s", bucket_name, status)


def set_bucket_public_access_block(
    bucket_name: str,
    block: bool = True,
    configuration: Optional[dict] = None,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    block_state = bool(configuration) if configuration is not None else block
    try:
        if configuration is None:
            if not block:
                configuration = {}
            else:
                # Ceph RGW rejects PutObject when BlockPublicAcls is enabled, so only enforce policy-level blocks by default.
                configuration = {
                    "BlockPublicAcls": False,
                    "IgnorePublicAcls": False,
                    "BlockPublicPolicy": True,
                    "RestrictPublicBuckets": True,
                }
        if configuration:
            # Ceph RGW rejects PutObject when BlockPublicAcls is enabled, so only enforce policy-level blocks.
            client.put_public_access_block(
                Bucket=bucket_name,
                PublicAccessBlockConfiguration=_normalize_public_access_block_config(configuration),
            )
        else:
            client.delete_public_access_block(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if not block and code.lower() in {"nosuchpublicaccessblockconfiguration", "nosuchpublicaccessblock"}:
            return
        raise RuntimeError(f"Unable to update public access block for bucket '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to update public access block for bucket '{bucket_name}': {exc}") from exc
    logger.debug("Set public access block for bucket %s to %s", bucket_name, block_state)


def get_bucket_public_access_block(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> Optional[dict]:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        resp = client.get_public_access_block(Bucket=bucket_name)
        config = resp.get("PublicAccessBlockConfiguration") or {}
        if not config:
            return None
        normalized = _normalize_public_access_block_config(config)
        return {
            "block_public_acls": normalized["BlockPublicAcls"],
            "ignore_public_acls": normalized["IgnorePublicAcls"],
            "block_public_policy": normalized["BlockPublicPolicy"],
            "restrict_public_buckets": normalized["RestrictPublicBuckets"],
        }
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchpublicaccessblockconfiguration", "nosuchpublicaccessblock"}:
            return None
        raise RuntimeError(f"Unable to fetch public access block for bucket '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch public access block for bucket '{bucket_name}': {exc}") from exc


def get_bucket_versioning(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> Optional[str]:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        resp = client.get_bucket_versioning(Bucket=bucket_name)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to fetch versioning for bucket '{bucket_name}': {exc}") from exc
    return resp.get("Status")


def get_bucket_object_lock(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> Optional[dict]:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        resp = client.get_object_lock_configuration(Bucket=bucket_name)
        config = resp.get("ObjectLockConfiguration") or {}
        if not config:
            return None
        rule = config.get("Rule") or {}
        retention = rule.get("DefaultRetention") or {}
        enabled_raw = config.get("ObjectLockEnabled")
        enabled = str(enabled_raw).lower() == "enabled" if enabled_raw is not None else None
        return {
            "enabled": enabled,
            "mode": retention.get("Mode"),
            "days": retention.get("Days"),
            "years": retention.get("Years"),
        }
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"objectlockconfigurationnotfounderror", "invalidbucketstate", "nosuchbucket"}:
            return None
        raise RuntimeError(f"Unable to fetch object lock config for bucket '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch object lock config for bucket '{bucket_name}': {exc}") from exc


def get_bucket_acl(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> dict:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        return client.get_bucket_acl(Bucket=bucket_name)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to fetch ACL for bucket '{bucket_name}': {exc}") from exc


def put_bucket_acl(
    bucket_name: str,
    acl: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        client.put_bucket_acl(Bucket=bucket_name, ACL=acl)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to update ACL for bucket '{bucket_name}': {exc}") from exc
    logger.debug("Updated ACL for bucket %s", bucket_name)


def put_bucket_tags(
    bucket_name: str,
    tags: list[dict],
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    tag_set = [
        {"Key": str(tag.get("key") or ""), "Value": str(tag.get("value") or "")}
        for tag in tags
        if str(tag.get("key") or "").strip()
    ]
    try:
        if tag_set:
            client.put_bucket_tagging(Bucket=bucket_name, Tagging={"TagSet": tag_set})
        else:
            client.delete_bucket_tagging(Bucket=bucket_name)
    except ClientError as exc:
        raise RuntimeError(f"Unable to update bucket tags for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to update bucket tags for '{bucket_name}': {exc}") from exc


def delete_bucket_tags(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        client.delete_bucket_tagging(Bucket=bucket_name)
    except (ClientError, BotoCoreError) as exc:
        raise RuntimeError(f"Unable to delete bucket tags for '{bucket_name}': {exc}") from exc


def get_bucket_logging(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> Optional[dict]:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        resp = client.get_bucket_logging(Bucket=bucket_name)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to fetch bucket logging for '{bucket_name}': {exc}") from exc
    config = resp.get("LoggingEnabled") or {}
    if not config:
        return None
    return {
        "target_bucket": config.get("TargetBucket"),
        "target_prefix": config.get("TargetPrefix"),
        "target_grants": config.get("TargetGrants"),
    }


def put_bucket_logging(
    bucket_name: str,
    logging_config: Optional[dict] = None,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    status: dict = {}
    if logging_config:
        status["LoggingEnabled"] = logging_config
    try:
        client.put_bucket_logging(Bucket=bucket_name, BucketLoggingStatus=status)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to update bucket logging for '{bucket_name}': {exc}") from exc
    logger.debug("Updated bucket logging for %s", bucket_name)


def get_bucket_notifications(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> dict:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        resp = client.get_bucket_notification_configuration(Bucket=bucket_name)
        resp.pop("ResponseMetadata", None)
        return resp or {}
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to fetch bucket notifications for '{bucket_name}': {exc}") from exc


def put_bucket_notifications(
    bucket_name: str,
    config: dict,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        client.put_bucket_notification_configuration(
            Bucket=bucket_name,
            NotificationConfiguration=config or {},
        )
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to update bucket notifications for '{bucket_name}': {exc}") from exc
    logger.debug("Updated notifications for bucket %s", bucket_name)


def put_bucket_object_lock(
    bucket_name: str,
    enabled: Optional[bool] = None,
    mode: Optional[str] = None,
    days: Optional[int] = None,
    years: Optional[int] = None,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    config: dict = {}
    if enabled is not None:
        config["ObjectLockEnabled"] = "Enabled" if enabled else "Disabled"
    retention: dict = {}
    if mode:
        retention["Mode"] = mode.upper()
    if days is not None:
        retention["Days"] = int(days)
    if years is not None:
        retention["Years"] = int(years)
    if retention:
        config["Rule"] = {"DefaultRetention": retention}
    if not config:
        raise RuntimeError("No object lock configuration supplied.")
    try:
        client.put_object_lock_configuration(Bucket=bucket_name, ObjectLockConfiguration=config)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to set object lock config for bucket '{bucket_name}': {exc}") from exc
    logger.debug("Updated object lock configuration for bucket %s", bucket_name)


def get_bucket_lifecycle(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> list[dict]:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        resp = client.get_bucket_lifecycle_configuration(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchlifecycleconfiguration", "nosuchbucket"}:
            return []
        raise RuntimeError(f"Unable to fetch lifecycle for bucket '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch lifecycle for bucket '{bucket_name}': {exc}") from exc
    return resp.get("Rules", []) or []


def put_bucket_lifecycle(
    bucket_name: str,
    rules: list[dict],
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        client.put_bucket_lifecycle_configuration(Bucket=bucket_name, LifecycleConfiguration={"Rules": rules})
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to set lifecycle for bucket '{bucket_name}': {exc}") from exc
    logger.debug("Updated lifecycle for bucket %s", bucket_name)


def delete_bucket_lifecycle(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        client.delete_bucket_lifecycle(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchlifecycleconfiguration", "nosuchbucket"}:
            return
        raise RuntimeError(f"Unable to delete lifecycle for bucket '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete lifecycle for bucket '{bucket_name}': {exc}") from exc
    logger.debug("Deleted lifecycle for bucket %s", bucket_name)


def get_bucket_cors(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> list[dict]:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        resp = client.get_bucket_cors(Bucket=bucket_name)
        return resp.get("CORSRules", []) or []
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchcorsconfiguration", "nosuchbucket"}:
            return []
        raise RuntimeError(f"Unable to fetch bucket CORS for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch bucket CORS for '{bucket_name}': {exc}") from exc


def put_bucket_cors(
    bucket_name: str,
    rules: list[dict],
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        client.put_bucket_cors(Bucket=bucket_name, CORSConfiguration={"CORSRules": rules})
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to set bucket CORS for '{bucket_name}': {exc}") from exc
    logger.debug("Updated CORS for bucket %s", bucket_name)


def delete_bucket_cors(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        client.delete_bucket_cors(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchcorsconfiguration", "nosuchbucket"}:
            return
        raise RuntimeError(f"Unable to delete bucket CORS for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete bucket CORS for '{bucket_name}': {exc}") from exc
    logger.debug("Deleted CORS for bucket %s", bucket_name)


def get_bucket_website(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> Optional[dict]:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        resp = client.get_bucket_website(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchwebsiteconfiguration", "nosuchbucket"}:
            return None
        raise RuntimeError(f"Unable to fetch bucket website for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch bucket website for '{bucket_name}': {exc}") from exc
    config: dict = {}
    for key in ("IndexDocument", "ErrorDocument", "RedirectAllRequestsTo", "RoutingRules"):
        if resp.get(key) is not None:
            config[key] = resp.get(key)
    return config or None


def put_bucket_website(
    bucket_name: str,
    configuration: dict,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        client.put_bucket_website(Bucket=bucket_name, WebsiteConfiguration=configuration)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to set bucket website for '{bucket_name}': {exc}") from exc
    logger.debug("Updated bucket website for bucket %s", bucket_name)


def delete_bucket_website(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        client.delete_bucket_website(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchwebsiteconfiguration", "nosuchbucket"}:
            return
        raise RuntimeError(f"Unable to delete bucket website for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete bucket website for '{bucket_name}': {exc}") from exc
    logger.debug("Deleted bucket website for bucket %s", bucket_name)


def get_bucket_policy(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> Optional[dict]:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        resp = client.get_bucket_policy(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchbucketpolicy", "nosuchbucket"}:
            return None
        raise RuntimeError(f"Unable to fetch bucket policy for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch bucket policy for '{bucket_name}': {exc}") from exc
    policy_str = resp.get("Policy")
    if not policy_str:
        return None
    try:
        return json.loads(policy_str)
    except json.JSONDecodeError:
        return {"raw": policy_str}


def put_bucket_policy(
    bucket_name: str,
    policy: dict,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        client.put_bucket_policy(Bucket=bucket_name, Policy=json.dumps(policy))
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to set bucket policy for '{bucket_name}': {exc}") from exc
    logger.debug("Updated policy for bucket %s", bucket_name)


def delete_bucket_policy(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        client.delete_bucket_policy(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchbucketpolicy", "nosuchbucket"}:
            return
        raise RuntimeError(f"Unable to delete bucket policy for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete bucket policy for '{bucket_name}': {exc}") from exc
    logger.debug("Deleted policy for bucket %s", bucket_name)


def _delete_objects(client, bucket_name: str, items: Iterable[dict]) -> None:
    chunk = []
    for item in items:
        chunk.append(item)
        if len(chunk) == 1000:
            _delete_objects_chunk(client, bucket_name, chunk)
            chunk = []
    if chunk:
        _delete_objects_chunk(client, bucket_name, chunk)


def _delete_objects_chunk(client, bucket_name: str, chunk: list[dict]) -> None:
    resp = client.delete_objects(Bucket=bucket_name, Delete={"Objects": chunk})
    errors = resp.get("Errors", []) if isinstance(resp, dict) else []
    if errors:
        sample = []
        for err in errors[:3]:
            key = err.get("Key", "unknown")
            version_id = err.get("VersionId")
            code = err.get("Code", "Error")
            message = err.get("Message", "")
            suffix = f" ({message})" if message else ""
            if version_id:
                sample.append(f"{code} for {key} (version {version_id}){suffix}")
            else:
                sample.append(f"{code} for {key}{suffix}")
        extra = f" (+{len(errors) - 3} more)" if len(errors) > 3 else ""
        raise RuntimeError(
            f"Unable to delete {len(errors)} object(s) in bucket '{bucket_name}': {', '.join(sample)}{extra}"
        )


def _delete_versions(client, bucket_name: str) -> None:
    key_marker = None
    version_marker = None
    while True:
        list_kwargs = {"Bucket": bucket_name}
        if key_marker:
            list_kwargs["KeyMarker"] = key_marker
        if version_marker:
            list_kwargs["VersionIdMarker"] = version_marker
        page = client.list_object_versions(**list_kwargs)
        objects = []
        for version in page.get("Versions", []):
            objects.append({"Key": version["Key"], "VersionId": version["VersionId"]})
        for marker in page.get("DeleteMarkers", []):
            objects.append({"Key": marker["Key"], "VersionId": marker["VersionId"]})
        if objects:
            _delete_objects(client, bucket_name, objects)
        key_marker = page.get("NextKeyMarker")
        version_marker = page.get("NextVersionIdMarker")
        if not key_marker and not version_marker:
            break


def delete_bucket(
    bucket_name: str,
    force: bool = False,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> None:
    client = get_s3_client(access_key, secret_key, endpoint=endpoint)
    try:
        resp = client.list_objects_v2(Bucket=bucket_name, MaxKeys=1)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to inspect bucket '{bucket_name}': {exc}") from exc

    has_objects = (resp.get("KeyCount") or 0) > 0 or bool(resp.get("Contents"))
    if has_objects and not force:
        raise BucketNotEmptyError(
            f"Bucket '{bucket_name}' is not empty. Retry with force=true to delete all objects."
        )

    if force:
        continuation_token = None
        while True:
            list_kwargs = {"Bucket": bucket_name}
            if continuation_token:
                list_kwargs["ContinuationToken"] = continuation_token
            page = client.list_objects_v2(**list_kwargs)
            contents = page.get("Contents", [])
            if contents:
                objects = [{"Key": obj["Key"]} for obj in contents]
                _delete_objects(client, bucket_name, objects)
            continuation_token = page.get("NextContinuationToken")
            if not continuation_token:
                break

        # Delete all object versions and delete-markers if versioning is enabled
        try:
            _delete_versions(client, bucket_name)
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
            if error_code.lower() not in {"nosuchbucket", "nosuchversion"}:
                raise RuntimeError(f"Unable to delete object versions in '{bucket_name}': {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to delete object versions in '{bucket_name}': {exc}") from exc

    try:
        client.delete_bucket(Bucket=bucket_name)
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if error_code.lower() == "bucketnotempty":
            raise BucketNotEmptyError(
                f"Bucket '{bucket_name}' is not empty. Retry with force=true to delete all objects."
            ) from exc
        raise RuntimeError(f"Unable to delete bucket '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete bucket '{bucket_name}': {exc}") from exc
    logger.debug("Deleted bucket %s (force=%s)", bucket_name, force)
