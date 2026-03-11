# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, User
from app.models.bucket import (
    Bucket,
    BucketAcl,
    BucketAclUpdate,
    BucketCreate,
    BucketCorsUpdate,
    BucketEncryptionConfiguration,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketObjectLock,
    BucketObjectLockUpdate,
    BucketPolicyIn,
    BucketPolicyOut,
    BucketReplicationConfiguration,
    BucketProperties,
    BucketPublicAccessBlock,
    BucketVersioningUpdate,
    BucketQuotaUpdate,
    BucketTagsUpdate,
    BucketWebsiteConfiguration,
)
from app.models.manager_bucket_compare import (
    ManagerBucketCompareActionRequest,
    ManagerBucketCompareActionResult,
    ManagerBucketCompareRequest,
    ManagerBucketCompareResult,
)
from app.services.audit_service import AuditService
from app.services.buckets_service import BucketsService, get_buckets_service
from app.services.bucket_listing_cache import (
    get_cached_bucket_listing_for_account,
    invalidate_bucket_listing_cache_for_account,
)
from app.services.s3_client import BucketNotEmptyError
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.routers.dependencies import (
    get_account_context,
    get_audit_logger,
    get_current_account_admin,
    get_current_super_admin,
    require_bucket_compare_enabled,
)

router = APIRouter(prefix="/manager/buckets", tags=["manager-buckets"])


def _require_sse_feature(account: S3Account) -> None:
    endpoint = getattr(account, "storage_endpoint", None)
    if endpoint is None:
        return
    if not resolve_feature_flags(endpoint).sse_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Server-side encryption is disabled for this endpoint",
        )


def _context_id_from_account(account: S3Account) -> str:
    connection_id = getattr(account, "s3_connection_id", None)
    if isinstance(connection_id, int) and connection_id > 0:
        return f"conn-{connection_id}"

    s3_user_id = getattr(account, "s3_user_id", None)
    if isinstance(s3_user_id, int) and s3_user_id > 0:
        return f"s3u-{s3_user_id}"

    ceph_admin_endpoint_id = getattr(account, "ceph_admin_endpoint_id", None)
    if isinstance(ceph_admin_endpoint_id, int) and ceph_admin_endpoint_id > 0:
        return f"ceph-admin-{ceph_admin_endpoint_id}"

    account_id = getattr(account, "id", None)
    if isinstance(account_id, int) and account_id > 0:
        return str(account_id)

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported account context")


def _invalidate_bucket_listing_for_account(account: S3Account) -> None:
    invalidate_bucket_listing_cache_for_account(account)


@router.get("", response_model=list[Bucket])
def list_buckets(
    include: list[str] = Query(default=[], description="Optional extra fields to include (e.g. tags, versioning, cors)"),
    with_stats: bool = Query(True, description="Include usage/quota stats from admin listing"),
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
) -> list[Bucket]:
    try:
        include_set: set[str] = set()
        for item in include:
            if not isinstance(item, str):
                continue
            for part in item.split(","):
                normalized = part.strip()
                if normalized:
                    include_set.add(normalized)
        return get_cached_bucket_listing_for_account(
            account=account,
            include=include_set,
            with_stats=with_stats,
            builder=lambda: service.list_buckets(account, include=include_set, with_stats=with_stats),
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/stats", response_model=Bucket)
def get_bucket_stats(
    bucket_name: str,
    with_stats: bool = Query(True, description="Include usage/quota stats when available"),
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
) -> Bucket:
    try:
        return service.get_bucket_stats(bucket_name, account, with_stats=with_stats)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/compare", response_model=ManagerBucketCompareResult)
def compare_bucket_pair(
    payload: ManagerBucketCompareRequest,
    request: Request,
    db: Session = Depends(get_db),
    source_account: S3Account = Depends(get_account_context),
    actor=Depends(get_current_account_admin),
    service: BucketsService = Depends(get_buckets_service),
    _: None = Depends(require_bucket_compare_enabled),
) -> ManagerBucketCompareResult:
    target_account = get_account_context(
        request=request,
        account_ref=payload.target_context_id,
        actor=actor,
        db=db,
    )

    source_context_id = _context_id_from_account(source_account)
    target_context_id = _context_id_from_account(target_account)
    same_context = bool(source_context_id and target_context_id and source_context_id == target_context_id)
    if same_context and payload.source_bucket == payload.target_bucket:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="When source and target contexts are the same, source_bucket and target_bucket must differ.",
        )

    content_diff = None
    config_diff = None
    try:
        if payload.include_content:
            content_diff = service.compare_bucket_content(
                payload.source_bucket,
                source_account,
                payload.target_bucket,
                target_account,
                diff_sample_limit=payload.diff_sample_limit,
            )
        if payload.include_config:
            config_diff = service.compare_bucket_configuration(
                payload.source_bucket,
                source_account,
                payload.target_bucket,
                target_account,
                include_sections=set(payload.config_features) if payload.config_features is not None else None,
            )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    has_differences = bool(
        (
            content_diff is not None
            and (
                content_diff.different_count > 0
                or content_diff.only_source_count > 0
                or content_diff.only_target_count > 0
            )
        )
        or (config_diff.changed if config_diff else False)
    )
    return ManagerBucketCompareResult(
        source_context_id=source_context_id,
        target_context_id=target_context_id,
        source_bucket=payload.source_bucket,
        target_bucket=payload.target_bucket,
        has_differences=has_differences,
        content_diff=content_diff,
        config_diff=config_diff,
    )


