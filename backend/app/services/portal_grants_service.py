# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import logging
import re
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db_models import AccessGrant, IamIdentity, PortalRoleKey, S3Account, StorageEndpoint, User
from app.models.portal_access import PortalAccessGrant, PortalGrantAssignRequest
from app.services.rgw_iam import RGWIAMService, get_iam_service
from app.utils.s3_endpoint import resolve_s3_endpoint


logger = logging.getLogger(__name__)


_SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9+=,.@_-]+")


def _short_hash(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:10]


def _sanitize_name(value: str) -> str:
    cleaned = _SAFE_NAME_RE.sub("-", value.strip())
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-")
    return cleaned or "x"


class PortalGrantsService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def _account_root_credentials(self, account: S3Account) -> tuple[str, str]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("Account is missing root credentials")
        return access_key, secret_key

    def _iam(self, account: S3Account) -> RGWIAMService:
        access_key, secret_key = self._account_root_credentials(account)
        return get_iam_service(access_key, secret_key, endpoint=resolve_s3_endpoint(account))

    def _allowed_packages(self, endpoint: StorageEndpoint) -> list[str]:
        raw = getattr(endpoint, "allowed_packages", None)
        if not isinstance(raw, list):
            return []
        return [p for p in raw if isinstance(p, str) and p.strip()]

    def _enforce_guardrails(self, actor: User, actor_role_key: str, endpoint: StorageEndpoint, package_key: str) -> None:
        if actor_role_key != PortalRoleKey.ACCESS_ADMIN.value:
            return
        allowed = self._allowed_packages(endpoint)
        if allowed and package_key not in allowed:
            raise RuntimeError("This package is not allowed by delegated admin guardrails")

    def _package_policy(self, package_key: str, bucket: str) -> dict:
        bucket_arn = f"arn:aws:s3:::{bucket}"
        object_arn = f"arn:aws:s3:::{bucket}/*"
        if package_key == "BucketReadOnly":
            bucket_actions = ["s3:ListBucket"]
            object_actions = ["s3:GetObject"]
        elif package_key == "BucketReadWrite":
            bucket_actions = ["s3:ListBucket"]
            object_actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        elif package_key == "BucketAdmin":
            bucket_actions = ["s3:*"]
            object_actions = ["s3:*"]
        else:
            raise RuntimeError("Unknown package")
        return {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "PortalListAllBuckets",
                    "Effect": "Allow",
                    "Action": ["s3:ListAllMyBuckets"],
                    "Resource": ["*"],
                },
                {
                    "Sid": "PortalBucketScope",
                    "Effect": "Allow",
                    "Action": bucket_actions,
                    "Resource": [bucket_arn],
                },
                {
                    "Sid": "PortalObjectScope",
                    "Effect": "Allow",
                    "Action": object_actions,
                    "Resource": [object_arn],
                },
            ],
        }

    def _group_name(self, account: S3Account, package_key: str, bucket: str) -> str:
        bucket_part = _sanitize_name(bucket)[:40]
        suffix = _short_hash(f"{account.id}:{package_key}:{bucket}")
        name = f"portal-{account.id}-{package_key}-{bucket_part}-{suffix}"
        return name[:128]

    def _ensure_group_with_policy(
        self,
        iam: RGWIAMService,
        group_name: str,
        policy_name: str,
        policy_document: dict,
    ) -> tuple[str, Optional[str]]:
        existing_groups = {g.name for g in iam.list_groups() if g.name}
        if group_name not in existing_groups:
            iam.create_group(group_name)
        iam.put_group_inline_policy(group_name, policy_name, policy_document)
        return group_name, None

    def assign_grant(
        self,
        *,
        actor: User,
        actor_role_key: str,
        account: S3Account,
        endpoint: StorageEndpoint,
        request: PortalGrantAssignRequest,
    ) -> PortalAccessGrant:
        if request.prefix:
            raise RuntimeError("Prefix-scoped grants are not supported yet")
        self._enforce_guardrails(actor, actor_role_key, endpoint, request.package_key)

        identity = (
            self.db.query(IamIdentity)
            .filter(IamIdentity.account_id == account.id, IamIdentity.user_id == request.user_id, IamIdentity.is_enabled.is_(True))
            .first()
        )
        if not identity or not identity.iam_username:
            raise RuntimeError("Target user does not have external access enabled")

        grant = AccessGrant(
            iam_identity_id=identity.id,
            package_key=request.package_key,
            bucket=request.bucket,
            prefix=None,
            materialization_status="pending",
        )
        self.db.add(grant)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            existing = (
                self.db.query(AccessGrant)
                .filter(
                    AccessGrant.iam_identity_id == identity.id,
                    AccessGrant.package_key == request.package_key,
                    AccessGrant.bucket == request.bucket,
                    AccessGrant.prefix.is_(None),
                )
                .first()
            )
            if not existing:
                raise
            return PortalAccessGrant(
                id=existing.id,
                user_id=request.user_id,
                package_key=existing.package_key,
                bucket=existing.bucket,
                prefix=existing.prefix,
                materialization_status=existing.materialization_status,
                materialization_error=existing.materialization_error,
            )

        iam = self._iam(account)
        group_name = self._group_name(account, request.package_key, request.bucket)
        policy_name = "portal-access"
        policy_doc = self._package_policy(request.package_key, request.bucket)
        try:
            group_name, policy_arn = self._ensure_group_with_policy(iam, group_name, policy_name, policy_doc)
            iam.add_user_to_group(group_name, identity.iam_username)
            grant.materialization_status = "active"
            grant.materialization_error = None
            grant.iam_group_name = group_name
            grant.iam_policy_arn = policy_arn
        except Exception as exc:
            grant.materialization_status = "failed"
            grant.materialization_error = str(exc)
        self.db.add(grant)
        self.db.commit()
        self.db.refresh(grant)
        return PortalAccessGrant(
            id=grant.id,
            user_id=request.user_id,
            package_key=grant.package_key,
            bucket=grant.bucket,
            prefix=grant.prefix,
            materialization_status=grant.materialization_status,
            materialization_error=grant.materialization_error,
        )

    def revoke_grant(self, *, account: S3Account, user_id: int, grant_id: int) -> None:
        grant = (
            self.db.query(AccessGrant)
            .join(IamIdentity, IamIdentity.id == AccessGrant.iam_identity_id)
            .filter(AccessGrant.id == grant_id, IamIdentity.account_id == account.id, IamIdentity.user_id == user_id)
            .first()
        )
        if not grant:
            return
        identity = self.db.query(IamIdentity).filter(IamIdentity.id == grant.iam_identity_id).first()
        iam_username = identity.iam_username if identity else None
        group_name = grant.iam_group_name
        self.db.delete(grant)
        self.db.commit()

        if iam_username and group_name:
            try:
                iam = self._iam(account)
                iam.remove_user_from_group(group_name, iam_username)
            except Exception as exc:
                logger.info("Unable to remove user from group %s: %s", group_name, exc)
