# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *
from app.services.mappers.portal import portal_access_key_from_active_link, portal_access_key_from_iam_metadata


class PortalIamMixin:
    def _normalize_actions(self, actions: Optional[list[str]]) -> list[str]:
        return normalize_string_list(actions)

    def _normalize_origins(self, origins: Optional[list[str]]) -> list[str]:
        return normalize_string_list(origins)

    def _policy_statements(self, policy: Optional[dict]) -> list[dict]:
        if not policy or not isinstance(policy, dict):
            return []
        statements = policy.get("Statement") or []
        if not isinstance(statements, list):
            statements = [statements]
        return [stmt for stmt in statements if isinstance(stmt, dict)]

    def _without_allowed_policy_actions(self, policy: dict, blocked_actions: set[str]) -> dict:
        statements = policy.get("Statement") or []
        original_was_list = isinstance(statements, list)
        if not original_was_list:
            statements = [statements]
        filtered_statements: list[dict] = []
        for statement in statements:
            if not isinstance(statement, dict):
                continue
            current = copy.deepcopy(statement)
            if str(current.get("Effect") or "").lower() == "allow" and "Action" in current:
                action = current.get("Action")
                if isinstance(action, str):
                    if action.lower() in blocked_actions:
                        continue
                elif isinstance(action, list):
                    allowed_actions = [
                        item
                        for item in action
                        if not isinstance(item, str) or item.lower() not in blocked_actions
                    ]
                    if not allowed_actions:
                        continue
                    current["Action"] = allowed_actions
            filtered_statements.append(current)
        policy["Statement"] = (
            filtered_statements
            if original_was_list or len(filtered_statements) != 1
            else filtered_statements[0]
        )
        return policy

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
        return [
            *editor_actions,
            "s3:PutObjectTagging",
            "s3:DeleteObjectTagging",
            "s3:PutObjectVersionTagging",
            "s3:DeleteObjectVersionTagging",
            "s3:GetBucketVersioning",
            "s3:GetBucketCORS",
            "s3:GetBucketAcl",
            "s3:GetBucketPolicy",
            "s3:GetLifecycleConfiguration",
        ]

    def _bucket_arns(self, bucket_name: str) -> list[str]:
        return [f"arn:aws:s3:::{bucket_name}", f"arn:aws:s3:::{bucket_name}/*"]

    def _storage_space_policy_actions(self) -> list[str]:
        return [
            "s3:GetBucketLocation",
            "s3:ListBucket",
            "s3:GetObject",
            "s3:PutObject",
            "s3:DeleteObject",
            "s3:AbortMultipartUpload",
            "s3:ListBucketMultipartUploads",
            "s3:ListMultipartUploadParts",
        ]

    def _metadata_visibility(
        self,
        metadata: PortalStorageSpaceMetadata | None,
    ) -> PortalStorageSpaceVisibility:
        if metadata and metadata.visibility in {"private", "shared"}:
            return metadata.visibility  # type: ignore[return-value]
        return "private"

    def _metadata_share_scope(
        self,
        metadata: PortalStorageSpaceMetadata | None,
    ) -> PortalStorageSpaceShareScope:
        if self._metadata_visibility(metadata) != "shared":
            return "restricted"
        if metadata and metadata.share_scope == "account":
            return "account"
        return "restricted"

    def _metadata_account_member_role(
        self,
        metadata: PortalStorageSpaceMetadata | None,
    ) -> Optional[PortalStorageSpaceRole]:
        if self._metadata_share_scope(metadata) != "account":
            return None
        if metadata and metadata.account_member_role in {"Viewer", "Editor"}:
            return metadata.account_member_role  # type: ignore[return-value]
        return "Editor"

    def _storage_space_role_is_valid(self, role: Optional[str]) -> bool:
        return role in {"Viewer", "Editor", "Owner", "Manager"}

    def _best_storage_space_role(self, *roles: Optional[str]) -> Optional[PortalStorageSpaceRole]:
        best: Optional[PortalStorageSpaceRole] = None
        for role in roles:
            if not self._storage_space_role_is_valid(role):
                continue
            typed_role = role  # type: ignore[assignment]
            if best is None or self._role_precedence(typed_role) > self._role_precedence(best):
                best = typed_role
        return best

    def _normalize_storage_space_sharing(
        self,
        visibility: PortalStorageSpaceVisibility,
        share_scope: Optional[PortalStorageSpaceShareScope],
        account_member_role: Optional[PortalStorageSpaceRole],
    ) -> tuple[PortalStorageSpaceShareScope, Optional[PortalStorageSpaceRole]]:
        if visibility != "shared":
            return "restricted", None
        scope = "account" if share_scope == "account" else "restricted"
        if scope != "account":
            return scope, None
        if account_member_role in {"Viewer", "Editor"}:
            return scope, account_member_role
        return scope, "Editor"

    def _portal_account_member_map(self, account: S3Account) -> dict[int, tuple[User, str, set[str]]]:
        role_rank = {
            AccountRole.PORTAL_NONE.value: 0,
            AccountRole.PORTAL_USER.value: 1,
            AccountRole.PORTAL_MANAGER.value: 2,
        }
        rank_role = {
            1: AccountRole.PORTAL_USER.value,
            2: AccountRole.PORTAL_MANAGER.value,
        }
        rows_by_user: dict[int, tuple[User, str, set[str]]] = {}

        def merge(user: User, role: Optional[str], source: str) -> None:
            if role not in {AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value}:
                return
            if not bool(user.is_active):
                return
            current = rows_by_user.get(user.id)
            current_rank = role_rank.get(current[1], 0) if current else 0
            next_rank = max(current_rank, role_rank.get(role or AccountRole.PORTAL_NONE.value, 0))
            sources = set(current[2]) if current else set()
            sources.add(source)
            rows_by_user[user.id] = (user, rank_role.get(next_rank, AccountRole.PORTAL_USER.value), sources)

        direct_rows = (
            self.db.query(User, UserS3Account.account_role)
            .join(UserS3Account, UserS3Account.user_id == User.id)
            .filter(UserS3Account.account_id == account.id)
            .filter(UserS3Account.account_role.in_([AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value]))
            .all()
        )
        for user, role in direct_rows:
            merge(user, role, "direct")

        group_rows = (
            self.db.query(User, UiGroupS3Account.account_role)
            .join(UserUiGroup, UserUiGroup.user_id == User.id)
            .join(UiGroupS3Account, UiGroupS3Account.group_id == UserUiGroup.group_id)
            .filter(UiGroupS3Account.account_id == account.id)
            .filter(UiGroupS3Account.account_role.in_([AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value]))
            .all()
        )
        for user, role in group_rows:
            merge(user, role, "group")

        return rows_by_user

    def _is_portal_manager_access(self, access: "AccountAccess") -> bool:
        return access.role == AccountRole.PORTAL_MANAGER.value

    def _storage_space_owner_label(
        self,
        account: S3Account,
        metadata: PortalStorageSpaceMetadata | None,
    ) -> str:
        if metadata and metadata.owner_user_id:
            owner = self.db.query(User).filter(User.id == metadata.owner_user_id).first()
            if owner and owner.email:
                return owner.email
        return account.name if self._metadata_visibility(metadata) == "private" else ""

    def _storage_space_effective_role(
        self,
        user: User,
        access: "AccountAccess",
        metadata: PortalStorageSpaceMetadata | None,
        role: Optional[PortalStorageSpaceRole],
        *,
        include_archived: bool = False,
    ) -> Optional[PortalStorageSpaceRole]:
        if metadata is None:
            return None
        if metadata.archived_at and not include_archived:
            return None
        if metadata.owner_user_id == user.id:
            return "Owner"
        if self._is_portal_manager_access(access):
            return "Manager"
        if metadata.archived_at:
            return role if include_archived and role in {"Owner", "Manager"} else None
        if self._metadata_visibility(metadata) != "shared":
            return None
        return role

    def _storage_space_effective_content_role(
        self,
        user: User,
        access: "AccountAccess",
        metadata: PortalStorageSpaceMetadata | None,
        role: Optional[PortalStorageSpaceRole],
    ) -> Optional[PortalStorageSpaceRole]:
        if metadata is None or metadata.archived_at:
            return None
        if metadata.owner_user_id == user.id:
            return "Owner"
        if self._is_portal_manager_access(access):
            return "Manager"
        if self._metadata_visibility(metadata) != "shared":
            return None
        return role

    @staticmethod
    def _portal_iam_principal_arns(account: S3Account, iam_username: str, iam_user_id: Optional[str]) -> list[str]:
        username = (iam_username or "").strip()
        if not username:
            return []
        arns: list[str] = []
        if iam_user_id and str(iam_user_id).startswith("arn:"):
            arns.append(str(iam_user_id))
        arns.append(f"arn:aws:iam:::user/{username}")
        rgw_account_id = str(getattr(account, "rgw_account_id", "") or "").strip()
        if rgw_account_id:
            arns.append(f"arn:aws:iam::{rgw_account_id}:user/{username}")
        return sorted(set(arns))

    def _portal_policy_principals_for_user_ids(
        self,
        account: S3Account,
        allowed_user_ids: set[int],
    ) -> list[str]:
        if not allowed_user_ids:
            return []
        rows = (
            self.db.query(AccountIAMUser.iam_username, AccountIAMUser.iam_user_id)
            .filter(
                AccountIAMUser.account_id == account.id,
                AccountIAMUser.user_id.in_(allowed_user_ids),
                AccountIAMUser.iam_username.isnot(None),
            )
            .all()
        )
        principals: set[str] = set()
        for iam_username, iam_user_id in rows:
            principals.update(self._portal_iam_principal_arns(account, iam_username, iam_user_id))
        return sorted(principals)

    def _portal_policy_principals_for_external_credentials(
        self,
        account: S3Account,
        metadata: PortalStorageSpaceMetadata,
    ) -> list[str]:
        if metadata.id is None:
            return []
        rows = (
            self.db.query(
                PortalExternalAccessCredential.iam_username,
                PortalExternalAccessCredential.iam_user_id,
            )
            .filter(
                PortalExternalAccessCredential.account_id == account.id,
                PortalExternalAccessCredential.storage_space_metadata_id == metadata.id,
                PortalExternalAccessCredential.revoked_at.is_(None),
                PortalExternalAccessCredential.status == "Active",
            )
            .all()
        )
        principals: set[str] = set()
        for iam_username, iam_user_id in rows:
            principals.update(self._portal_iam_principal_arns(account, iam_username, iam_user_id))
        return sorted(principals)

    def _portal_manager_principal_arns(self, account: S3Account) -> list[str]:
        manager_user_ids = {
            user_id
            for user_id, (_target, role, _sources) in self._portal_account_member_map(account).items()
            if role == AccountRole.PORTAL_MANAGER.value
        }
        return self._portal_policy_principals_for_user_ids(account, manager_user_ids)

    def _portal_storage_space_allowed_user_ids(
        self,
        account: S3Account,
        metadata: PortalStorageSpaceMetadata,
    ) -> set[int]:
        if metadata.archived_at:
            return set()
        allowed_user_ids: set[int] = {
            user_id
            for user_id, (_target, role, _sources) in self._portal_account_member_map(account).items()
            if role == AccountRole.PORTAL_MANAGER.value
        }
        if metadata.owner_user_id is not None:
            allowed_user_ids.add(metadata.owner_user_id)
        if self._metadata_visibility(metadata) != "shared":
            return allowed_user_ids
        if self._metadata_share_scope(metadata) == "account":
            allowed_user_ids.update(self._portal_account_member_map(account))
            return allowed_user_ids
        if metadata.id is None:
            return allowed_user_ids
        grant_rows = (
            self.db.query(PortalStorageSpaceGrant.user_id)
            .filter(PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id)
            .all()
        )
        allowed_user_ids.update(user_id for (user_id,) in grant_rows if user_id is not None)
        return allowed_user_ids

    def _portal_storage_space_technical_principal_arns(self, account: S3Account) -> list[str]:
        principals: set[str] = set()
        rgw_account_id = str(getattr(account, "rgw_account_id", "") or "").strip()
        if rgw_account_id:
            principals.add(f"arn:aws:iam::{rgw_account_id}:root")
        rgw_user_uid = str(getattr(account, "rgw_user_uid", "") or "").strip()
        if rgw_user_uid:
            principals.update(self._portal_iam_principal_arns(account, rgw_user_uid, None))
        return sorted(principals)

    def _portal_policy_principals_for_space(
        self,
        account: S3Account,
        metadata: PortalStorageSpaceMetadata,
    ) -> list[str]:
        allowed_user_ids = self._portal_storage_space_allowed_user_ids(account, metadata)
        user_principals = self._portal_policy_principals_for_user_ids(account, allowed_user_ids)
        external_principals = self._portal_policy_principals_for_external_credentials(account, metadata)
        if not user_principals and not external_principals:
            return []
        principals = {*user_principals, *external_principals}
        if self._metadata_visibility(metadata) == "shared":
            principals.update(self._portal_storage_space_technical_principal_arns(account))
        return sorted(principals)

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

    def _sync_storage_space_bucket_policy(
        self,
        account: S3Account,
        bucket_name: str,
        metadata: PortalStorageSpaceMetadata,
    ) -> None:
        if not getattr(account, "storage_endpoint", None) and not getattr(account, "storage_endpoint_url", None):
            logger.debug("Skipping Portal Storage Space bucket policy sync without S3 endpoint: %s", bucket_name)
            return
        access_key, secret_key = self._account_credentials(account)
        kwargs = self._s3_client_kwargs(account)
        existing_policy = s3_client.get_bucket_policy(
            bucket_name,
            access_key=access_key,
            secret_key=secret_key,
            **kwargs,
        )
        policy = self._storage_space_bucket_policy(account, bucket_name, metadata, existing_policy)
        if policy is not None:
            s3_client.put_bucket_policy(
                bucket_name,
                policy=policy,
                access_key=access_key,
                secret_key=secret_key,
                **kwargs,
            )
            return
        if self._without_storage_space_policy_statements(existing_policy) is None and isinstance(existing_policy, dict):
            s3_client.delete_bucket_policy(
                bucket_name,
                access_key=access_key,
                secret_key=secret_key,
                **kwargs,
            )
        elif isinstance(existing_policy, dict):
            cleaned = self._without_storage_space_policy_statements(existing_policy)
            if cleaned is not None:
                s3_client.put_bucket_policy(
                    bucket_name,
                    policy=cleaned,
                    access_key=access_key,
                    secret_key=secret_key,
                    **kwargs,
                )

    def _sync_account_storage_space_bucket_policies(self, account: S3Account) -> None:
        metadata_rows = (
            self.db.query(PortalStorageSpaceMetadata)
            .filter(PortalStorageSpaceMetadata.account_id == account.id)
            .all()
        )
        for metadata in metadata_rows:
            self._sync_storage_space_access_projection(account, metadata, sync_participants=False)

    def _bucket_names_from_resources(self, resources: Any) -> set[str]:
        if not isinstance(resources, list):
            resources = [resources]
        buckets: set[str] = set()
        for res in resources:
            if not isinstance(res, str) or not res.startswith("arn:aws:s3:::"):
                continue
            name = res.replace("arn:aws:s3:::", "")
            buckets.add(name.replace("/*", ""))
        return buckets

    def _role_precedence(self, role: PortalStorageSpaceRole) -> int:
        return {"Viewer": 1, "Editor": 2, "Owner": 3, "Manager": 4}[role]

    def _merge_storage_space_role(
        self,
        roles_by_bucket: dict[str, PortalStorageSpaceRole],
        bucket_name: str,
        role: PortalStorageSpaceRole,
    ) -> None:
        current = roles_by_bucket.get(bucket_name)
        if current is None or self._role_precedence(role) > self._role_precedence(current):
            roles_by_bucket[bucket_name] = role

    def _extract_storage_space_access(self, policy: Optional[dict]) -> dict[str, PortalStorageSpaceRole]:
        roles_by_bucket: dict[str, PortalStorageSpaceRole] = {}
        statements = self._policy_statements(policy)
        sid_to_role = {
            self._bucket_access_sid: "Editor",
            self._storage_space_share_sid("Viewer"): "Viewer",
            self._storage_space_share_sid("Editor"): "Editor",
            self._storage_space_share_sid("Owner"): "Owner",
        }
        for stmt in statements:
            sid = stmt.get("Sid")
            role = sid_to_role.get(sid)
            if role is None:
                continue
            for bucket_name in self._bucket_names_from_resources(stmt.get("Resource") or []):
                self._merge_storage_space_role(roles_by_bucket, bucket_name, role)
        return roles_by_bucket

    def _db_storage_space_access(
        self,
        target: User,
        account: S3Account,
        account_role: str,
        *,
        include_archived: bool = False,
    ) -> dict[str, PortalStorageSpaceRole]:
        if account_role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            return {}
        rows = (
            self.db.query(PortalStorageSpaceMetadata, PortalStorageSpaceGrant.role)
            .outerjoin(
                PortalStorageSpaceGrant,
                (PortalStorageSpaceGrant.storage_space_metadata_id == PortalStorageSpaceMetadata.id)
                & (PortalStorageSpaceGrant.user_id == target.id),
            )
            .filter(PortalStorageSpaceMetadata.account_id == account.id)
            .all()
        )
        access_by_bucket: dict[str, PortalStorageSpaceRole] = {}
        for metadata, grant_role in rows:
            if metadata.archived_at and not include_archived:
                continue
            if account_role == AccountRole.PORTAL_MANAGER.value:
                access_by_bucket[metadata.bucket_name] = "Manager"
                continue
            if metadata.owner_user_id == target.id:
                access_by_bucket[metadata.bucket_name] = "Owner"
                continue
            if (metadata.archived_at and not include_archived) or self._metadata_visibility(metadata) != "shared":
                continue
            role = self._best_storage_space_role(
                self._metadata_account_member_role(metadata),
                grant_role,
            )
            if role:
                access_by_bucket[metadata.bucket_name] = role
        return access_by_bucket

    def _db_storage_space_content_access(
        self,
        target: User,
        account: S3Account,
        account_role: str,
        *,
        include_archived: bool = False,
    ) -> dict[str, PortalStorageSpaceRole]:
        if account_role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            return {}
        rows = (
            self.db.query(PortalStorageSpaceMetadata, PortalStorageSpaceGrant.role)
            .outerjoin(
                PortalStorageSpaceGrant,
                (PortalStorageSpaceGrant.storage_space_metadata_id == PortalStorageSpaceMetadata.id)
                & (PortalStorageSpaceGrant.user_id == target.id),
            )
            .filter(PortalStorageSpaceMetadata.account_id == account.id)
            .all()
        )
        access_by_bucket: dict[str, PortalStorageSpaceRole] = {}
        for metadata, grant_role in rows:
            if metadata.archived_at and not include_archived:
                continue
            if account_role == AccountRole.PORTAL_MANAGER.value:
                access_by_bucket[metadata.bucket_name] = "Manager"
                continue
            if metadata.owner_user_id == target.id:
                access_by_bucket[metadata.bucket_name] = "Owner"
                continue
            if self._metadata_visibility(metadata) != "shared":
                continue
            role = self._best_storage_space_role(
                self._metadata_account_member_role(metadata),
                grant_role,
            )
            if role:
                access_by_bucket[metadata.bucket_name] = role
        return access_by_bucket

    def _user_s3_account_role(self, user_id: int, account_id: int) -> str:
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if account is None:
            return AccountRole.PORTAL_NONE.value
        row = self._portal_account_member_map(account).get(user_id)
        return row[1] if row else AccountRole.PORTAL_NONE.value

    def _sync_user_storage_space_policy_projection(
        self,
        iam_service: RGWIAMService,
        iam_username: Optional[str],
        access_by_bucket: dict[str, PortalStorageSpaceRole],
    ) -> None:
        if not iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        policy = iam_service.get_user_inline_policy(iam_username, self._bucket_access_policy_name) or {}
        statements = policy.get("Statement") or []
        if not isinstance(statements, list):
            statements = [statements]
        managed_sids = {self._bucket_access_sid, *self._storage_space_share_sids()}
        next_statements = [
            copy.deepcopy(stmt)
            for stmt in statements
            if isinstance(stmt, dict) and stmt.get("Sid") not in managed_sids
        ]
        for role in ("Viewer", "Editor", "Owner"):
            resources: list[str] = []
            for bucket_name, bucket_role in sorted(access_by_bucket.items()):
                if bucket_role != role:
                    continue
                resources.extend(self._bucket_arns(bucket_name))
            if resources:
                next_statements.append(
                    {
                        "Sid": self._storage_space_share_sid(role),
                        "Effect": "Allow",
                        "Action": self._storage_space_role_actions(role),
                        "Resource": resources,
                    }
                )
        if next_statements:
            iam_service.put_user_inline_policy(
                iam_username,
                self._bucket_access_policy_name,
                {
                    "Version": policy.get("Version") or "2012-10-17",
                    "Statement": next_statements,
                },
            )
            return
        iam_service.delete_user_inline_policy(iam_username, self._bucket_access_policy_name)

    def _sync_user_storage_space_projection(
        self,
        user: User,
        account: S3Account,
        account_role: str,
        iam_service: RGWIAMService,
        iam_username: Optional[str],
    ) -> None:
        access_by_bucket = (
            {}
            if account_role == AccountRole.PORTAL_MANAGER.value
            else self._db_storage_space_content_access(user, account, account_role)
        )
        self._sync_user_storage_space_policy_projection(iam_service, iam_username, access_by_bucket)

    def _storage_space_participant_user_ids(self, metadata: PortalStorageSpaceMetadata) -> set[int]:
        user_ids: set[int] = set()
        if metadata.owner_user_id is not None:
            user_ids.add(metadata.owner_user_id)
        grant_rows = (
            self.db.query(PortalStorageSpaceGrant.user_id)
            .filter(PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id)
            .all()
        )
        user_ids.update(user_id for (user_id,) in grant_rows if user_id is not None)
        account = self.db.query(S3Account).filter(S3Account.id == metadata.account_id).first()
        if account is not None:
            user_ids.update(
                user_id
                for user_id, (_target, role, _sources) in self._portal_account_member_map(account).items()
                if role == AccountRole.PORTAL_MANAGER.value
            )
        if self._metadata_account_member_role(metadata):
            if account is not None:
                user_ids.update(self._portal_account_member_map(account))
        return user_ids

    def _sync_storage_space_participant_projections(
        self,
        account: S3Account,
        metadata: PortalStorageSpaceMetadata,
        *,
        extra_user_ids: Optional[set[int]] = None,
    ) -> None:
        participant_user_ids = self._storage_space_participant_user_ids(metadata)
        if extra_user_ids:
            participant_user_ids.update(extra_user_ids)
        self._sync_storage_space_user_projections(account, participant_user_ids)

    def _sync_storage_space_user_projections(
        self,
        account: S3Account,
        user_ids: set[int],
    ) -> None:
        if not user_ids:
            return
        rows = (
            self.db.query(User, AccountIAMUser.iam_username)
            .outerjoin(
                AccountIAMUser,
                (AccountIAMUser.user_id == User.id) & (AccountIAMUser.account_id == account.id),
            )
            .filter(User.id.in_(user_ids))
            .all()
        )
        member_roles = {user_id: row[1] for user_id, row in self._portal_account_member_map(account).items()}
        rows = [(target, member_roles.get(target.id), iam_username) for target, iam_username in rows if iam_username]
        if not rows:
            return
        iam_service = self._get_iam_service(account)
        for target, account_role, iam_username in rows:
            if account_role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
                continue
            self._sync_user_group_membership(
                iam_service,
                iam_username,
                account_role,
                portal_settings=self._effective_portal_settings(account),
                account=account,
            )
            self._sync_user_storage_space_projection(target, account, account_role, iam_service, iam_username)

    def _sync_storage_space_access_projection(
        self,
        account: S3Account,
        metadata: PortalStorageSpaceMetadata,
        *,
        extra_user_ids: Optional[set[int]] = None,
        sync_participants: bool = True,
        sync_bucket_policy: bool = True,
    ) -> None:
        if sync_participants:
            self._sync_storage_space_participant_projections(
                account,
                metadata,
                extra_user_ids=extra_user_ids,
            )
        if sync_bucket_policy:
            self._sync_storage_space_bucket_policy(account, metadata.bucket_name, metadata)

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

    def _portal_bucket_lifecycle_rules(self) -> list[dict]:
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
                "NoncurrentVersionExpiration": {"NoncurrentDays": 90},
            },
        ]

    def _is_active_status(self, status: Optional[str], default: bool = True) -> bool:
        if status is None:
            return default
        normalized = status.strip().lower()
        if not normalized:
            return default
        if normalized == "active":
            return True
        if normalized == "inactive":
            return False
        return default

    def _account_credentials(self, account: S3Account) -> tuple[str, str]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3Account is missing root credentials")
        return access_key, secret_key

    def _s3_client_kwargs(self, account: S3Account) -> dict:
        endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(account)
        return {
            "endpoint": endpoint,
            "region": region,
            "force_path_style": force_path_style,
            "verify_tls": verify_tls,
        }

    def _supervision_admin_for_account(self, account: S3Account) -> RGWAdminClient:
        endpoint = getattr(account, "storage_endpoint", None)
        if endpoint is None and account.storage_endpoint_id:
            endpoint = (
                self.db.query(StorageEndpoint)
                .filter(StorageEndpoint.id == account.storage_endpoint_id)
                .first()
            )
        if not endpoint:
            raise RuntimeError("Endpoint de supervision manquant pour ce compte")
        flags = resolve_feature_flags(endpoint)
        if not flags.metrics_enabled:
            raise RuntimeError("Storage metrics are disabled for this endpoint")
        try:
            return get_supervision_rgw_client(endpoint)
        except ValueError as exc:
            raise RuntimeError("Supervision credentials are missing for this endpoint.") from exc

    def _quota_admin_for_account(self, account: S3Account) -> Optional[RGWAdminClient]:
        endpoint = getattr(account, "storage_endpoint", None)
        if endpoint is None and account.storage_endpoint_id:
            endpoint = (
                self.db.query(StorageEndpoint)
                .filter(StorageEndpoint.id == account.storage_endpoint_id)
                .first()
            )
        if not endpoint:
            return None
        admin_endpoint = resolve_admin_endpoint(endpoint)
        access_key = getattr(endpoint, "admin_access_key", None)
        secret_key = getattr(endpoint, "admin_secret_key", None)
        if not admin_endpoint or not access_key or not secret_key:
            return None
        try:
            return get_rgw_admin_client(
                access_key=access_key,
                secret_key=secret_key,
                endpoint=admin_endpoint,
                region=endpoint.region,
                verify_tls=bool(getattr(endpoint, "verify_tls", True)),
            )
        except Exception as exc:
            logger.warning("Unable to build admin client for quota lookup: %s", exc)
            return None

    def _account_quota(self, account: S3Account) -> tuple[Optional[int], Optional[int]]:
        if not account.rgw_account_id:
            return None, None
        admin = self._quota_admin_for_account(account)
        if not admin:
            return None, None
        try:
            return admin.get_account_quota(account.rgw_account_id)
        except RGWAdminError as exc:
            logger.warning("Unable to fetch portal quota for %s: %s", account.rgw_account_id, exc)
            return None, None

    def _account_limits(self, account: S3Account) -> tuple[Optional[int], Optional[int], Optional[int]]:
        if not account.rgw_account_id:
            return None, None, None
        admin = self._quota_admin_for_account(account)
        if not admin:
            return None, None, None
        try:
            payload = admin.get_account(
                account.rgw_account_id,
                allow_not_found=True,
                allow_not_implemented=True,
            ) or {}
        except RGWAdminError as exc:
            logger.warning("Unable to fetch portal account limits for %s: %s", account.rgw_account_id, exc)
            return None, None, None
        max_size_bytes, max_objects = extract_quota_limits(payload, keys=("quota", "account_quota"))
        if max_size_bytes is None and max_objects is None:
            try:
                max_size_bytes, max_objects = admin.get_account_quota(account.rgw_account_id)
            except RGWAdminError as exc:
                logger.warning("Unable to fetch portal quota fallback for %s: %s", account.rgw_account_id, exc)
        return max_size_bytes, max_objects, _extract_account_limit(payload, "max_buckets")

    def _admin_bucket_list(self, account: S3Account, admin: Optional[RGWAdminClient] = None) -> list[dict]:
        uid = resolve_admin_uid(account.rgw_account_id, account.rgw_user_uid)
        if not uid:
            return []
        rgw_admin = admin or self._supervision_admin_for_account(account)
        payload = rgw_admin.get_all_buckets(uid=uid, with_stats=True)
        return extract_bucket_list(payload)

    def _bucket_usage_from_list(self, buckets: list[dict]) -> tuple[Optional[int], Optional[int], int]:
        total_bytes = 0
        total_objects = 0
        has_bytes = False
        has_objects = False
        for bucket in buckets:
            usage = bucket.get("usage") if isinstance(bucket, dict) else None
            usage_bytes, usage_objects = extract_usage_stats(usage)
            if usage_bytes is not None:
                total_bytes += usage_bytes
                has_bytes = True
            if usage_objects is not None:
                total_objects += usage_objects
                has_objects = True
        return (
            total_bytes if has_bytes else None,
            total_objects if has_objects else None,
            len(buckets),
        )

    def _get_iam_service(self, account: S3Account) -> RGWIAMService:
        access_key, secret_key = self._account_credentials(account)
        endpoint, region, _, verify_tls = resolve_s3_client_options(account)
        return get_iam_service(
            access_key,
            secret_key,
            endpoint=endpoint,
            region=region,
            verify_tls=verify_tls,
        )

    def check_eligibility(self, user: User, access: "AccountAccess") -> tuple[bool, list[str]]:
        """Return whether the portal can be used for this account context.

        Portal is intended for RGW accounts configured with IAM semantics. This
        shell-level check is strictly local; remote IAM availability is checked
        only by the pages and actions that need it.
        """
        reasons: list[str] = []
        account = access.account
        endpoint = getattr(account, "storage_endpoint", None)
        if endpoint is None:
            reasons.append("Storage endpoint missing")
            return False, reasons

        flags = resolve_feature_flags(endpoint)
        if not flags.iam_enabled:
            reasons.append("IAM is not enabled for this endpoint")

        if not account.rgw_account_id:
            reasons.append("Portal requires an RGW account")

        return (len(reasons) == 0), reasons

    def _generate_username(self, account: S3Account, user: User) -> str:
        base = f"portal-{account.id}-{user.id}"
        return base[:63]

    def _persist_portal_key(self, link: AccountIAMUser, key: ModelAccessKey) -> PortalAccessKey:
        link.active_access_key = key.access_key_id
        link.active_secret_key = key.secret_access_key
        self.db.add(link)
        self.db.commit()
        self.db.refresh(link)
        return portal_access_key_from_iam_metadata(
            key,
            is_portal=True,
            deletable=False,
            secret_access_key=key.secret_access_key,
            is_active=True,
        )

    def _ensure_portal_user(
        self,
        user: User,
        account: S3Account,
        iam_service: RGWIAMService,
    ) -> Tuple[AccountIAMUser, Optional[IAMUser], bool]:
        link = (
            self.db.query(AccountIAMUser)
            .filter(
                AccountIAMUser.user_id == user.id,
                AccountIAMUser.account_id == account.id,
            )
            .first()
        )
        created = False
        iam_user: Optional[IAMUser] = None
        created_key: Optional[ModelAccessKey] = None

        if link and link.iam_username:
            iam_user = iam_service.get_user(link.iam_username)

        if link is None or iam_user is None:
            username = link.iam_username if link and link.iam_username else self._generate_username(account, user)
            iam_user, created_key = iam_service.create_user(
                username,
                create_key=True,
                allow_existing=True,
            )
            if link is None:
                link = AccountIAMUser(
                    user_id=user.id,
                    account_id=account.id,
                    iam_user_id=iam_user.user_id or iam_user.arn or username,
                    iam_username=iam_user.name,
                )
            else:
                link.iam_user_id = iam_user.user_id or iam_user.arn or username
                link.iam_username = iam_user.name
                link.active_access_key = None
                link.active_secret_key = None
            try:
                self.db.add(link)
                self.db.commit()
            except IntegrityError:
                self.db.rollback()
                link = (
                    self.db.query(AccountIAMUser)
                    .filter(
                        AccountIAMUser.user_id == user.id,
                        AccountIAMUser.account_id == account.id,
                    )
                    .first()
                )
                if not link:
                    raise
                if created_key and not link.active_access_key:
                    self._persist_portal_key(link, created_key)
            else:
                self.db.refresh(link)
                if created_key:
                    self._persist_portal_key(link, created_key)
            created = created_key is not None

        if not link.iam_user_id and iam_user:
            link.iam_user_id = iam_user.user_id or iam_user.arn or link.iam_username
            self.db.add(link)
            self.db.commit()
            self.db.refresh(link)

        if iam_user is None and link.iam_username:
            iam_user = iam_service.get_user(link.iam_username)

        return link, iam_user, created

    def _ensure_portal_policy(self, iam_service: RGWIAMService, username: str) -> None:
        try:
            existing = iam_service.list_user_inline_policies(username)
            if self._inline_policy_name in existing:
                return
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Unable to list inline policies for %s: %s", username, exc)
        policy_doc = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Action": [
                        "s3:ListAllMyBuckets",
                        "sts:GetSessionToken",
                    ],
                    "Resource": [
                        "*"
                    ],
                }
            ],
        }
        iam_service.put_user_inline_policy(username, self._inline_policy_name, policy_doc)

    def _ensure_portal_groups(
        self,
        iam_service: RGWIAMService,
        portal_settings: Optional[PortalSettings] = None,
    ) -> None:
        """Ensure portal groups exist and carry the expected policies."""
        settings = portal_settings or self._portal_settings()
        groups = {g.name for g in iam_service.list_groups()}
        if self._manager_group_name not in groups:
            iam_service.create_group(self._manager_group_name)
        if self._user_group_name not in groups:
            iam_service.create_group(self._user_group_name)

        for group_name in (self._manager_group_name, self._user_group_name):
            attached = iam_service.list_group_policies(group_name)
            for policy in attached:
                if policy.arn:
                    iam_service.detach_group_policy(group_name, policy.arn)

        manager_policy = self._resolve_group_policy(settings, "manager")
        if manager_policy:
            iam_service.put_group_inline_policy(self._manager_group_name, self._manager_group_policy_name, manager_policy)
        else:
            iam_service.delete_group_inline_policy(self._manager_group_name, self._manager_group_policy_name)

        user_policy = self._resolve_group_policy(settings, "user")
        if user_policy:
            iam_service.put_group_inline_policy(self._user_group_name, self._inline_policy_name, user_policy)
        else:
            iam_service.delete_group_inline_policy(self._user_group_name, self._inline_policy_name)

    def _sync_user_group_membership(
        self,
        iam_service: RGWIAMService,
        iam_username: Optional[str],
        account_role: Optional[str],
        portal_settings: Optional[PortalSettings] = None,
        *,
        account: Optional[S3Account] = None,
    ) -> None:
        if not iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        if account_role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            for group in (self._manager_group_name, self._user_group_name):
                try:
                    iam_service.remove_user_from_group(group, iam_username)
                except Exception as exc:  # pragma: no cover - defensive
                    logger.warning("Unable to remove %s from %s: %s", iam_username, group, exc)
            return

        # The manager group grants account-wide S3 data access. Protect the
        # technical bucket before its policy is created or updated, then remove
        # a stale deny only after a manager has left the group.
        if account is not None and account_role == AccountRole.PORTAL_MANAGER.value:
            self._sync_portal_server_access_log_bucket_policy_if_present(account)

        settings = portal_settings or self._portal_settings()
        self._ensure_portal_groups(iam_service, settings)
        target_group = self._manager_group_name if account_role == AccountRole.PORTAL_MANAGER.value else self._user_group_name
        other_group = self._user_group_name if target_group == self._manager_group_name else self._manager_group_name

        other_members = iam_service.list_group_users(other_group)
        remove_other_first = target_group == self._user_group_name
        if remove_other_first and any(m.name == iam_username for m in other_members):
            iam_service.remove_user_from_group(other_group, iam_username)

        members = iam_service.list_group_users(target_group)
        if not any(m.name == iam_username for m in members):
            iam_service.add_user_to_group(target_group, iam_username)

        if not remove_other_first and any(m.name == iam_username for m in other_members):
            iam_service.remove_user_from_group(other_group, iam_username)
        if account is not None and account_role == AccountRole.PORTAL_USER.value:
            self._sync_portal_server_access_log_bucket_policy_if_present(account)

    def _clear_user_bucket_policy(self, iam_service: RGWIAMService, iam_username: Optional[str]) -> None:
        if not iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        try:
            iam_service.delete_user_inline_policy(iam_username, self._bucket_access_policy_name)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Unable to delete bucket policy for %s: %s", iam_username, exc)

    def _ensure_policy_and_key(self, link: AccountIAMUser, iam_service: RGWIAMService) -> PortalAccessKey:
        return self._ensure_active_key(link, iam_service)

    def _existing_portal_link(self, user: User, account: S3Account) -> Optional[AccountIAMUser]:
        return (
            self.db.query(AccountIAMUser)
            .filter(
                AccountIAMUser.user_id == user.id,
                AccountIAMUser.account_id == account.id,
            )
            .first()
        )

    def _active_credentials(self, link: AccountIAMUser, iam_service: RGWIAMService) -> tuple[str, str]:
        active = self._ensure_policy_and_key(link, iam_service)
        if not active.access_key_id or not active.secret_access_key:
            raise RuntimeError("Active access key is missing for this portal user")
        return active.access_key_id, active.secret_access_key

    def get_portal_credentials(self, user: User, account: S3Account, account_role: str) -> tuple[str, str]:
        """Expose portal IAM credentials for manager access."""
        iam_service = self._get_iam_service(account)
        link, _, _ = self._ensure_portal_user(user, account, iam_service)
        portal_settings = self._effective_portal_settings(account)
        self._sync_user_group_membership(
            iam_service,
            link.iam_username,
            account_role,
            portal_settings=portal_settings,
            account=account,
        )
        self._sync_user_storage_space_projection(user, account, account_role, iam_service, link.iam_username)
        return self._active_credentials(link, iam_service)

    def _account_usage(
        self,
        account: S3Account,
        usage_map: Optional[dict[str, tuple[Optional[int], Optional[int]]]] = None,
    ) -> tuple[Optional[int], Optional[int], Optional[int]]:
        if not account.rgw_account_id and not account.rgw_user_uid:
            return None, None, None
        try:
            rgw_admin = self._supervision_admin_for_account(account)
            buckets = self._admin_bucket_list(account, admin=rgw_admin)
        except (RGWAdminError, RuntimeError) as exc:  # pragma: no cover - defensive path
            logger.warning("Unable to list buckets for portal usage %s: %s", account.rgw_account_id or account.id, exc)
            return None, None, None
        used_bytes, used_objects, bucket_count = self._bucket_usage_from_list(buckets)
        if usage_map is not None:
            for bucket in buckets:
                if not isinstance(bucket, dict):
                    continue
                name = bucket.get("bucket") or bucket.get("name")
                if not name:
                    continue
                usage = bucket.get("usage")
                usage_bytes, usage_objects = extract_usage_stats(usage)
                usage_map[name] = (usage_bytes, usage_objects)
        return used_bytes, used_objects, bucket_count

    def _account_usage_summary(self, account: S3Account) -> tuple[Optional[int], Optional[int]]:
        try:
            rgw_admin = self._supervision_admin_for_account(account)
        except (RGWAdminError, RuntimeError) as exc:  # pragma: no cover - defensive path
            logger.warning("Unable to initialize RGW admin client for portal summary: %s", exc)
            return None, None
        if not account.rgw_account_id and not account.rgw_user_uid:
            return None, None
        if account.rgw_account_id:
            try:
                stats = rgw_admin.get_account_stats(account.rgw_account_id, sync=False) or {}
            except RGWAdminError as exc:
                logger.warning("Unable to fetch account stats for portal summary: %s", exc)
                return None, None
            if isinstance(stats, dict) and stats.get("not_found"):
                return None, None
            usage_payload = None
            if isinstance(stats, dict):
                usage_payload = stats.get("stats") or stats.get("usage") or stats.get("total") or stats
                if isinstance(usage_payload, dict) and "usage" in usage_payload:
                    usage_payload = usage_payload.get("usage")
            return extract_usage_stats(usage_payload if isinstance(usage_payload, dict) else None)
        try:
            buckets = self._admin_bucket_list(account, admin=rgw_admin)
        except RGWAdminError as exc:
            logger.warning("Unable to fetch bucket usage for portal summary: %s", exc)
            return None, None
        used_bytes, used_objects, _ = self._bucket_usage_from_list(buckets)
        return used_bytes, used_objects

    def _ensure_active_key(self, link: AccountIAMUser, iam_service: RGWIAMService) -> PortalAccessKey:
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        key_list = iam_service.list_access_keys(link.iam_username)
        active = next((k for k in key_list if k.access_key_id == link.active_access_key), None)
        if active:
            if not link.active_secret_key:
                new_key = iam_service.create_access_key(link.iam_username)
                try:
                    iam_service.delete_access_key(link.iam_username, active.access_key_id)
                except Exception as exc:  # pragma: no cover - defensive
                    logger.warning("Unable to delete incomplete access key %s: %s", active.access_key_id, exc)
                return self._persist_portal_key(link, new_key)
            return portal_access_key_from_iam_metadata(
                active,
                is_portal=True,
                deletable=False,
                secret_access_key=link.active_secret_key,
                is_active=True,
            )
        new_key = iam_service.create_access_key(link.iam_username)
        # Clean up any stale keys; we only persist the active one.
        for k in key_list:
            try:
                iam_service.delete_access_key(link.iam_username, k.access_key_id)
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Unable to delete stale access key %s: %s", k.access_key_id, exc)
        return self._persist_portal_key(link, new_key)

    def _list_access_keys(
        self,
        link: AccountIAMUser,
        iam_service: RGWIAMService,
        include_portal: bool = False,
    ) -> list[PortalAccessKey]:
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        metas = iam_service.list_access_keys(link.iam_username)
        keys: list[PortalAccessKey] = []
        for meta in metas:
            is_portal = meta.access_key_id == link.active_access_key
            if is_portal and not include_portal:
                continue
            is_active = is_portal or self._is_active_status(meta.status, default=True)
            keys.append(
                portal_access_key_from_iam_metadata(
                    meta,
                    is_portal=is_portal,
                    deletable=not is_portal,
                    is_active=is_active,
                )
            )
        # Ensure the active key is reflected even if IAM did not return metadata
        if include_portal and link.active_access_key and not any(k.access_key_id == link.active_access_key for k in keys):
            keys.insert(
                0,
                portal_access_key_from_active_link(link, include_secret=True),
            )
        return keys

    def list_user_bucket_access(self, target: User, account: S3Account, account_role: str) -> list[str]:
        if account_role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            raise RuntimeError("Le role du compte ne permet pas la gestion des droits bucket.")
        iam_service = self._get_iam_service(account)
        link, _, _ = self._ensure_portal_user(target, account, iam_service)
        portal_settings = self._effective_portal_settings(account)
        self._sync_user_group_membership(
            iam_service,
            link.iam_username,
            account_role,
            portal_settings=portal_settings,
            account=account,
        )
        self._sync_user_storage_space_projection(target, account, account_role, iam_service, link.iam_username)
        return self.list_existing_user_bucket_access(target, account, account_role)

    def list_existing_user_bucket_access(self, target: User, account: S3Account, account_role: str) -> list[str]:
        """Read bucket permissions without provisioning IAM user/key side effects."""
        return sorted(self.list_existing_user_storage_space_access(target, account, account_role).keys())

    def list_existing_user_storage_space_access(
        self,
        target: User,
        account: S3Account,
        account_role: str,
    ) -> dict[str, PortalStorageSpaceRole]:
        """Read active Storage Space permissions from DB without IAM side effects."""
        return self._db_storage_space_access(target, account, account_role)

    def list_existing_user_content_bucket_access(self, target: User, account: S3Account, account_role: str) -> list[str]:
        """Read buckets where Portal credentials may access object content."""
        return sorted(self.list_existing_user_storage_space_content_access(target, account, account_role).keys())

    def list_existing_user_storage_space_content_access(
        self,
        target: User,
        account: S3Account,
        account_role: str,
    ) -> dict[str, PortalStorageSpaceRole]:
        """Read active Storage Space content permissions from DB without IAM side effects."""
        return self._db_storage_space_content_access(target, account, account_role)