@router.post("/compare/action", response_model=ManagerBucketCompareActionResult)
def run_compare_bucket_action(
    payload: ManagerBucketCompareActionRequest,
    request: Request,
    db: Session = Depends(get_db),
    source_account: S3Account = Depends(get_account_context),
    actor=Depends(get_current_account_admin),
    service: BucketsService = Depends(get_buckets_service),
    _: None = Depends(require_bucket_compare_enabled),
) -> ManagerBucketCompareActionResult:
    target_account = get_account_context(
        request=request,
        account_ref=payload.target_context_id,
        actor=actor,
        db=db,
    )

    source_context_id = _context_id_from_account(source_account)
    target_context_id = _context_id_from_account(target_account)
    same_context = bool(source_context_id and target_context_id and source_context_id == target_context_id)
    if same_context and payload.source_bucket == payload.target_bucket:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="When source and target contexts are the same, source_bucket and target_bucket must differ.",
        )

    try:
        action_result = service.run_compare_content_remediation(
            payload.source_bucket,
            source_account,
            payload.target_bucket,
            target_account,
            action=payload.action,
            parallelism=payload.parallelism,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    _invalidate_bucket_listing_for_account(source_account)
    _invalidate_bucket_listing_for_account(target_account)

    if action_result.planned_count == 0:
        message = "No object matched this remediation action."
    elif action_result.failed_count <= 0:
        message = (
            f"Action '{payload.action}' completed successfully: "
            f"{action_result.succeeded_count}/{action_result.planned_count} object(s) processed."
        )
    elif action_result.succeeded_count <= 0:
        message = f"Action '{payload.action}' failed for all {action_result.planned_count} object(s)."
    else:
        message = (
            f"Action '{payload.action}' partially succeeded: {action_result.succeeded_count}/"
            f"{action_result.planned_count} object(s) processed, {action_result.failed_count} failed."
        )

    return ManagerBucketCompareActionResult(
        action=action_result.action,
        source_context_id=source_context_id,
        target_context_id=target_context_id,
        source_bucket=payload.source_bucket,
        target_bucket=payload.target_bucket,
        planned_count=action_result.planned_count,
        succeeded_count=action_result.succeeded_count,
        failed_count=action_result.failed_count,
        failed_keys_sample=action_result.failed_keys_sample,
        message=message,
    )


@router.get("/{bucket_name}/properties", response_model=BucketProperties)
def bucket_properties(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
) -> BucketProperties:
    try:
        return service.get_bucket_properties(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/versioning", status_code=status.HTTP_200_OK)
def update_versioning(
    bucket_name: str,
    payload: BucketVersioningUpdate,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    try:
        service.set_versioning(bucket_name, account, enabled=payload.enabled)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_bucket_versioning",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={"enabled": payload.enabled},
        )
        return {"message": f"Versioning updated for {bucket_name}", "enabled": payload.enabled}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/object-lock", response_model=BucketObjectLock)
def get_object_lock(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
) -> BucketObjectLock:
    try:
        return service.get_object_lock(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/object-lock", response_model=BucketObjectLock)
def put_object_lock(
    bucket_name: str,
    payload: BucketObjectLockUpdate,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketObjectLock:
    try:
        result = service.set_object_lock(bucket_name, account, payload)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_bucket_object_lock",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata=payload.model_dump(exclude_none=True),
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def get_bucket_encryption(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
) -> BucketEncryptionConfiguration:
    _require_sse_feature(account)
    try:
        return service.get_bucket_encryption(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def put_bucket_encryption(
    bucket_name: str,
    payload: BucketEncryptionConfiguration,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketEncryptionConfiguration:
    _require_sse_feature(account)
    try:
        result = service.set_bucket_encryption(bucket_name, account, payload.rules)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_bucket_encryption",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={"rules_count": len(payload.rules or [])},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/encryption", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_encryption(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    _require_sse_feature(account)
    try:
        service.delete_bucket_encryption(bucket_name, account)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_bucket_encryption",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/policy", response_model=BucketPolicyOut)
def get_policy(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
) -> BucketPolicyOut:
    try:
        policy = service.get_policy(bucket_name, account)
        return BucketPolicyOut(policy=policy)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/acl", response_model=BucketAcl)
def get_acl(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
) -> BucketAcl:
    try:
        return service.get_bucket_acl(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/acl", response_model=BucketAcl)
def put_acl(
    bucket_name: str,
    payload: BucketAclUpdate,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketAcl:
    try:
        result = service.set_bucket_acl(bucket_name, account, payload)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_bucket_acl",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={"acl": payload.acl},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def get_public_access_block(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
) -> BucketPublicAccessBlock:
    try:
        return service.get_public_access_block(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def put_public_access_block(
    bucket_name: str,
    payload: BucketPublicAccessBlock,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketPublicAccessBlock:
    try:
        result = service.set_public_access_block(bucket_name, account, payload)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_public_access_block",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata=payload.model_dump(exclude_none=True),
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/policy", response_model=BucketPolicyOut)
def put_policy(
    bucket_name: str,
    payload: BucketPolicyIn,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketPolicyOut:
    try:
        service.put_policy(bucket_name, account, policy=payload.policy)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="put_bucket_policy",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={"policy_length": len(payload.policy or "")},
        )
        return BucketPolicyOut(policy=payload.policy)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/policy", status_code=status.HTTP_204_NO_CONTENT)
def delete_policy(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    try:
        service.delete_policy(bucket_name, account)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_bucket_policy",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def get_lifecycle(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
) -> BucketLifecycleConfig:
    try:
        return service.get_lifecycle(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def put_lifecycle(
    bucket_name: str,
    payload: BucketLifecycleConfig,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketLifecycleConfig:
    try:
        result = service.set_lifecycle(bucket_name, account, rules=payload.rules)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_bucket_lifecycle",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={"rules_count": len(payload.rules or [])},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/lifecycle", status_code=status.HTTP_204_NO_CONTENT)
def delete_lifecycle(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    try:
        service.delete_lifecycle(bucket_name, account)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_bucket_lifecycle",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/cors")
def get_cors(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
):
    try:
        cors = service.get_bucket_properties(bucket_name, account).cors_rules
        return {"rules": cors or []}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/cors")
def put_cors(
    bucket_name: str,
    payload: BucketCorsUpdate,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    try:
        service.set_cors(bucket_name, account, rules=payload.rules)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_bucket_cors",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={"rules_count": len(payload.rules or [])},
        )
        return {"rules": payload.rules}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/cors", status_code=status.HTTP_204_NO_CONTENT)
def delete_cors(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    try:
        service.delete_cors(bucket_name, account)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_bucket_cors",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def get_notifications(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
) -> BucketNotificationConfiguration:
    try:
        return service.get_bucket_notifications(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def put_notifications(
    bucket_name: str,
    payload: BucketNotificationConfiguration,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketNotificationConfiguration:
    try:
        configuration = payload.configuration or {}
        result = service.set_bucket_notifications(bucket_name, account, configuration)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_bucket_notifications",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={"keys": list(configuration.keys())},
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/notifications", status_code=status.HTTP_204_NO_CONTENT)
def delete_notifications(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    try:
        service.delete_bucket_notifications(bucket_name, account)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_bucket_notifications",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def get_replication(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
) -> BucketReplicationConfiguration:
    try:
        return service.get_bucket_replication(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def put_replication(
    bucket_name: str,
    payload: BucketReplicationConfiguration,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketReplicationConfiguration:
    try:
        result = service.set_bucket_replication(bucket_name, account, payload)
        _invalidate_bucket_listing_for_account(account)
        configuration = payload.configuration or {}
        rules = configuration.get("Rules")
        rules_count = len(rules) if isinstance(rules, list) else 0
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_bucket_replication",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={"rules_count": rules_count},
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/replication", status_code=status.HTTP_204_NO_CONTENT)
def delete_replication(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    try:
        service.delete_bucket_replication(bucket_name, account)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_bucket_replication",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def get_logging(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
) -> BucketLoggingConfiguration:
    try:
        return service.get_bucket_logging(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def put_logging(
    bucket_name: str,
    payload: BucketLoggingConfiguration,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketLoggingConfiguration:
    try:
        result = service.set_bucket_logging(bucket_name, account, payload)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_bucket_logging",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata=payload.model_dump(exclude_none=True),
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/logging", status_code=status.HTTP_204_NO_CONTENT)
def delete_logging(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    try:
        service.delete_bucket_logging(bucket_name, account)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_bucket_logging",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def get_website(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
) -> BucketWebsiteConfiguration:
    try:
        return service.get_bucket_website(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def put_website(
    bucket_name: str,
    payload: BucketWebsiteConfiguration,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketWebsiteConfiguration:
    try:
        result = service.set_bucket_website(bucket_name, account, payload)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_bucket_website",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata=payload.model_dump(exclude_none=True),
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/website", status_code=status.HTTP_204_NO_CONTENT)
def delete_website(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    try:
        service.delete_bucket_website(bucket_name, account)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_bucket_website",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/tags")
def get_tags(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
):
    try:
        tags = service.get_bucket_tags(bucket_name, account)
        return {"tags": [tag.model_dump() for tag in tags]}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/tags")
def put_tags(
    bucket_name: str,
    payload: BucketTagsUpdate,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    try:
        service.set_bucket_tags(bucket_name, account, tags=[{"key": tag.key, "value": tag.value} for tag in payload.tags])
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_bucket_tags",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={
                "tags": [{"key": tag.key, "value": tag.value} for tag in payload.tags],
                "count": len(payload.tags or []),
            },
        )
        return {"tags": payload.tags}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/tags", status_code=status.HTTP_204_NO_CONTENT)
def delete_tags(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    try:
        service.delete_bucket_tags(bucket_name, account)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_bucket_tags",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("", status_code=status.HTTP_201_CREATED)
def create_bucket(
    payload: BucketCreate,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    try:
        versioning = payload.versioning if payload.versioning is not None else False
        location_constraint = payload.location_constraint
        service.create_bucket(
            payload.name,
            account,
            versioning=versioning,
            location_constraint=location_constraint,
        )
        _invalidate_bucket_listing_for_account(account)
        audit_metadata = {"versioning": versioning}
        if location_constraint:
            audit_metadata["location_constraint"] = location_constraint
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="create_bucket",
            entity_type="bucket",
            entity_id=payload.name,
            account=account,
            metadata=audit_metadata,
        )
        return {
            "message": f"Bucket '{payload.name}' created",
            "name": payload.name,
            "versioning": versioning,
            "location_constraint": location_constraint,
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}")
def delete_bucket(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    try:
        service.delete_bucket(bucket_name, account)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_bucket",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
        )
        return {"message": f"Bucket '{bucket_name}' deleted"}
    except BucketNotEmptyError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Bucket '{bucket_name}' is not empty. Empty it before deleting.",
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/quota")
def update_quota(
    bucket_name: str,
    payload: BucketQuotaUpdate,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
):
    try:
        service.set_bucket_quota(bucket_name, account, payload)
        _invalidate_bucket_listing_for_account(account)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_bucket_quota",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata=payload.model_dump(exclude_none=True),
        )
        return {"message": "Bucket quota updated"}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
