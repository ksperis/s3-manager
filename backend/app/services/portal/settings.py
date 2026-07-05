# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


class PortalSettingsMixin:
    def _portal_settings(self) -> PortalSettings:
        return load_app_settings().portal

    def _load_project_portal_settings_overrides(
        self,
        project: Project,
    ) -> PortalSettingsOverride:
        raw = project.portal_settings_override
        if not raw:
            return PortalSettingsOverride()
        try:
            payload = json.loads(raw)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Unable to parse portal settings overrides for project %s: %s", project.id, exc)
            return PortalSettingsOverride()
        if not isinstance(payload, dict):
            return PortalSettingsOverride()
        admin_payload = payload.get("admin")
        if not isinstance(admin_payload, dict):
            admin_payload = {}
        try:
            return PortalSettingsOverride.model_validate(admin_payload)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Invalid admin portal settings override for project %s: %s", project.id, exc)
            return PortalSettingsOverride()

    def _override_payload(self, override: PortalSettingsOverride) -> dict:
        return override.model_dump(exclude_unset=True, exclude_none=False)

    def _persist_project_portal_settings_overrides(
        self,
        project: Project,
        admin_override: PortalSettingsOverride,
    ) -> None:
        payload: dict[str, Any] = {}
        admin_payload = self._override_payload(admin_override)
        if admin_payload:
            payload["admin"] = admin_payload
        project.portal_settings_override = json.dumps(payload) if payload else None
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

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
    ) -> None:
        if not override:
            return
        if override.versioning is not None:
            target.versioning = override.versioning
        if override.enable_cors is not None:
            target.enable_cors = override.enable_cors
        if override.enable_lifecycle is not None:
            target.enable_lifecycle = override.enable_lifecycle
        if override.cors_allowed_origins is not None:
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
            )

    def _effective_portal_settings(
        self,
        account: S3Account,
        base_settings: Optional[PortalSettings] = None,
        admin_override: Optional[PortalSettingsOverride] = None,
    ) -> PortalSettings:
        base = base_settings or self._portal_settings()
        effective = base.model_copy(deep=True)
        if admin_override is not None:
            self._apply_admin_overrides(effective, admin_override)
        return effective

    def _effective_portal_settings_for_access(
        self,
        access: "AccountAccess",
        base_settings: Optional[PortalSettings] = None,
    ) -> PortalSettings:
        if access.portal_settings_override is None and base_settings is None:
            return self._effective_portal_settings(access.account)
        return self._effective_portal_settings(
            access.account,
            base_settings=base_settings,
            admin_override=access.portal_settings_override,
        )

    def get_effective_portal_settings(self, account: S3Account) -> PortalSettings:
        return self._effective_portal_settings(account)

    def get_portal_project_settings(self, project: Project) -> PortalProjectSettings:
        base = self._portal_settings()
        admin_override = self._load_project_portal_settings_overrides(project)
        effective = base.model_copy(deep=True)
        self._apply_admin_overrides(effective, admin_override)
        return PortalProjectSettings(
            effective=effective,
            admin_override=admin_override,
        )

    def update_admin_project_portal_settings_override(
        self,
        project: Project,
        override: PortalSettingsOverride,
    ) -> PortalProjectSettings:
        payload = override.model_dump(exclude_unset=True, exclude_none=False)
        admin_override = PortalSettingsOverride.model_validate(payload)
        self._persist_project_portal_settings_overrides(project, admin_override)
        return self.get_portal_project_settings(project)
