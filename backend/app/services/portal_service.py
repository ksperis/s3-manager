# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import copy
import json
import logging
from datetime import datetime
from typing import Any, Optional, Tuple, TYPE_CHECKING

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import AccountIAMUser, AccountRole, S3Account, StorageEndpoint, User, UserRole, UserS3Account
from app.models.app_settings import (
    PortalBucketDefaults,
    PortalBucketDefaultsOverride,
    PortalBucketDefaultsOverridePolicy,
    PortalIAMPolicyOverride,
    PortalIAMPolicySettings,
    PortalSettings,
    PortalSettingsOverride,
    PortalSettingsOverridePolicy,
)
from app.models.bucket import Bucket
from app.models.iam import AccessKey as ModelAccessKey, IAMUser
from app.models.portal import (
    PortalAccessKey,
    PortalAccountSettings,
    PortalIAMUser,
    PortalIamComplianceIssue,
    PortalIamComplianceReport,
    PortalState,
    PortalUsage,
)
from app.services.app_settings_service import load_app_settings
from app.services import s3_client
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.services.rgw_iam import RGWIAMService, get_iam_service
from app.utils.rgw import extract_bucket_list, get_supervision_rgw_client, resolve_admin_uid
from app.utils.storage_endpoint_features import resolve_feature_flags, resolve_admin_endpoint
from app.utils.s3_endpoint import resolve_s3_client_options, resolve_s3_endpoint
from app.utils.normalize import normalize_string_list
from app.utils.usage_stats import extract_usage_stats

if TYPE_CHECKING:
    from app.routers.dependencies import AccountAccess

logger = logging.getLogger(__name__)
settings = get_settings()


