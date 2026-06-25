# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


class PortalSettingsMixin:
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
        if override.allow_portal_named_bucket_create is not None:
            portal_settings.allow_portal_named_bucket_create = override.allow_portal_named_bucket_create
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
            override.allow_portal_named_bucket_create is not None
            and policy.allow_portal_named_bucket_create
            and admin_override.allow_portal_named_bucket_create is None
        ):
            portal_settings.allow_portal_named_bucket_create = override.allow_portal_named_bucket_create
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
        if override.allow_portal_named_bucket_create is not None:
            if not policy.allow_portal_named_bucket_create:
                issues.append("Override non autorise pour la creation de bucket nomme portail.")
            if admin_override.allow_portal_named_bucket_create is not None:
                issues.append("Override verrouille par l'admin pour la creation de bucket nomme portail.")
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
