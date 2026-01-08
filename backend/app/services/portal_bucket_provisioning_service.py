# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.db_models import S3Account
from app.models.portal_buckets import PortalBucketCreateRequest, PortalBucketCreateResponse
from app.services import s3_client
from app.services.rgw_iam import RGWIAMService, get_iam_service
from app.utils.s3_endpoint import resolve_s3_endpoint


logger = logging.getLogger(__name__)


class PortalBucketProvisioningService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def _account_root_credentials(self, account: S3Account) -> tuple[str, str]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("Account is missing root credentials")
        return access_key, secret_key

    def _iam(self, account: S3Account) -> RGWIAMService:
        access_key, secret_key = self._account_root_credentials(account)
        return get_iam_service(access_key, secret_key, endpoint=self._s3_endpoint(account))

    def _s3_endpoint(self, account: S3Account) -> str:
        endpoint = resolve_s3_endpoint(account)
        if not endpoint:
            raise RuntimeError("S3 endpoint is not configured for this account")
        return endpoint

    def _bucket_provisioner_username(self, account: S3Account) -> str:
        stored = getattr(account, "bucket_provisioner_iam_username", None)
        if isinstance(stored, str) and stored.strip():
            return stored.strip()
        return f"portal-{account.id}-bucket-provisioner"[:63]

    def _bucket_provisioner_policy(self) -> dict:
        return {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "PortalBucketProvisioning",
                    "Effect": "Allow",
                    "Action": [
                        "s3:CreateBucket",
                        "s3:DeleteBucket",
                        "s3:PutBucketTagging",
                        "s3:PutBucketVersioning",
                    ],
                    "Resource": ["*"],
                }
            ],
        }

    def _ensure_bucket_provisioner(self, account: S3Account) -> tuple[str, str, str]:
        iam_username = self._bucket_provisioner_username(account)
        iam = self._iam(account)
        iam.create_user(iam_username, create_key=False, allow_existing=True)
        iam.put_user_inline_policy(iam_username, "portal-bucket-provisioner", self._bucket_provisioner_policy())

        stored_access_key = getattr(account, "bucket_provisioner_access_key", None)
        stored_secret_key = getattr(account, "bucket_provisioner_secret_key", None)

        if isinstance(stored_access_key, str) and stored_access_key and isinstance(stored_secret_key, str) and stored_secret_key:
            if getattr(account, "bucket_provisioner_iam_username", None) != iam_username:
                account.bucket_provisioner_iam_username = iam_username
                self.db.add(account)
                self.db.commit()
            return iam_username, stored_access_key, stored_secret_key

        return self._rotate_bucket_provisioner_key(account, iam_username)

    def _rotate_bucket_provisioner_key(self, account: S3Account, iam_username: str) -> tuple[str, str, str]:
        iam = self._iam(account)
        keys = iam.list_access_keys(iam_username)
        if len(keys) >= 2:
            for key in keys:
                if key.access_key_id:
                    iam.delete_access_key(iam_username, key.access_key_id)
            keys = []

        new_key = iam.create_access_key(iam_username)
        if not new_key.access_key_id or not new_key.secret_access_key:
            raise RuntimeError("IAM did not return new bucket provisioner credentials")

        for key in iam.list_access_keys(iam_username):
            if key.access_key_id and key.access_key_id != new_key.access_key_id:
                iam.delete_access_key(iam_username, key.access_key_id)

        account.bucket_provisioner_iam_username = iam_username
        account.bucket_provisioner_access_key = new_key.access_key_id
        account.bucket_provisioner_secret_key = new_key.secret_access_key
        self.db.add(account)
        self.db.commit()
        self.db.refresh(account)
        return iam_username, new_key.access_key_id, new_key.secret_access_key

    def create_bucket(self, account: S3Account, request: PortalBucketCreateRequest) -> tuple[PortalBucketCreateResponse, str]:
        endpoint = self._s3_endpoint(account)
        executor_user, access_key, secret_key = self._ensure_bucket_provisioner(account)

        tags = {
            "managed-by": "portal",
            "portal-account": str(account.id),
            "portal-scope": "bucket",
            "workflow": "bucket.create",
        }
        tag_rows = [{"key": k, "value": v} for k, v in tags.items()]

        def _rotate_and_retry(step: str, fn) -> None:
            nonlocal executor_user, access_key, secret_key
            try:
                fn()
            except RuntimeError as exc:
                detail = str(exc)
                if any(code in detail for code in ("InvalidAccessKeyId", "SignatureDoesNotMatch", "AccessDenied")):
                    logger.info("Bucket provisioner credentials rejected (%s) for account %s; rotating key and retrying", step, account.id)
                    executor_user, access_key, secret_key = self._rotate_bucket_provisioner_key(account, executor_user)
                    fn()
                else:
                    raise

        _rotate_and_retry(
            "create_bucket",
            lambda: s3_client.create_bucket(request.name, access_key=access_key, secret_key=secret_key, endpoint=endpoint),
        )
        if request.versioning:
            _rotate_and_retry(
                "set_versioning",
                lambda: s3_client.set_bucket_versioning(
                    request.name,
                    enabled=True,
                    access_key=access_key,
                    secret_key=secret_key,
                    endpoint=endpoint,
                ),
            )
        try:
            _rotate_and_retry(
                "put_bucket_tags",
                lambda: s3_client.put_bucket_tags(
                    request.name,
                    tags=tag_rows,
                    access_key=access_key,
                    secret_key=secret_key,
                    endpoint=endpoint,
                ),
            )
        except RuntimeError:
            try:
                s3_client.delete_bucket(request.name, force=False, access_key=access_key, secret_key=secret_key, endpoint=endpoint)
            except Exception as cleanup_exc:
                logger.info("Unable to cleanup failed bucket %s: %s", request.name, cleanup_exc)
            raise

        return PortalBucketCreateResponse(name=request.name, versioning=bool(request.versioning), tags=tags), executor_user


def get_portal_bucket_provisioning_service(db: Session) -> PortalBucketProvisioningService:
    return PortalBucketProvisioningService(db)