class PortalService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self._inline_policy_name = "portal-self-service"
        self._manager_group_policy_name = "portal-manager"
        self._manager_group_name = "portal-manager"
        self._user_group_name = "portal-user"
        self._bucket_access_policy_name = "portal-user-buckets"
        self._bucket_access_sid = "PortalUserBuckets"
        self._bucket_access_default_actions = PortalSettings().bucket_access_policy.actions

    def _portal_settings(self) -> PortalSettings:
        return load_app_settings().portal

    def _load_portal_settings_overrides(
        self,
        account: S3Account,
    ) -> tuple[PortalSettingsOverride, PortalSettingsOverride]:
        raw = account.portal_settings_override
        if not raw:
            return PortalSettingsOverride(), PortalSettingsOverride()
        try:
            payload = json.loads(raw)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Unable to parse portal settings overrides for account %s: %s", account.id, exc)
            return PortalSettingsOverride(), PortalSettingsOverride()
        if not isinstance(payload, dict):
            return PortalSettingsOverride(), PortalSettingsOverride()
        admin_payload = payload.get("admin")
        portal_payload = payload.get("portal_manager")
        if not isinstance(admin_payload, dict):
            admin_payload = {}
        if not isinstance(portal_payload, dict):
            portal_payload = {}
        try:
            admin_override = PortalSettingsOverride.model_validate(admin_payload)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Invalid admin portal settings override for account %s: %s", account.id, exc)
            admin_override = PortalSettingsOverride()
        try:
            portal_override = PortalSettingsOverride.model_validate(portal_payload)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Invalid portal manager settings override for account %s: %s", account.id, exc)
            portal_override = PortalSettingsOverride()
        return admin_override, portal_override

    def _override_payload(self, override: PortalSettingsOverride) -> dict:
        return override.model_dump(exclude_unset=True, exclude_none=False)

    def _persist_portal_settings_overrides(
        self,
        account: S3Account,
        admin_override: PortalSettingsOverride,
        portal_override: PortalSettingsOverride,
    ) -> None:
        payload: dict[str, Any] = {}
        admin_payload = self._override_payload(admin_override)
        if admin_payload:
            payload["admin"] = admin_payload
        portal_payload = self._override_payload(portal_override)
        if portal_payload:
            payload["portal_manager"] = portal_payload
        account.portal_settings_override = json.dumps(payload) if payload else None
        self.db.add(account)
        self.db.commit()
        self.db.refresh(account)

    def _policy_override_flags(self, override: Optional[PortalIAMPolicyOverride]) -> tuple[bool, bool]:
        if not override:
            return False, False
        fields_set = override.model_fields_set
        return "actions" in fields_set, "advanced_policy" in fields_set

    def _apply_policy_override(
        self,
        target: PortalIAMPolicySettings,
        override: Optional[PortalIAMPolicyOverride],
        allow_actions: bool,
        allow_advanced: bool,
        lock_actions: bool,
        lock_advanced: bool,
    ) -> None:
        if not override:
            return
        actions_set, advanced_set = self._policy_override_flags(override)
        if actions_set and allow_actions and not lock_actions:
            target.actions = override.actions or []
            if not advanced_set:
                target.advanced_policy = None
        if advanced_set and allow_advanced and not lock_advanced:
            target.advanced_policy = override.advanced_policy

    def _apply_bucket_defaults_override(
        self,
        target: PortalBucketDefaults,
        override: Optional[PortalBucketDefaultsOverride],
        policy: PortalBucketDefaultsOverridePolicy,
        lock: Optional[PortalBucketDefaultsOverride] = None,
    ) -> None:
        if not override:
            return
        if override.versioning is not None and policy.versioning and not (lock and lock.versioning is not None):
            target.versioning = override.versioning
        if override.enable_cors is not None and policy.enable_cors and not (lock and lock.enable_cors is not None):
            target.enable_cors = override.enable_cors
        if override.enable_lifecycle is not None and policy.enable_lifecycle and not (lock and lock.enable_lifecycle is not None):
            target.enable_lifecycle = override.enable_lifecycle
        if override.cors_allowed_origins is not None and policy.cors_allowed_origins and not (
            lock and lock.cors_allowed_origins is not None
        ):
            target.cors_allowed_origins = override.cors_allowed_origins

    def _apply_admin_overrides(
        self,
        portal_settings: PortalSettings,
        override: PortalSettingsOverride,
    ) -> None:
        if override.allow_portal_key is not None:
            portal_settings.allow_portal_key = override.allow_portal_key
        if override.allow_portal_user_bucket_create is not None:
            portal_settings.allow_portal_user_bucket_create = override.allow_portal_user_bucket_create
        if override.allow_portal_user_access_key_create is not None:
            portal_settings.allow_portal_user_access_key_create = override.allow_portal_user_access_key_create
        self._apply_policy_override(
            portal_settings.iam_group_manager_policy,
            override.iam_group_manager_policy,
            allow_actions=True,
            allow_advanced=True,
            lock_actions=False,
            lock_advanced=False,
        )
        self._apply_policy_override(
            portal_settings.iam_group_user_policy,
            override.iam_group_user_policy,
            allow_actions=True,
            allow_advanced=True,
            lock_actions=False,
            lock_advanced=False,
        )
        self._apply_policy_override(
            portal_settings.bucket_access_policy,
            override.bucket_access_policy,
            allow_actions=True,
            allow_advanced=True,
            lock_actions=False,
            lock_advanced=False,
        )
        if override.bucket_defaults:
            self._apply_bucket_defaults_override(
                portal_settings.bucket_defaults,
                override.bucket_defaults,
                policy=PortalBucketDefaultsOverridePolicy(),
                lock=None,
            )

    def _apply_portal_manager_overrides(
        self,
        portal_settings: PortalSettings,
        override: PortalSettingsOverride,
        policy: PortalSettingsOverridePolicy,
        admin_override: PortalSettingsOverride,
    ) -> None:
        if override.allow_portal_key is not None and policy.allow_portal_key and admin_override.allow_portal_key is None:
            portal_settings.allow_portal_key = override.allow_portal_key
        if (
            override.allow_portal_user_bucket_create is not None
            and policy.allow_portal_user_bucket_create
            and admin_override.allow_portal_user_bucket_create is None
        ):
            portal_settings.allow_portal_user_bucket_create = override.allow_portal_user_bucket_create
        if (
            override.allow_portal_user_access_key_create is not None
            and policy.allow_portal_user_access_key_create
            and admin_override.allow_portal_user_access_key_create is None
        ):
            portal_settings.allow_portal_user_access_key_create = override.allow_portal_user_access_key_create

        admin_manager_actions, admin_manager_advanced = self._policy_override_flags(admin_override.iam_group_manager_policy)
        admin_user_actions, admin_user_advanced = self._policy_override_flags(admin_override.iam_group_user_policy)
        admin_bucket_actions, admin_bucket_advanced = self._policy_override_flags(admin_override.bucket_access_policy)

        self._apply_policy_override(
            portal_settings.iam_group_manager_policy,
            override.iam_group_manager_policy,
            allow_actions=policy.iam_group_manager_policy.actions,
            allow_advanced=policy.iam_group_manager_policy.advanced_policy,
            lock_actions=admin_manager_actions,
            lock_advanced=admin_manager_advanced,
        )
        self._apply_policy_override(
            portal_settings.iam_group_user_policy,
            override.iam_group_user_policy,
            allow_actions=policy.iam_group_user_policy.actions,
            allow_advanced=policy.iam_group_user_policy.advanced_policy,
            lock_actions=admin_user_actions,
            lock_advanced=admin_user_advanced,
        )
        self._apply_policy_override(
            portal_settings.bucket_access_policy,
            override.bucket_access_policy,
            allow_actions=policy.bucket_access_policy.actions,
            allow_advanced=policy.bucket_access_policy.advanced_policy,
            lock_actions=admin_bucket_actions,
            lock_advanced=admin_bucket_advanced,
        )
        self._apply_bucket_defaults_override(
            portal_settings.bucket_defaults,
            override.bucket_defaults,
            policy=policy.bucket_defaults,
            lock=admin_override.bucket_defaults,
        )

    def _effective_portal_settings(self, account: S3Account, base_settings: Optional[PortalSettings] = None) -> PortalSettings:
        base = base_settings or self._portal_settings()
        admin_override, portal_override = self._load_portal_settings_overrides(account)
        effective = base.model_copy(deep=True)
        self._apply_admin_overrides(effective, admin_override)
        self._apply_portal_manager_overrides(effective, portal_override, base.override_policy, admin_override)
        return effective

    def _validate_portal_manager_override(
        self,
        override: PortalSettingsOverride,
        policy: PortalSettingsOverridePolicy,
        admin_override: PortalSettingsOverride,
    ) -> list[str]:
        issues: list[str] = []
        if override.allow_portal_key is not None:
            if not policy.allow_portal_key:
                issues.append("Override non autorise pour la cle portail.")
            if admin_override.allow_portal_key is not None:
                issues.append("Override verrouille par l'admin pour la cle portail.")
        if override.allow_portal_user_bucket_create is not None:
            if not policy.allow_portal_user_bucket_create:
                issues.append("Override non autorise pour la creation de bucket portail.")
            if admin_override.allow_portal_user_bucket_create is not None:
                issues.append("Override verrouille par l'admin pour la creation de bucket portail.")
        if override.allow_portal_user_access_key_create is not None:
            if not policy.allow_portal_user_access_key_create:
                issues.append("Override non autorise pour la creation de cle d'acces portail.")
            if admin_override.allow_portal_user_access_key_create is not None:
                issues.append("Override verrouille par l'admin pour la creation de cle d'acces portail.")

        admin_manager_actions, admin_manager_advanced = self._policy_override_flags(admin_override.iam_group_manager_policy)
        admin_user_actions, admin_user_advanced = self._policy_override_flags(admin_override.iam_group_user_policy)
        admin_bucket_actions, admin_bucket_advanced = self._policy_override_flags(admin_override.bucket_access_policy)

        if override.iam_group_manager_policy:
            actions_set, advanced_set = self._policy_override_flags(override.iam_group_manager_policy)
            if actions_set:
                if not policy.iam_group_manager_policy.actions:
                    issues.append("Override actions non autorise pour la policy portal-manager.")
                if admin_manager_actions:
                    issues.append("Override actions verrouille par l'admin pour la policy portal-manager.")
            if advanced_set:
                if not policy.iam_group_manager_policy.advanced_policy:
                    issues.append("Override policy avancee non autorise pour la policy portal-manager.")
                if admin_manager_advanced:
                    issues.append("Override policy avancee verrouille par l'admin pour la policy portal-manager.")

        if override.iam_group_user_policy:
            actions_set, advanced_set = self._policy_override_flags(override.iam_group_user_policy)
            if actions_set:
                if not policy.iam_group_user_policy.actions:
                    issues.append("Override actions non autorise pour la policy portal-user.")
                if admin_user_actions:
                    issues.append("Override actions verrouille par l'admin pour la policy portal-user.")
            if advanced_set:
                if not policy.iam_group_user_policy.advanced_policy:
                    issues.append("Override policy avancee non autorise pour la policy portal-user.")
                if admin_user_advanced:
                    issues.append("Override policy avancee verrouille par l'admin pour la policy portal-user.")

        if override.bucket_access_policy:
            actions_set, advanced_set = self._policy_override_flags(override.bucket_access_policy)
            if actions_set:
                if not policy.bucket_access_policy.actions:
                    issues.append("Override actions non autorise pour la policy bucket access.")
                if admin_bucket_actions:
                    issues.append("Override actions verrouille par l'admin pour la policy bucket access.")
            if advanced_set:
                if not policy.bucket_access_policy.advanced_policy:
                    issues.append("Override policy avancee non autorise pour la policy bucket access.")
                if admin_bucket_advanced:
                    issues.append("Override policy avancee verrouille par l'admin pour la policy bucket access.")

        if override.bucket_defaults:
            admin_bucket_defaults = admin_override.bucket_defaults
            if override.bucket_defaults.versioning is not None:
                if not policy.bucket_defaults.versioning:
                    issues.append("Override non autorise pour le versioning.")
                if admin_bucket_defaults and admin_bucket_defaults.versioning is not None:
                    issues.append("Override verrouille par l'admin pour le versioning.")
            if override.bucket_defaults.enable_cors is not None:
                if not policy.bucket_defaults.enable_cors:
                    issues.append("Override non autorise pour le CORS.")
                if admin_bucket_defaults and admin_bucket_defaults.enable_cors is not None:
                    issues.append("Override verrouille par l'admin pour le CORS.")
            if override.bucket_defaults.enable_lifecycle is not None:
                if not policy.bucket_defaults.enable_lifecycle:
                    issues.append("Override non autorise pour le lifecycle.")
                if admin_bucket_defaults and admin_bucket_defaults.enable_lifecycle is not None:
                    issues.append("Override verrouille par l'admin pour le lifecycle.")
            if override.bucket_defaults.cors_allowed_origins is not None:
                if not policy.bucket_defaults.cors_allowed_origins:
                    issues.append("Override non autorise pour les origins CORS.")
                if admin_bucket_defaults and admin_bucket_defaults.cors_allowed_origins is not None:
                    issues.append("Override verrouille par l'admin pour les origins CORS.")
        return issues

    def get_effective_portal_settings(self, account: S3Account) -> PortalSettings:
        return self._effective_portal_settings(account)

    def get_portal_account_settings(self, account: S3Account) -> PortalAccountSettings:
        base = self._portal_settings()
        admin_override, portal_override = self._load_portal_settings_overrides(account)
        effective = base.model_copy(deep=True)
        self._apply_admin_overrides(effective, admin_override)
        self._apply_portal_manager_overrides(effective, portal_override, base.override_policy, admin_override)
        return PortalAccountSettings(
            effective=effective,
            admin_override=admin_override,
            portal_manager_override=portal_override,
            override_policy=base.override_policy,
        )

    def update_admin_portal_settings_override(
        self,
        account: S3Account,
        override: PortalSettingsOverride,
    ) -> PortalAccountSettings:
        _, portal_override = self._load_portal_settings_overrides(account)
        payload = override.model_dump(exclude_unset=True, exclude_none=False)
        admin_override = PortalSettingsOverride.model_validate(payload)
        self._persist_portal_settings_overrides(account, admin_override, portal_override)
        return self.get_portal_account_settings(account)

    def update_portal_manager_override(
        self,
        account: S3Account,
        override: PortalSettingsOverride,
    ) -> PortalAccountSettings:
        base = self._portal_settings()
        admin_override, _ = self._load_portal_settings_overrides(account)
        payload = override.model_dump(exclude_unset=True, exclude_none=False)
        portal_override = PortalSettingsOverride.model_validate(payload)
        issues = self._validate_portal_manager_override(portal_override, base.override_policy, admin_override)
        if issues:
            raise RuntimeError("; ".join(issues))
        self._persist_portal_settings_overrides(account, admin_override, portal_override)
        return self.get_portal_account_settings(account)

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

    def _portal_bucket_cors_rules(self, origins: list[str]) -> list[dict]:
        return [
            {
                "AllowedOrigins": origins,
                "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
                "AllowedHeaders": ["Content-Type", "x-amz-*"],
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
        return PortalAccessKey(
            access_key_id=key.access_key_id,
            status=key.status,
            created_at=key.created_at,
            is_active=True,
            is_portal=True,
            deletable=False,
            secret_access_key=key.secret_access_key,
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
            return PortalAccessKey(
                access_key_id=active.access_key_id,
                status=active.status,
                created_at=active.created_at,
                is_active=True,
                secret_access_key=link.active_secret_key,
                is_portal=True,
                deletable=False,
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
                PortalAccessKey(
                    access_key_id=meta.access_key_id,
                    status=meta.status,
                    created_at=meta.created_at,
                    is_active=is_active,
                    secret_access_key=None,
                    is_portal=is_portal,
                    deletable=not is_portal,
                )
            )
        # Ensure the active key is reflected even if IAM did not return metadata
        if include_portal and link.active_access_key and not any(k.access_key_id == link.active_access_key for k in keys):
            keys.insert(
                0,
                PortalAccessKey(
                    access_key_id=link.active_access_key,
                    status="Active",
                    is_active=True,
                    secret_access_key=link.active_secret_key,
                    is_portal=True,
                    deletable=False,
                ),
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

    def _extract_bucket_access(self, policy: Optional[dict]) -> list[str]:
        if not policy or not isinstance(policy, dict):
            return []
        statements = policy.get("Statement") or []
        if not isinstance(statements, list):
            statements = [statements]
        for stmt in statements:
            if isinstance(stmt, dict) and stmt.get("Sid") == self._bucket_access_sid:
                resources = stmt.get("Resource") or []
                if not isinstance(resources, list):
                    resources = [resources]
                buckets: list[str] = []
                for res in resources:
                    if not isinstance(res, str) or not res.startswith("arn:aws:s3:::"):
                        continue
                    name = res.replace("arn:aws:s3:::", "")
                    buckets.append(name.replace("/*", ""))
                return sorted(set(buckets))
        return []

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
        if account_role not in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            return []
        link = (
            self.db.query(AccountIAMUser)
            .filter(
                AccountIAMUser.user_id == target.id,
                AccountIAMUser.account_id == account.id,
            )
            .first()
        )
        if not link or not link.iam_username:
            return []
        iam_service = self._get_iam_service(account)
        policy = iam_service.get_user_inline_policy(link.iam_username, self._bucket_access_policy_name)
        return self._extract_bucket_access(policy)

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

    def get_state(self, user: User, access: "AccountAccess") -> PortalState:
        account = access.account
        portal_settings = self._effective_portal_settings(account)
        used_bytes = None
        used_objects = None
        buckets: list[Bucket] = []
        access_keys: list[PortalAccessKey] = []
        link = self._existing_portal_link(user, account)
        iam_user = None
        iam_provisioned = False
        if link and link.iam_username:
            iam_service = self._get_iam_service(account)
            iam_user = iam_service.get_user(link.iam_username)
            if iam_user:
                keys_with_portal = self._list_access_keys(link, iam_service, include_portal=True)
                access_keys = keys_with_portal
                if not portal_settings.allow_portal_key:
                    access_keys = [key for key in keys_with_portal if not key.is_portal]

                portal_meta = next(
                    (key for key in keys_with_portal if key.is_portal and key.access_key_id == link.active_access_key),
                    None,
                )
                has_active_portal_credentials = bool(
                    link.active_access_key
                    and link.active_secret_key
                    and portal_meta
                    and self._is_active_status(portal_meta.status, default=True)
                )
                iam_provisioned = has_active_portal_credentials

                if has_active_portal_credentials:
                    accessible_names: Optional[set[str]] = None
                    if not access.capabilities.can_manage_buckets:
                        allowed = self.list_existing_user_bucket_access(user, access.account, access.role)
                        accessible_names = set(allowed)
                    try:
                        for b in s3_client.list_buckets(
                            access_key=link.active_access_key,
                            secret_key=link.active_secret_key,
                            **self._s3_client_kwargs(account),
                        ):
                            name = b.get("name")
                            if accessible_names is not None and name not in accessible_names:
                                continue
                            buckets.append(
                                Bucket(
                                    name=name,
                                    creation_date=b.get("creation_date"),
                                    used_bytes=None,
                                    object_count=None,
                                    quota_max_size_bytes=None,
                                    quota_max_objects=None,
                                )
                            )
                    except Exception as exc:  # pragma: no cover - defensive
                        logger.warning("Unable to list buckets with existing portal credentials for %s: %s", user.email, exc)
                        buckets = []
        total_buckets = len(buckets)
        quota_max_size_bytes, quota_max_objects = self._account_quota(account)
        return PortalState(
            account_id=account.id,
            iam_user=PortalIAMUser(
                iam_user_id=link.iam_user_id if link else None,
                iam_username=link.iam_username if link else None,
                arn=iam_user.arn if iam_user else None,
                created_at=link.created_at if link else None,
            ),
            access_keys=access_keys,
            iam_provisioned=iam_provisioned,
            buckets=buckets,
            total_buckets=total_buckets,
            s3_endpoint=resolve_s3_endpoint(account),
            used_bytes=used_bytes,
            used_objects=used_objects,
            quota_max_size_bytes=quota_max_size_bytes,
            quota_max_objects=quota_max_objects,
            just_created=False,
            account_role=access.role,
            can_manage_buckets=access.capabilities.can_manage_buckets,
            can_manage_portal_users=access.capabilities.can_manage_portal_users,
        )

    def get_usage(self, user: User, access: "AccountAccess") -> PortalUsage:
        account = access.account
        if not access.capabilities.can_manage_buckets:
            allowed = set(self.list_existing_user_bucket_access(user, account, access.role))
            if not allowed:
                return PortalUsage(used_bytes=None, used_objects=None)
            try:
                rgw_admin = self._supervision_admin_for_account(account)
                bucket_payloads = self._admin_bucket_list(account, admin=rgw_admin)
            except (RGWAdminError, RuntimeError) as exc:  # pragma: no cover - defensive path
                logger.warning("Unable to list scoped bucket usage for portal user %s: %s", user.email, exc)
                return PortalUsage(used_bytes=None, used_objects=None)

            total_bytes = 0
            total_objects = 0
            has_bytes = False
            has_objects = False
            for item in bucket_payloads:
                if not isinstance(item, dict):
                    continue
                bucket_name = item.get("bucket") or item.get("name")
                if bucket_name not in allowed:
                    continue
                usage = item.get("usage")
                usage_bytes, usage_objects = extract_usage_stats(usage)
                if usage_bytes is not None:
                    total_bytes += usage_bytes
                    has_bytes = True
                if usage_objects is not None:
                    total_objects += usage_objects
                    has_objects = True
            return PortalUsage(
                used_bytes=total_bytes if has_bytes else None,
                used_objects=total_objects if has_objects else None,
            )
        used_bytes, used_objects = self._account_usage_summary(account)
        if used_bytes is None or used_objects is None:
            bucket_bytes, bucket_objects, _ = self._account_usage(account)
            if used_bytes is None:
                used_bytes = bucket_bytes
            if used_objects is None:
                used_objects = bucket_objects
        return PortalUsage(used_bytes=used_bytes, used_objects=used_objects)

    def get_bucket_stats(self, user: User, access: "AccountAccess", bucket_name: str) -> Bucket:
        if not bucket_name:
            raise RuntimeError("Bucket name requis.")
        account = access.account
        if not access.capabilities.can_manage_buckets:
            allowed = self.list_existing_user_bucket_access(user, access.account, access.role)
            if bucket_name not in allowed:
                raise RuntimeError("Accès bucket non autorisé.")
        try:
            rgw_admin = self._supervision_admin_for_account(account)
        except RGWAdminError as exc:  # pragma: no cover - defensive path
            logger.warning("Unable to initialize RGW admin client for bucket stats: %s", exc)
            raise RuntimeError("Impossible d'initialiser le client RGW.") from exc
        try:
            scope_kwargs: dict = {}
            account_uid = resolve_admin_uid(account.rgw_account_id, account.rgw_user_uid)
            if account_uid:
                scope_kwargs["uid"] = account_uid
            stats = rgw_admin.get_bucket_info(bucket_name, allow_not_found=True, **scope_kwargs)
            if stats is None and scope_kwargs:
                stats = rgw_admin.get_bucket_info(bucket_name, allow_not_found=True)
        except RGWAdminError as exc:
            raise RuntimeError(f"Unable to fetch bucket stats: {exc}") from exc
        usage = stats.get("usage") if isinstance(stats, dict) else None
        usage_bytes, usage_objects = extract_usage_stats(usage)
        return Bucket(
            name=bucket_name,
            creation_date=None,
            used_bytes=usage_bytes,
            object_count=usage_objects,
            quota_max_size_bytes=None,
            quota_max_objects=None,
        )

    def list_access_keys(self, user: User, access: "AccountAccess") -> list[PortalAccessKey]:
        link = self._existing_portal_link(user, access.account)
        if not link or not link.iam_username:
            return []
        iam_service = self._get_iam_service(access.account)
        if not iam_service.get_user(link.iam_username):
            return []
        return self._list_access_keys(link, iam_service, include_portal=False)

    def create_access_key(self, user: User, access: "AccountAccess") -> PortalAccessKey:
        iam_service = self._get_iam_service(access.account)
        link, _, _ = self._ensure_portal_user(user, access.account, iam_service)
        portal_settings = self._effective_portal_settings(access.account)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        new_key = iam_service.create_access_key(link.iam_username)
        return PortalAccessKey(
            access_key_id=new_key.access_key_id,
            status=new_key.status,
            created_at=new_key.created_at,
            is_active=self._is_active_status(new_key.status, default=True),
            is_portal=False,
            deletable=True,
            secret_access_key=new_key.secret_access_key,
        )

    def get_portal_access_key(self, user: User, access: "AccountAccess") -> PortalAccessKey:
        link = self._existing_portal_link(user, access.account)
        if not link or not link.iam_username:
            raise RuntimeError("Portal IAM identity is not provisioned for this user.")
        iam_service = self._get_iam_service(access.account)
        if not iam_service.get_user(link.iam_username):
            raise RuntimeError("Portal IAM user is missing. Re-run portal bootstrap.")
        if not link.active_access_key or not link.active_secret_key:
            raise RuntimeError("Portal access key is not provisioned for this user.")
        metas = iam_service.list_access_keys(link.iam_username)
        meta = next((item for item in metas if item.access_key_id == link.active_access_key), None)
        if meta is None:
            raise RuntimeError("Portal access key is missing in IAM. Re-run portal bootstrap.")
        return PortalAccessKey(
            access_key_id=meta.access_key_id,
            status=meta.status,
            created_at=meta.created_at,
            is_active=self._is_active_status(meta.status, default=True),
            secret_access_key=link.active_secret_key,
            is_portal=True,
            deletable=False,
        )

    def bootstrap_portal_identity(self, user: User, access: "AccountAccess") -> PortalState:
        account = access.account
        iam_service = self._get_iam_service(account)
        link, _, created = self._ensure_portal_user(user, account, iam_service)
        portal_settings = self._effective_portal_settings(account)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        self._ensure_policy_and_key(link, iam_service)
        state = self.get_state(user, access)
        state.just_created = created
        return state

    def rotate_portal_key(self, user: User, access: "AccountAccess") -> PortalAccessKey:
        iam_service = self._get_iam_service(access.account)
        link, _, _ = self._ensure_portal_user(user, access.account, iam_service)
        portal_settings = self._effective_portal_settings(access.account)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        new_key = iam_service.create_access_key(link.iam_username)
        previous_active = link.active_access_key
        portal_key = self._persist_portal_key(link, new_key)
        if previous_active:
            try:
                iam_service.update_access_key_status(link.iam_username, previous_active, "Inactive")
                logger.info("Previous portal key %s disabled after renewal", previous_active)
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Unable to disable previous portal key %s: %s", previous_active, exc)
        return portal_key

    def update_access_key_status(self, user: User, access: "AccountAccess", access_key_id: str, active: bool) -> PortalAccessKey:
        iam_service = self._get_iam_service(access.account)
        link, _, _ = self._ensure_portal_user(user, access.account, iam_service)
        portal_settings = self._effective_portal_settings(access.account)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        if access_key_id == link.active_access_key and not active:
            raise RuntimeError("Impossible de désactiver la clé portail")
        status_value = "Active" if active else "Inactive"
        iam_service.update_access_key_status(link.iam_username, access_key_id, status_value)
        metas = iam_service.list_access_keys(link.iam_username)
        meta = next((m for m in metas if m.access_key_id == access_key_id), None)
        if meta is None:
            raise RuntimeError("Clé introuvable après mise à jour")
        return PortalAccessKey(
            access_key_id=meta.access_key_id,
            status=meta.status or status_value,
            created_at=meta.created_at,
            is_active=self._is_active_status(meta.status, default=active),
            is_portal=False,
            deletable=True,
        )

    def delete_access_key(self, user: User, access: "AccountAccess", access_key_id: str) -> None:
        iam_service = self._get_iam_service(access.account)
        link, _, _ = self._ensure_portal_user(user, access.account, iam_service)
        portal_settings = self._effective_portal_settings(access.account)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        if access_key_id == link.active_access_key:
            raise RuntimeError("Cannot delete the portal access key")
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        iam_service.delete_access_key(link.iam_username, access_key_id)

    def list_buckets(self, account: S3Account) -> list[Bucket]:
        raise RuntimeError("Listing buckets requires user context")

    def create_bucket(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
        versioning: Optional[bool] = None,
        portal_settings: Optional[PortalSettings] = None,
    ) -> Bucket:
        account = access.account
        portal_defaults = portal_settings or self._effective_portal_settings(account)
        versioning_flag = portal_defaults.bucket_defaults.versioning if versioning is None else versioning
        iam_service = self._get_iam_service(account)
        link, _, _ = self._ensure_portal_user(user, account, iam_service)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_defaults)
        active_key_id, active_secret = self._active_credentials(link, iam_service)
        s3_client.create_bucket(
            bucket_name, access_key=active_key_id, secret_key=active_secret, **self._s3_client_kwargs(account)
        )
        apply_bucket_defaults = bool(access.capabilities.can_manage_buckets)
        if versioning_flag and apply_bucket_defaults:
            s3_client.set_bucket_versioning(
                bucket_name,
                enabled=True,
                access_key=active_key_id,
                secret_key=active_secret,
                **self._s3_client_kwargs(account),
            )
        if portal_defaults.bucket_defaults.enable_lifecycle and apply_bucket_defaults:
            s3_client.put_bucket_lifecycle(
                bucket_name,
                rules=self._portal_bucket_lifecycle_rules(),
                access_key=active_key_id,
                secret_key=active_secret,
                **self._s3_client_kwargs(account),
            )
        if portal_defaults.bucket_defaults.enable_cors and apply_bucket_defaults:
            origins = self._normalize_origins(portal_defaults.bucket_defaults.cors_allowed_origins)
            if origins:
                s3_client.put_bucket_cors(
                    bucket_name,
                    rules=self._portal_bucket_cors_rules(origins),
                    access_key=active_key_id,
                    secret_key=active_secret,
                    **self._s3_client_kwargs(account),
                )
        self._ensure_user_bucket_policy(iam_service, link.iam_username, bucket_name, portal_settings=portal_defaults)
        return Bucket(
            name=bucket_name,
            creation_date=None,
            used_bytes=None,
            object_count=None,
            quota_max_size_bytes=None,
            quota_max_objects=None,
        )

    def delete_bucket(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
        force: bool = False,
        use_root: bool = False,
    ) -> None:
        account = access.account
        portal_settings = self._effective_portal_settings(account)
        iam_service = self._get_iam_service(account)
        link, _, _ = self._ensure_portal_user(user, account, iam_service)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        if use_root:
            access_key, secret_key = self._account_credentials(account)
        else:
            access_key, secret_key = self._active_credentials(link, iam_service)
        s3_client.delete_bucket(
            bucket_name,
            force=force,
            access_key=access_key,
            secret_key=secret_key,
            **self._s3_client_kwargs(account),
        )

    def provision_portal_user(self, target: User, account: S3Account, account_role: str) -> None:
        """Create/sync IAM user and group membership immediately when roles change."""
        if account_role in {AccountRole.PORTAL_MANAGER.value, AccountRole.PORTAL_USER.value}:
            iam_service = self._get_iam_service(account)
            link, _, _ = self._ensure_portal_user(target, account, iam_service)
            portal_settings = self._effective_portal_settings(account)
            self._sync_user_group_membership(iam_service, link.iam_username, account_role, portal_settings=portal_settings)
            self._ensure_active_key(link, iam_service)
            return
        link = (
            self.db.query(AccountIAMUser)
            .filter(
                AccountIAMUser.user_id == target.id,
                AccountIAMUser.account_id == account.id,
            )
            .first()
        )
        if not link:
            return
        iam_service = self._get_iam_service(account)
        if link.iam_username:
            self._delete_portal_iam_user(iam_service, link.iam_username)
        self.db.delete(link)
        self.db.commit()

    def _delete_portal_iam_user(self, iam_service: RGWIAMService, iam_username: str) -> None:
        iam_user = iam_service.get_user(iam_username)
        if iam_user is None:
            iam_service.delete_user(iam_username)
            return
        for key in iam_service.list_access_keys(iam_username):
            iam_service.delete_access_key(iam_username, key.access_key_id)
        for policy in iam_service.list_user_policies(iam_username):
            if policy.arn:
                iam_service.detach_user_policy(iam_username, policy.arn)
        for policy_name in iam_service.list_user_inline_policies(iam_username):
            iam_service.delete_user_inline_policy(iam_username, policy_name)
        for group in iam_service.list_groups_for_user(iam_username):
            iam_service.remove_user_from_group(group.name, iam_username)
        iam_service.delete_user(iam_username)

    def remove_portal_user(self, target: User, account: S3Account) -> None:
        link = (
            self.db.query(AccountIAMUser)
            .filter(
                AccountIAMUser.user_id == target.id,
                AccountIAMUser.account_id == account.id,
            )
            .first()
        )
        if not link:
            return
        iam_service = self._get_iam_service(account)
        if link.iam_username:
            self._delete_portal_iam_user(iam_service, link.iam_username)
        self.db.delete(link)
        self.db.commit()


def get_portal_service(db: Session) -> PortalService:
    return PortalService(db)
