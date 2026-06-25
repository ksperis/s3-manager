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
        else:
            actions = self._normalize_actions(group_policy.actions)
            # Delegate bucket creation through IAM user credentials when enabled.
            if group_key == "user" and portal_settings.allow_portal_user_bucket_create and "s3:CreateBucket" not in actions:
                actions.append("s3:CreateBucket")
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
        editor_actions = [
            *viewer_actions,
            "s3:PutObject",
            "s3:DeleteObject",
        ]
        if role == "Editor":
            return editor_actions
        return ["s3:*"]

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
        return "shared" if metadata is None else "private"

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

    def _storage_space_visible_to_user(
        self,
        user: User,
        access: "AccountAccess",
        metadata: PortalStorageSpaceMetadata | None,
        *,
        include_archived: bool = False,
    ) -> bool:
        if metadata and metadata.archived_at and not include_archived:
            return False
        if self._metadata_visibility(metadata) == "shared":
            return True
        if self._is_portal_manager_access(access):
            return True
        return bool(metadata and metadata.owner_user_id == user.id)

    def _storage_space_effective_role(
        self,
        user: User,
        access: "AccountAccess",
        metadata: PortalStorageSpaceMetadata | None,
        role: Optional[PortalStorageSpaceRole],
        *,
        include_archived: bool = False,
    ) -> Optional[PortalStorageSpaceRole]:
        if not self._storage_space_visible_to_user(user, access, metadata, include_archived=include_archived):
            return None
        if self._is_portal_manager_access(access):
            return "Owner"
        if self._metadata_visibility(metadata) == "private":
            return "Owner"
        return role or self._storage_space_role(access)

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

    def _portal_policy_principals_for_space(
        self,
        account: S3Account,
        owner_user_id: Optional[int],
    ) -> list[str]:
        allowed_user_ids: set[int] = set()
        if owner_user_id is not None:
            allowed_user_ids.add(owner_user_id)
        manager_rows = (
            self.db.query(UserS3Account.user_id)
            .filter(
                UserS3Account.account_id == account.id,
                UserS3Account.account_role == AccountRole.PORTAL_MANAGER.value,
            )
            .all()
        )
        allowed_user_ids.update(user_id for (user_id,) in manager_rows if user_id is not None)
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

    def _without_storage_space_policy_statements(self, policy: Optional[dict]) -> Optional[dict]:
        if not isinstance(policy, dict):
            return None
        statements = policy.get("Statement") or []
        if not isinstance(statements, list):
            statements = [statements]
        managed_sids = {self._storage_space_private_sid, self._storage_space_archived_sid}
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
        elif self._metadata_visibility(metadata) == "private":
            allowed_principals = self._portal_policy_principals_for_space(account, metadata.owner_user_id)
            statement: dict[str, Any] = {
                "Sid": self._storage_space_private_sid,
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
                        "s3:CreateBucket",
                        "s3:ListAllMyBuckets",
                        "s3:GetBucketLocation"
                    ],
                    "Resource": [
                        "arn:aws:s3:::*"
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

    def _extract_bucket_access(self, policy: Optional[dict]) -> list[str]:
        return sorted(self._extract_storage_space_access(policy).keys())

    def _portal_user_rows(self, account: S3Account) -> list[tuple[User, Optional[str], Optional[str]]]:
        roles = [UserRole.UI_USER.value, UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value]
        return (
            self.db.query(User, UserS3Account.account_role, AccountIAMUser.iam_username)
            .join(UserS3Account, UserS3Account.user_id == User.id)
            .outerjoin(
                AccountIAMUser,
                (AccountIAMUser.user_id == User.id) & (AccountIAMUser.account_id == account.id),
            )
            .filter(UserS3Account.account_id == account.id)
            .filter(User.role.in_(roles))
            .filter(UserS3Account.account_role.in_([AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value]))
            .all()
        )

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
            if not policy:
                continue
            statements = self._policy_statements(policy)
            bucket_stmt = self._find_statement(statements, self._bucket_access_sid)
            if not bucket_stmt:
                issues.append(
                    PortalIamComplianceIssue(
                        scope="user",
                        subject=subject,
                        message="Policy portal-user-buckets sans statement PortalUserBuckets.",
                    )
                )
            else:
                expected_actions = self._expected_bucket_action_set(portal_settings)
                actual_actions = self._action_set(bucket_stmt.get("Action"))
                missing = sorted(expected_actions - actual_actions)
                extra = sorted(actual_actions - expected_actions)
                if missing or extra:
                    parts = []
                    if missing:
                        parts.append(f"manquantes: {', '.join(missing)}")
                    if extra:
                        parts.append(f"en trop: {', '.join(extra)}")
                    issues.append(
                        PortalIamComplianceIssue(
                            scope="user",
                            subject=subject,
                            message=f"Actions bucket divergentes ({'; '.join(parts)}).",
                        )
                    )

        return PortalIamComplianceReport(ok=len(issues) == 0, issues=issues)

    def apply_iam_compliance(self, account: S3Account) -> PortalIamComplianceReport:
        iam_service = self._get_iam_service(account)
        portal_settings = self._effective_portal_settings(account)
        self._ensure_portal_groups(iam_service, portal_settings)
        portal_users = self._portal_user_rows(account)
        for _, account_role, iam_username in portal_users:
            if not iam_username:
                continue
            role = account_role or AccountRole.PORTAL_USER.value
            self._sync_user_group_membership(iam_service, iam_username, role, portal_settings=portal_settings)
            policy = iam_service.get_user_inline_policy(iam_username, self._bucket_access_policy_name)
            if not policy:
                continue
            buckets = self._extract_bucket_access(policy)
            for bucket in buckets:
                self._ensure_user_bucket_policy(
                    iam_service,
                    iam_username,
                    bucket,
                    portal_settings=portal_settings,
                )
        return self.check_iam_compliance(account)

    def list_user_bucket_access(self, target: User, account: S3Account, account_role: str) -> list[str]:
        if account_role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            raise RuntimeError("Le role du compte ne permet pas la gestion des droits bucket.")
        iam_service = self._get_iam_service(account)
        link, _, _ = self._ensure_portal_user(target, account, iam_service)
        portal_settings = self._effective_portal_settings(account)
        self._sync_user_group_membership(iam_service, link.iam_username, account_role, portal_settings=portal_settings)
        policy = iam_service.get_user_inline_policy(link.iam_username, self._bucket_access_policy_name)
        return self._extract_bucket_access(policy)

    def list_existing_user_bucket_access(self, target: User, account: S3Account, account_role: str) -> list[str]:
        """Read bucket permissions without provisioning IAM user/key side effects."""
        return sorted(self.list_existing_user_storage_space_access(target, account, account_role).keys())

    def list_existing_user_storage_space_access(
        self,
        target: User,
        account: S3Account,
        account_role: str,
    ) -> dict[str, PortalStorageSpaceRole]:
        """Read Storage Space permissions from IAM policy without side effects."""
        if account_role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            return {}
        link = (
            self.db.query(AccountIAMUser)
            .filter(
                AccountIAMUser.user_id == target.id,
                AccountIAMUser.account_id == account.id,
            )
            .first()
        )
        if not link or not link.iam_username:
            return {}
        iam_service = self._get_iam_service(account)
        policy = iam_service.get_user_inline_policy(link.iam_username, self._bucket_access_policy_name)
        return self._extract_storage_space_access(policy)

    def grant_bucket_access(self, target: User, account: S3Account, account_role: str, bucket_name: str) -> list[str]:
        if not bucket_name:
            raise RuntimeError("Bucket name requis.")
        if account_role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            raise RuntimeError("Le role du compte ne permet pas la gestion des droits bucket.")
        iam_service = self._get_iam_service(account)
        link, _, _ = self._ensure_portal_user(target, account, iam_service)
        portal_settings = self._effective_portal_settings(account)
        self._sync_user_group_membership(iam_service, link.iam_username, account_role, portal_settings=portal_settings)
        access_key, secret_key = self._account_credentials(account)
        buckets = s3_client.list_buckets(
            access_key=access_key, secret_key=secret_key, **self._s3_client_kwargs(account)
        )
        if bucket_name not in [b.get("name") for b in buckets]:
            raise RuntimeError("Bucket introuvable pour ce compte.")
        self._ensure_user_bucket_policy(iam_service, link.iam_username, bucket_name, portal_settings=portal_settings)
        policy = iam_service.get_user_inline_policy(link.iam_username, self._bucket_access_policy_name)
        return self._extract_bucket_access(policy)

    def revoke_bucket_access(self, target: User, account: S3Account, account_role: str, bucket_name: str) -> list[str]:
        if not bucket_name:
            raise RuntimeError("Bucket name requis.")
        if account_role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            raise RuntimeError("Le role du compte ne permet pas la gestion des droits bucket.")
        iam_service = self._get_iam_service(account)
        link, _, _ = self._ensure_portal_user(target, account, iam_service)
        portal_settings = self._effective_portal_settings(account)
        self._sync_user_group_membership(iam_service, link.iam_username, account_role, portal_settings=portal_settings)
        bucket_actions = self._bucket_access_actions(portal_settings)
        use_advanced = isinstance(portal_settings.bucket_access_policy.advanced_policy, dict)
        policy = iam_service.get_user_inline_policy(link.iam_username, self._bucket_access_policy_name) or {}
        statements = policy.get("Statement") or []
        if not isinstance(statements, list):
            statements = [statements]
        bucket_statement = None
        for stmt in statements:
            if isinstance(stmt, dict) and stmt.get("Sid") == self._bucket_access_sid:
                bucket_statement = stmt
                break
        if not bucket_statement:
            return []
        resources = bucket_statement.get("Resource") or []
        if not isinstance(resources, list):
            resources = [resources]
        remove_arns = {f"arn:aws:s3:::{bucket_name}", f"arn:aws:s3:::{bucket_name}/*"}
        remaining_resources = [arn for arn in resources if arn not in remove_arns]
        if remaining_resources:
            bucket_statement["Resource"] = remaining_resources
            if not use_advanced or "Action" not in bucket_statement:
                bucket_statement["Action"] = bucket_actions
            policy = {
                "Version": policy.get("Version") or "2012-10-17",
                "Statement": statements,
            }
            iam_service.put_user_inline_policy(link.iam_username, self._bucket_access_policy_name, policy)
            return self._extract_bucket_access(policy)
        remaining_statements = [stmt for stmt in statements if stmt is not bucket_statement]
        if remaining_statements:
            policy = {
                "Version": policy.get("Version") or "2012-10-17",
                "Statement": remaining_statements,
            }
            iam_service.put_user_inline_policy(link.iam_username, self._bucket_access_policy_name, policy)
            return self._extract_bucket_access(policy)
        iam_service.delete_user_inline_policy(link.iam_username, self._bucket_access_policy_name)
        return []
