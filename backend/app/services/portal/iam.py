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

    def _normalize_policy_value(self, value: Any) -> Any:
        if isinstance(value, dict):
            return {key: self._normalize_policy_value(value[key]) for key in sorted(value)}
        if isinstance(value, list):
            normalized = [self._normalize_policy_value(item) for item in value]
            if all(isinstance(item, dict) for item in normalized):
                return sorted(normalized, key=lambda item: json.dumps(item, sort_keys=True))
            if all(isinstance(item, (str, int, float, bool, type(None))) for item in normalized):
                return sorted(normalized, key=lambda item: str(item))
            return normalized
        return value

    def _normalize_policy_document(self, policy: Optional[dict]) -> Optional[dict]:
        if policy is None or not isinstance(policy, dict):
            return None
        return self._normalize_policy_value(policy)

    def _policy_statements(self, policy: Optional[dict]) -> list[dict]:
        if not policy or not isinstance(policy, dict):
            return []
        statements = policy.get("Statement") or []
        if not isinstance(statements, list):
            statements = [statements]
        return [stmt for stmt in statements if isinstance(stmt, dict)]

    def _find_statement(self, statements: list[dict], sid: str) -> Optional[dict]:
        for stmt in statements:
            if stmt.get("Sid") == sid:
                return stmt
        return None

    def _action_set(self, value: Any) -> set[str]:
        if value is None:
            return set()
        if isinstance(value, str):
            return {value}
        if isinstance(value, list):
            return {item for item in value if isinstance(item, str)}
        return set()

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

    def _expected_bucket_action_set(self, portal_settings: PortalSettings) -> set[str]:
        advanced = portal_settings.bucket_access_policy.advanced_policy
        if isinstance(advanced, dict):
            statements = self._policy_statements(advanced)
            bucket_stmt = self._find_statement(statements, self._bucket_access_sid)
            if bucket_stmt and "Action" in bucket_stmt:
                return self._action_set(bucket_stmt.get("Action"))
        return set(self._bucket_access_actions(portal_settings))

    def _resolve_group_policy(
        self,
        portal_settings: PortalSettings,
        group_key: str,
    ) -> Optional[dict]:
        if group_key == "manager":
            group_policy = portal_settings.iam_group_manager_policy
        else:
            group_policy = portal_settings.iam_group_user_policy
        if group_policy.advanced_policy:
            policy = copy.deepcopy(group_policy.advanced_policy)
            if group_key == "manager":
                policy = self._without_allowed_policy_actions(policy, {"s3:createbucket"})
                if not self._policy_statements(policy):
                    return None
        else:
            actions = self._normalize_actions(group_policy.actions)
            if group_key == "manager":
                action_keys = {action.lower() for action in actions}
                if action_keys == {"s3:listallmybuckets", "s3:createbucket"}:
                    actions = ["s3:ListAllMyBuckets", "sts:GetSessionToken"]
                else:
                    actions = [action for action in actions if action.lower() != "s3:createbucket"]
            if not actions:
                return None
            policy = {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Action": actions,
                        "Resource": ["*"],
                    }
                ],
            }
        if isinstance(policy, dict) and "Version" not in policy:
            policy["Version"] = "2012-10-17"
        return policy

    def _bucket_access_actions(self, portal_settings: Optional[PortalSettings] = None) -> list[str]:
        settings = portal_settings or self._portal_settings()
        actions = self._normalize_actions(settings.bucket_access_policy.actions)
        return actions or list(self._bucket_access_default_actions)

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
            "s3:GetObject",
        ]
        if role == "Viewer":
            return viewer_actions
        # Owner is a Portal governance role. Personal IAM keys stay scoped to
        # Storage Space content operations; sharing and policy orchestration
        # remain controlled by the application.
        return self._storage_space_policy_actions()

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
        return role in {"Viewer", "Editor", "Owner"}

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
            self.db.query(User, UserProject.account_role)
            .join(UserProject, UserProject.user_id == User.id)
            .join(ProjectS3Account, ProjectS3Account.project_id == UserProject.project_id)
            .filter(ProjectS3Account.account_id == account.id)
            .filter(UserProject.account_role.in_([AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value]))
            .all()
        )
        for user, role in direct_rows:
            merge(user, role, "direct")

        group_rows = (
            self.db.query(User, UiGroupProject.account_role)
            .join(UserUiGroup, UserUiGroup.user_id == User.id)
            .join(UiGroupProject, UiGroupProject.group_id == UserUiGroup.group_id)
            .join(ProjectS3Account, ProjectS3Account.project_id == UiGroupProject.project_id)
            .filter(ProjectS3Account.account_id == account.id)
            .filter(UiGroupProject.account_role.in_([AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value]))
            .all()
        )
        for user, role in group_rows:
            merge(user, role, "group")

        return rows_by_user

    def _is_portal_manager_access(self, access: "AccountAccess") -> bool:
        return access.role == AccountRole.PORTAL_MANAGER.value or access.capabilities.can_manage_portal_users

    def _storage_space_owner_label(
        self,
        account: S3Account,
        metadata: PortalStorageSpaceMetadata | None,
    ) -> str:
        if metadata and metadata.owner_label:
            return metadata.owner_label
        if metadata and metadata.owner_user_id:
            owner = self.db.query(User).filter(User.id == metadata.owner_user_id).first()
            if owner and owner.email:
                return owner.email
        return account.name

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
        if self._is_portal_manager_access(access):
            return "Owner"
        if metadata.owner_user_id == user.id:
            return "Owner"
        if metadata.archived_at:
            return None
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
        principals.update(self._portal_project_policy_principals_for_user_ids(account, allowed_user_ids))
        return sorted(principals)

    def _portal_project_policy_principals_for_user_ids(
        self,
        account: S3Account,
        allowed_user_ids: set[int],
    ) -> set[str]:
        zonegroup_key = self._project_zonegroup_key(account)
        if not zonegroup_key or not allowed_user_ids:
            return set()
        rows = (
            self.db.query(ProjectIAMUser, S3Account)
            .join(ProjectS3Account, ProjectS3Account.project_id == ProjectIAMUser.project_id)
            .outerjoin(S3Account, S3Account.id == ProjectIAMUser.authority_account_id)
            .filter(ProjectS3Account.account_id == account.id)
            .filter(ProjectIAMUser.user_id.in_(allowed_user_ids))
            .filter(ProjectIAMUser.zonegroup_key == zonegroup_key)
            .filter(ProjectIAMUser.iam_username.isnot(None))
            .all()
        )
        principals: set[str] = set()
        for link, authority_account in rows:
            if not link.iam_username:
                continue
            principals.update(self._portal_iam_principal_arns(account, link.iam_username, link.iam_user_id))
            if authority_account is not None and authority_account.id != account.id:
                principals.update(self._portal_iam_principal_arns(authority_account, link.iam_username, link.iam_user_id))
        return principals

    def _portal_storage_space_allowed_user_ids(
        self,
        account: S3Account,
        metadata: PortalStorageSpaceMetadata,
    ) -> set[int]:
        if metadata.archived_at:
            return set()
        allowed_user_ids: set[int] = set()
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
        principals = set(user_principals)
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
            statement: dict[str, Any] = {
                "Sid": self._storage_space_archived_sid,
                "Effect": "Deny",
                "Action": actions,
                "Resource": resources,
            }
            technical_principals = self._portal_storage_space_technical_principal_arns(account)
            if technical_principals:
                statement["NotPrincipal"] = {"AWS": technical_principals}
            else:
                statement["Principal"] = "*"
            statements.append(statement)
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
            self._sync_storage_space_bucket_policy(account, metadata.bucket_name, metadata)

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
        return {"Viewer": 1, "Editor": 2, "Owner": 3}[role]

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

    def _storage_space_policy_action_drift(
        self,
        policy: Optional[dict],
        expected_access: dict[str, PortalStorageSpaceRole],
    ) -> list[str]:
        drifted_buckets: set[str] = set()
        sid_to_role = {
            self._bucket_access_sid: "Editor",
            self._storage_space_share_sid("Viewer"): "Viewer",
            self._storage_space_share_sid("Editor"): "Editor",
            self._storage_space_share_sid("Owner"): "Owner",
        }
        for stmt in self._policy_statements(policy):
            role = sid_to_role.get(stmt.get("Sid"))
            if role is None:
                continue
            expected_actions = {action.lower() for action in self._storage_space_role_actions(role)}
            actual_actions = {action.lower() for action in self._action_set(stmt.get("Action"))}
            if actual_actions == expected_actions:
                continue
            for bucket_name in self._bucket_names_from_resources(stmt.get("Resource") or []):
                if expected_access.get(bucket_name) == role:
                    drifted_buckets.add(bucket_name)
        return sorted(drifted_buckets)

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
                access_by_bucket[metadata.bucket_name] = "Owner"
                continue
            if metadata.owner_user_id == target.id:
                access_by_bucket[metadata.bucket_name] = "Owner"
                continue
            if metadata.archived_at or self._metadata_visibility(metadata) != "shared":
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
            if metadata.archived_at:
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

    def _project_role_for_user(self, project_id: int, user_id: int) -> str:
        roles: list[str] = [
            role
            for (role,) in self.db.query(UserProject.account_role)
            .filter(UserProject.project_id == project_id, UserProject.user_id == user_id)
            .all()
        ]
        roles.extend(
            role
            for (role,) in self.db.query(UiGroupProject.account_role)
            .join(UserUiGroup, UserUiGroup.group_id == UiGroupProject.group_id)
            .filter(UiGroupProject.project_id == project_id, UserUiGroup.user_id == user_id)
            .all()
        )
        rank = 0
        for role in roles:
            if role == AccountRole.PORTAL_MANAGER.value:
                rank = max(rank, 2)
            elif role == AccountRole.PORTAL_USER.value:
                rank = max(rank, 1)
        if rank == 2:
            return AccountRole.PORTAL_MANAGER.value
        if rank == 1:
            return AccountRole.PORTAL_USER.value
        return AccountRole.PORTAL_NONE.value

    def _project_accounts_for_zonegroup(self, project_id: int, zonegroup_key: str) -> list[S3Account]:
        rows = (
            self.db.query(S3Account)
            .join(ProjectS3Account, ProjectS3Account.account_id == S3Account.id)
            .filter(ProjectS3Account.project_id == project_id)
            .all()
        )
        return [account for account in rows if self._project_zonegroup_key(account) == zonegroup_key]

    def _project_iam_access_by_bucket(
        self,
        user: User,
        project_id: int,
        zonegroup_key: str,
        account_role: str,
    ) -> dict[str, PortalStorageSpaceRole]:
        access_by_bucket: dict[str, PortalStorageSpaceRole] = {}
        for account in self._project_accounts_for_zonegroup(project_id, zonegroup_key):
            for bucket_name, role in self._db_storage_space_content_access(user, account, account_role).items():
                self._merge_storage_space_role(access_by_bucket, bucket_name, role)
        return access_by_bucket

    def _disable_user_access_keys(self, iam_service: RGWIAMService, iam_username: Optional[str]) -> None:
        if not iam_username:
            return
        for meta in iam_service.list_access_keys(iam_username):
            if not meta.access_key_id:
                continue
            if self._is_active_status(meta.status, default=True):
                iam_service.update_access_key_status(iam_username, meta.access_key_id, "Inactive")

    def _revoke_project_iam_link(self, link: ProjectIAMUser) -> None:
        if not link.iam_username:
            return
        authority = (
            self.db.query(S3Account)
            .filter(S3Account.id == link.authority_account_id)
            .first()
            if link.authority_account_id is not None
            else None
        )
        if authority is None:
            return
        iam_service = self._get_iam_service(authority)
        self._sync_user_group_membership(iam_service, link.iam_username, AccountRole.PORTAL_NONE.value)
        self._clear_user_bucket_policy(iam_service, link.iam_username)
        self._disable_user_access_keys(iam_service, link.iam_username)

    def _sync_project_iam_link_projection(self, link: ProjectIAMUser) -> None:
        if not link.iam_username:
            return
        user = self.db.query(User).filter(User.id == link.user_id).first()
        project = self.db.query(Project).filter(Project.id == link.project_id).first()
        authority = (
            self.db.query(S3Account)
            .filter(S3Account.id == link.authority_account_id)
            .first()
            if link.authority_account_id is not None
            else None
        )
        if user is None or project is None or authority is None:
            return
        role = self._project_role_for_user(project.id, user.id)
        if not bool(user.is_active):
            role = AccountRole.PORTAL_NONE.value
        iam_service = self._get_iam_service(authority)
        if role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            self._sync_user_group_membership(iam_service, link.iam_username, AccountRole.PORTAL_NONE.value)
            self._clear_user_bucket_policy(iam_service, link.iam_username)
            self._disable_user_access_keys(iam_service, link.iam_username)
            return
        if not self._project_accounts_for_zonegroup(project.id, link.zonegroup_key):
            self._sync_user_group_membership(iam_service, link.iam_username, AccountRole.PORTAL_NONE.value)
            self._clear_user_bucket_policy(iam_service, link.iam_username)
            self._disable_user_access_keys(iam_service, link.iam_username)
            return
        settings = self._effective_portal_settings(
            authority,
            admin_override=self._load_project_portal_settings_overrides(project),
        )
        self._sync_user_group_membership(iam_service, link.iam_username, role, portal_settings=settings)
        access_by_bucket = self._project_iam_access_by_bucket(user, project.id, link.zonegroup_key, role)
        self._sync_user_storage_space_policy_projection(iam_service, link.iam_username, access_by_bucket)

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
        access_by_bucket = self._db_storage_space_content_access(user, account, account_role)
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
                for user_id, (_user, account_role, _sources) in self._portal_account_member_map(account).items()
                if account_role == AccountRole.PORTAL_MANAGER.value
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
        if not participant_user_ids:
            return
        rows = (
            self.db.query(User, AccountIAMUser.iam_username)
            .outerjoin(
                AccountIAMUser,
                (AccountIAMUser.user_id == User.id) & (AccountIAMUser.account_id == account.id),
            )
            .filter(User.id.in_(participant_user_ids))
            .all()
        )
        member_roles = {user_id: row[1] for user_id, row in self._portal_account_member_map(account).items()}
        legacy_rows = [(target, member_roles.get(target.id), iam_username) for target, iam_username in rows if iam_username]
        if legacy_rows:
            iam_service = self._get_iam_service(account)
            for target, account_role, iam_username in legacy_rows:
                if account_role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
                    continue
                self._sync_user_group_membership(
                    iam_service,
                    iam_username,
                    account_role,
                    portal_settings=self._effective_portal_settings(account),
                )
                self._sync_user_storage_space_projection(target, account, account_role, iam_service, iam_username)
        zonegroup_key = self._project_zonegroup_key(account)
        if not zonegroup_key:
            return
        project_links = (
            self.db.query(ProjectIAMUser)
            .join(ProjectS3Account, ProjectS3Account.project_id == ProjectIAMUser.project_id)
            .filter(ProjectS3Account.account_id == account.id)
            .filter(ProjectIAMUser.zonegroup_key == zonegroup_key)
            .filter(ProjectIAMUser.user_id.in_(participant_user_ids))
            .all()
        )
        for project_link in project_links:
            self._sync_project_iam_link_projection(project_link)

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

    def _endpoint_provider_name(self, endpoint: Optional[StorageEndpoint]) -> str:
        provider = getattr(endpoint, "provider", None)
        return str(getattr(provider, "value", provider) or "").strip().lower()

    def _portal_iam_endpoint(self, account: S3Account) -> Optional[StorageEndpoint]:
        endpoint = getattr(account, "storage_endpoint", None)
        if endpoint is None:
            return None
        if self._endpoint_provider_name(endpoint) != "ceph":
            return endpoint
        zonegroup = str(getattr(endpoint, "ceph_zonegroup_name", None) or "").strip()
        if not zonegroup:
            return endpoint
        try:
            candidates = (
                self.db.query(StorageEndpoint)
                .filter(StorageEndpoint.ceph_zonegroup_name == zonegroup)
                .order_by(StorageEndpoint.id.asc())
                .all()
            )
        except Exception as exc:  # pragma: no cover - defensive DB fallback
            logger.warning("Unable to resolve Portal IAM endpoint for zonegroup %s: %s", zonegroup, exc)
            return endpoint
        for candidate in candidates:
            if self._endpoint_provider_name(candidate) != "ceph":
                continue
            if not getattr(candidate, "endpoint_url", None):
                continue
            flags = resolve_feature_flags(candidate)
            if not flags.iam_enabled or not resolve_iam_endpoint(candidate):
                continue
            return candidate
        return endpoint

    def _get_iam_service(self, account: S3Account) -> RGWIAMService:
        access_key, secret_key = self._account_credentials(account)
        iam_endpoint = self._portal_iam_endpoint(account)
        if iam_endpoint is not None:
            endpoint = resolve_iam_endpoint(iam_endpoint)
            region = resolve_iam_signing_region(iam_endpoint)
            verify_tls = bool(getattr(iam_endpoint, "verify_tls", True))
        else:
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

        Portal is intended for RGW accounts exposing IAM semantics. We keep this
        check conservative and side-effect free (no user creation).
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

        if reasons:
            return False, reasons

        try:
            iam_service = self._get_iam_service(account)
            # Probe a minimal IAM call without enumerating all resources.
            iam_service.client.list_users(MaxItems=1)
        except Exception:
            reasons.append("IAM API is not reachable or not authorized")

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

        settings = portal_settings or self._portal_settings()
        self._ensure_portal_groups(iam_service, settings)
        target_group = self._manager_group_name if account_role == AccountRole.PORTAL_MANAGER.value else self._user_group_name
        other_group = self._user_group_name if target_group == self._manager_group_name else self._manager_group_name

        members = iam_service.list_group_users(target_group)
        if not any(m.name == iam_username for m in members):
            iam_service.add_user_to_group(target_group, iam_username)

        other_members = iam_service.list_group_users(other_group)
        if any(m.name == iam_username for m in other_members):
            iam_service.remove_user_from_group(other_group, iam_username)

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
        self._sync_user_group_membership(iam_service, link.iam_username, account_role, portal_settings=portal_settings)
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

    def _ensure_user_bucket_policy(
        self,
        iam_service: RGWIAMService,
        iam_username: Optional[str],
        bucket_name: str,
        portal_settings: Optional[PortalSettings] = None,
    ) -> None:
        if not iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        settings = portal_settings or self._portal_settings()
        policy_settings = settings.bucket_access_policy
        advanced_policy = policy_settings.advanced_policy if isinstance(policy_settings.advanced_policy, dict) else None
        use_advanced = advanced_policy is not None
        existing_policy = iam_service.get_user_inline_policy(iam_username, self._bucket_access_policy_name) or {}
        existing_resources: list[str] = []
        if isinstance(existing_policy, dict):
            existing_statements = existing_policy.get("Statement") or []
            if not isinstance(existing_statements, list):
                existing_statements = [existing_statements]
            for stmt in existing_statements:
                if not isinstance(stmt, dict) or stmt.get("Sid") != self._bucket_access_sid:
                    continue
                resources = stmt.get("Resource") or []
                if not isinstance(resources, list):
                    resources = [resources]
                existing_resources = [arn for arn in resources if isinstance(arn, str)]
                break
        if use_advanced and advanced_policy is not None:
            policy = copy.deepcopy(advanced_policy)
        else:
            policy = existing_policy
        statements = policy.get("Statement") or []
        if not isinstance(statements, list):
            statements = [statements]
        bucket_statement = None
        for stmt in statements:
            if not isinstance(stmt, dict):
                continue
            if stmt.get("Sid") == self._bucket_access_sid:
                bucket_statement = stmt
                break
        if bucket_statement is None:
            bucket_statement = {
                "Sid": self._bucket_access_sid,
                "Effect": "Allow",
                "Resource": [],
            }
            statements.append(bucket_statement)
        actions = self._bucket_access_actions(settings)
        if "Effect" not in bucket_statement:
            bucket_statement["Effect"] = "Allow"
        if not use_advanced or "Action" not in bucket_statement:
            bucket_statement["Action"] = actions

        resources = bucket_statement.get("Resource") or []
        if not isinstance(resources, list):
            resources = [resources]
        for arn in existing_resources:
            if arn not in resources:
                resources.append(arn)

        for arn in (f"arn:aws:s3:::{bucket_name}", f"arn:aws:s3:::{bucket_name}/*"):
            if arn not in resources:
                resources.append(arn)

        bucket_statement["Resource"] = resources
        policy = {
            "Version": policy.get("Version") or "2012-10-17",
            "Statement": statements,
        }
        iam_service.put_user_inline_policy(iam_username, self._bucket_access_policy_name, policy)

    def _set_user_storage_space_policy(
        self,
        iam_service: RGWIAMService,
        iam_username: Optional[str],
        bucket_name: str,
        role: PortalStorageSpaceRole,
    ) -> None:
        if not iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        policy = iam_service.get_user_inline_policy(iam_username, self._bucket_access_policy_name) or {}
        statements = policy.get("Statement") or []
        if not isinstance(statements, list):
            statements = [statements]
        managed_sids = {self._bucket_access_sid, *self._storage_space_share_sids()}
        remove_arns = set(self._bucket_arns(bucket_name))
        next_statements: list[dict] = []
        target_statement = None
        target_sid = self._storage_space_share_sid(role)

        for stmt in statements:
            if not isinstance(stmt, dict):
                continue
            sid = stmt.get("Sid")
            if sid in managed_sids:
                resources = stmt.get("Resource") or []
                if not isinstance(resources, list):
                    resources = [resources]
                resources = [arn for arn in resources if arn not in remove_arns]
                if resources:
                    stmt = copy.deepcopy(stmt)
                    stmt["Resource"] = resources
                    next_statements.append(stmt)
            else:
                next_statements.append(stmt)

        for stmt in next_statements:
            if stmt.get("Sid") == target_sid:
                target_statement = stmt
                break
        if target_statement is None:
            target_statement = {
                "Sid": target_sid,
                "Effect": "Allow",
                "Action": self._storage_space_role_actions(role),
                "Resource": [],
            }
            next_statements.append(target_statement)
        target_statement["Effect"] = "Allow"
        target_statement["Action"] = self._storage_space_role_actions(role)
        resources = target_statement.get("Resource") or []
        if not isinstance(resources, list):
            resources = [resources]
        for arn in self._bucket_arns(bucket_name):
            if arn not in resources:
                resources.append(arn)
        target_statement["Resource"] = resources

        iam_service.put_user_inline_policy(
            iam_username,
            self._bucket_access_policy_name,
            {
                "Version": policy.get("Version") or "2012-10-17",
                "Statement": next_statements,
            },
        )

    def _remove_user_storage_space_policy(
        self,
        iam_service: RGWIAMService,
        iam_username: Optional[str],
        bucket_name: str,
    ) -> None:
        if not iam_username:
            return
        policy = iam_service.get_user_inline_policy(iam_username, self._bucket_access_policy_name) or {}
        statements = policy.get("Statement") or []
        if not isinstance(statements, list):
            statements = [statements]
        managed_sids = {self._bucket_access_sid, *self._storage_space_share_sids()}
        remove_arns = set(self._bucket_arns(bucket_name))
        next_statements: list[dict] = []
        for stmt in statements:
            if not isinstance(stmt, dict):
                continue
            if stmt.get("Sid") not in managed_sids:
                next_statements.append(stmt)
                continue
            resources = stmt.get("Resource") or []
            if not isinstance(resources, list):
                resources = [resources]
            remaining = [arn for arn in resources if arn not in remove_arns]
            if remaining:
                stmt = copy.deepcopy(stmt)
                stmt["Resource"] = remaining
                next_statements.append(stmt)
        if next_statements:
            iam_service.put_user_inline_policy(
                iam_username,
                self._bucket_access_policy_name,
                {
                    "Version": policy.get("Version") or "2012-10-17",
                    "Statement": next_statements,
                },
            )
        else:
            iam_service.delete_user_inline_policy(iam_username, self._bucket_access_policy_name)

    def _portal_user_rows(self, account: S3Account) -> list[tuple[User, Optional[str], Optional[str]]]:
        member_rows = self._portal_account_member_map(account)
        if not member_rows:
            return []
        iam_by_user_id = {
            user_id: iam_username
            for user_id, iam_username in (
                self.db.query(AccountIAMUser.user_id, AccountIAMUser.iam_username)
                .filter(AccountIAMUser.account_id == account.id)
                .filter(AccountIAMUser.user_id.in_(member_rows))
                .all()
            )
        }
        return [
            (user, account_role, iam_by_user_id.get(user_id))
            for user_id, (user, account_role, _sources) in sorted(member_rows.items(), key=lambda item: item[1][0].email.lower())
        ]

    def check_iam_compliance(self, account: S3Account) -> PortalIamComplianceReport:
        iam_service = self._get_iam_service(account)
        portal_settings = self._effective_portal_settings(account)
        issues: list[PortalIamComplianceIssue] = []

        groups = {group.name for group in iam_service.list_groups()}
        for group_key, group_name, policy_name in (
            ("manager", self._manager_group_name, self._manager_group_policy_name),
            ("user", self._user_group_name, self._inline_policy_name),
        ):
            if group_name not in groups:
                issues.append(
                    PortalIamComplianceIssue(
                        scope="group",
                        subject=group_name,
                        message="Groupe IAM introuvable.",
                    )
                )
                continue
            attached = iam_service.list_group_policies(group_name)
            if attached:
                issues.append(
                    PortalIamComplianceIssue(
                        scope="group",
                        subject=group_name,
                        message=f"Policies attachees detectees ({len(attached)}).",
                    )
                )
            expected_policy = self._resolve_group_policy(portal_settings, group_key)
            actual_policy = iam_service.get_group_inline_policy(group_name, policy_name)
            expected_normalized = self._normalize_policy_document(expected_policy)
            actual_normalized = self._normalize_policy_document(actual_policy)
            if expected_policy is None:
                if actual_policy:
                    issues.append(
                        PortalIamComplianceIssue(
                            scope="group",
                            subject=group_name,
                            message="Policy inline presente mais aucune n'est attendue.",
                        )
                    )
            else:
                if actual_policy is None:
                    issues.append(
                        PortalIamComplianceIssue(
                            scope="group",
                            subject=group_name,
                            message="Policy inline manquante.",
                        )
                    )
                elif expected_normalized != actual_normalized:
                    issues.append(
                        PortalIamComplianceIssue(
                            scope="group",
                            subject=group_name,
                            message="Policy inline divergente des settings du portail.",
                        )
                    )

        portal_users = self._portal_user_rows(account)
        for user_obj, account_role, iam_username in portal_users:
            expected_group = (
                self._manager_group_name
                if account_role == AccountRole.PORTAL_MANAGER.value
                else self._user_group_name
            )
            subject = user_obj.email
            if not iam_username:
                issues.append(
                    PortalIamComplianceIssue(
                        scope="user",
                        subject=subject,
                        message="IAM user manquant pour ce compte.",
                    )
                )
                continue
            subject = f"{user_obj.email} ({iam_username})"
            groups_for_user = iam_service.list_groups_for_user(iam_username)
            portal_groups = [
                g.name
                for g in groups_for_user
                if g.name in {self._manager_group_name, self._user_group_name}
            ]
            if expected_group not in portal_groups:
                current = ", ".join(portal_groups) if portal_groups else "aucun"
                issues.append(
                    PortalIamComplianceIssue(
                        scope="user",
                        subject=subject,
                        message=f"Groupe attendu '{expected_group}' absent (actuels: {current}).",
                    )
                )
            if len(portal_groups) > 1:
                issues.append(
                    PortalIamComplianceIssue(
                        scope="user",
                        subject=subject,
                        message="Appartient aux deux groupes portail (manager/user).",
                    )
                )
            policy = iam_service.get_user_inline_policy(iam_username, self._bucket_access_policy_name)
            expected_access = self._db_storage_space_content_access(
                user_obj,
                account,
                account_role or AccountRole.PORTAL_NONE.value,
            )
            actual_access = self._extract_storage_space_access(policy)
            if expected_access and not policy:
                issues.append(
                    PortalIamComplianceIssue(
                        scope="user",
                        subject=subject,
                        message="Policy portal-user-buckets manquante pour les grants DB attendus.",
                    )
                )
            mismatched = sorted(
                bucket_name
                for bucket_name, expected_role in expected_access.items()
                if actual_access.get(bucket_name) != expected_role
            )
            if mismatched:
                issues.append(
                    PortalIamComplianceIssue(
                        scope="user",
                        subject=subject,
                        message=f"Projection IAM divergente des grants DB: {', '.join(mismatched)}.",
                    )
                )
            action_drift = self._storage_space_policy_action_drift(policy, expected_access)
            if action_drift:
                issues.append(
                    PortalIamComplianceIssue(
                        scope="user",
                        subject=subject,
                        message=f"Actions IAM divergentes du role Storage Space attendu: {', '.join(action_drift)}.",
                    )
                )
            stale = sorted(bucket_name for bucket_name in actual_access if bucket_name not in expected_access)
            if stale:
                issues.append(
                    PortalIamComplianceIssue(
                        scope="user",
                        subject=subject,
                        message=f"Grants IAM obsoletes absents de la DB: {', '.join(stale)}.",
                    )
                )

        return PortalIamComplianceReport(ok=len(issues) == 0, issues=issues)

    def apply_iam_compliance(self, account: S3Account) -> PortalIamComplianceReport:
        iam_service = self._get_iam_service(account)
        portal_settings = self._effective_portal_settings(account)
        self._ensure_portal_groups(iam_service, portal_settings)
        portal_users = self._portal_user_rows(account)
        for target_user, account_role, iam_username in portal_users:
            if not iam_username:
                continue
            role = account_role or AccountRole.PORTAL_USER.value
            self._sync_user_group_membership(iam_service, iam_username, role, portal_settings=portal_settings)
            access_by_bucket = self._db_storage_space_content_access(target_user, account, role)
            self._sync_user_storage_space_policy_projection(iam_service, iam_username, access_by_bucket)
        self._sync_account_storage_space_bucket_policies(account)
        return self.check_iam_compliance(account)

    def list_user_bucket_access(self, target: User, account: S3Account, account_role: str) -> list[str]:
        if account_role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            raise RuntimeError("Le role du compte ne permet pas la gestion des droits bucket.")
        iam_service = self._get_iam_service(account)
        link, _, _ = self._ensure_portal_user(target, account, iam_service)
        portal_settings = self._effective_portal_settings(account)
        self._sync_user_group_membership(iam_service, link.iam_username, account_role, portal_settings=portal_settings)
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
