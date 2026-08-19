# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import copy
from typing import Any, Optional

from app.db import PortalStorageSpaceMetadata, S3Account
from app.models.app_settings import PortalSettings
from app.models.portal import PortalStorageSpaceRole


class PortalIamPolicyDocumentsMixin:
    def _resolve_group_policy(
        self,
        portal_settings: PortalSettings,
        group_key: str,
    ) -> Optional[dict]:
        if group_key == "manager":
            return {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Sid": "PortalManagerBootstrap",
                        "Effect": "Allow",
                        "Action": ["s3:ListAllMyBuckets", "sts:GetSessionToken"],
                        "Resource": ["*"],
                    },
                    {
                        "Sid": "PortalManagerProjectStorage",
                        "Effect": "Allow",
                        "Action": self._storage_space_role_actions("Manager"),
                        "Resource": ["arn:aws:s3:::*", "arn:aws:s3:::*/*"],
                    },
                ],
            }
        return {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "PortalUserBootstrap",
                    "Effect": "Allow",
                    "Action": ["s3:ListAllMyBuckets", "sts:GetSessionToken"],
                    "Resource": ["*"],
                }
            ],
        }

    def _storage_space_share_sid(self, role: PortalStorageSpaceRole) -> str:
        return f"{self._storage_space_share_sid_prefix}{role}"

    def _storage_space_share_sids(self) -> set[str]:
        return {
            self._storage_space_share_sid("Viewer"),
            self._storage_space_share_sid("Editor"),
            self._storage_space_share_sid("Owner"),
        }

    def _storage_space_role_actions(self, role: PortalStorageSpaceRole) -> list[str]:
        viewer_actions = [
            "s3:GetBucketLocation",
            "s3:GetBucketVersioning",
            "s3:ListBucket",
            "s3:ListBucketVersions",
            "s3:ListBucketMultipartUploads",
            "s3:GetObject",
            "s3:GetObjectVersion",
            "s3:GetObjectTagging",
            "s3:GetObjectVersionTagging",
        ]
        if role == "Viewer":
            return viewer_actions
        editor_actions = [
            *viewer_actions,
            "s3:PutObject",
            "s3:DeleteObject",
            "s3:DeleteObjectVersion",
            "s3:AbortMultipartUpload",
            "s3:ListMultipartUploadParts",
        ]
        if role == "Editor":
            return editor_actions
        owner_actions = [
            *editor_actions,
            "s3:PutObjectTagging",
            "s3:DeleteObjectTagging",
            "s3:PutObjectVersionTagging",
            "s3:DeleteObjectVersionTagging",
            "s3:GetBucketCORS",
            "s3:GetBucketAcl",
            "s3:GetBucketPolicy",
            "s3:GetLifecycleConfiguration",
        ]
        if role == "Owner":
            return owner_actions
        return [
            *owner_actions,
            "s3:PutBucketVersioning",
            "s3:PutLifecycleConfiguration",
        ]

    def _bucket_arns(self, bucket_name: str) -> list[str]:
        return [f"arn:aws:s3:::{bucket_name}", f"arn:aws:s3:::{bucket_name}/*"]

    def _storage_space_policy_actions(self) -> list[str]:
        return [
            "s3:GetBucketLocation",
            "s3:GetBucketVersioning",
            "s3:GetLifecycleConfiguration",
            "s3:ListBucket",
            "s3:ListBucketVersions",
            "s3:GetObject",
            "s3:GetObjectVersion",
            "s3:PutObject",
            "s3:DeleteObject",
            "s3:DeleteObjectVersion",
            "s3:AbortMultipartUpload",
            "s3:ListBucketMultipartUploads",
            "s3:ListMultipartUploadParts",
            "s3:PutBucketVersioning",
            "s3:PutLifecycleConfiguration",
        ]

    def _without_storage_space_policy_statements(self, policy: Optional[dict]) -> Optional[dict]:
        if not isinstance(policy, dict):
            return None
        statements = policy.get("Statement") or []
        if not isinstance(statements, list):
            statements = [statements]
        managed_sids = {
            self._storage_space_access_sid,
            self._storage_space_private_sid,
            self._storage_space_archived_sid,
        }
        filtered = [stmt for stmt in statements if not (isinstance(stmt, dict) and stmt.get("Sid") in managed_sids)]
        if not filtered:
            return None
        cleaned = copy.deepcopy(policy)
        cleaned["Statement"] = filtered
        if "Version" not in cleaned:
            cleaned["Version"] = "2012-10-17"
        return cleaned

    def _storage_space_bucket_policy(
        self,
        account: S3Account,
        bucket_name: str,
        metadata: PortalStorageSpaceMetadata,
        existing_policy: Optional[dict],
    ) -> Optional[dict]:
        policy = self._without_storage_space_policy_statements(existing_policy) or {
            "Version": "2012-10-17",
            "Statement": [],
        }
        statements = policy.get("Statement") or []
        if not isinstance(statements, list):
            statements = [statements]
        resources = self._bucket_arns(bucket_name)
        actions = self._storage_space_policy_actions()
        if metadata.archived_at:
            statements.append(
                {
                    "Sid": self._storage_space_archived_sid,
                    "Effect": "Deny",
                    "Principal": "*",
                    "Action": actions,
                    "Resource": resources,
                }
            )
        else:
            allowed_principals = self._portal_policy_principals_for_space(account, metadata)
            statement: dict[str, Any] = {
                "Sid": self._storage_space_access_sid,
                "Effect": "Deny",
                "Action": actions,
                "Resource": resources,
            }
            if allowed_principals:
                statement["NotPrincipal"] = {"AWS": allowed_principals}
            else:
                statement["Principal"] = "*"
            statements.append(statement)
        if not statements:
            return None
        policy["Statement"] = statements
        if "Version" not in policy:
            policy["Version"] = "2012-10-17"
        return policy

    def _role_precedence(self, role: PortalStorageSpaceRole) -> int:
        return {"Viewer": 1, "Editor": 2, "Owner": 3, "Manager": 4}[role]

    def _portal_bucket_cors_rules(self, origins: list[str]) -> list[dict]:
        return [
            {
                "AllowedOrigins": origins,
                "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
                "AllowedHeaders": ["Content-Type", "Authorization", "x-amz-*"],
                "ExposeHeaders": ["ETag", "x-amz-request-id", "x-amz-id-2"],
                "MaxAgeSeconds": 3000,
            }
        ]

    def _portal_bucket_lifecycle_rules(self, noncurrent_version_expiration_days: int) -> list[dict]:
        return [
            {
                "ID": "ExpireDeleteMarkers",
                "Status": "Enabled",
                "Prefix": "",
                "Expiration": {"ExpiredObjectDeleteMarker": True},
            },
            {
                "ID": "ExpireOldVersions",
                "Status": "Enabled",
                "Prefix": "",
                "NoncurrentVersionExpiration": {
                    "NoncurrentDays": noncurrent_version_expiration_days,
                },
            },
        ]
