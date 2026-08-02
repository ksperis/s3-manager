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
    ) -> PortalSettingsOverride:
        raw = account.portal_settings_override
        if not raw:
            return PortalSettingsOverride()
        try:
            payload = json.loads(raw)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Unable to parse portal settings overrides for account %s: %s", account.id, exc)
            return PortalSettingsOverride()
        if not isinstance(payload, dict):
            return PortalSettingsOverride()
        admin_payload = payload.get("admin")
        if not isinstance(admin_payload, dict):
            admin_payload = {}
        try:
            return PortalSettingsOverride.model_validate(admin_payload)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Invalid admin portal settings override for account %s: %s", account.id, exc)
            return PortalSettingsOverride()

    def _override_payload(self, override: PortalSettingsOverride) -> dict:
        return override.model_dump(exclude_unset=True, exclude_none=False)

    def _persist_portal_settings_overrides(
        self,
        account: S3Account,
        admin_override: PortalSettingsOverride,
        *,
        delegated_to_portal_managers: Optional[bool] = None,
    ) -> None:
        payload: dict[str, Any] = {}
        admin_payload = self._override_payload(admin_override)
        if admin_payload:
            payload["admin"] = admin_payload
        account.portal_settings_override = json.dumps(payload) if payload else None
        if delegated_to_portal_managers is not None:
            account.portal_settings_delegated = bool(delegated_to_portal_managers)
        self.db.add(account)
        self.db.commit()
        self.db.refresh(account)

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
        if override.noncurrent_version_expiration_days is not None:
            target.noncurrent_version_expiration_days = override.noncurrent_version_expiration_days
        if override.cors_allowed_origins is not None:
            target.cors_allowed_origins = override.cors_allowed_origins

    def _apply_admin_overrides(
        self,
        portal_settings: PortalSettings,
        override: PortalSettingsOverride,
    ) -> None:
        if override.allow_portal_key is not None:
            portal_settings.allow_portal_key = override.allow_portal_key
        if override.browser_access_enabled is not None:
            portal_settings.browser_access_enabled = override.browser_access_enabled
        if override.allow_private_storage_space_create is not None:
            portal_settings.allow_private_storage_space_create = override.allow_private_storage_space_create
        if override.allow_portal_named_bucket_create is not None:
            portal_settings.allow_portal_named_bucket_create = override.allow_portal_named_bucket_create
        if override.allow_portal_user_access_key_create is not None:
            portal_settings.allow_portal_user_access_key_create = override.allow_portal_user_access_key_create
        if override.server_access_logging_enabled is not None:
            portal_settings.server_access_logging_enabled = override.server_access_logging_enabled
        if override.storage_space_version_cleanup_enabled is not None:
            portal_settings.storage_space_version_cleanup_enabled = override.storage_space_version_cleanup_enabled
        if override.bucket_defaults:
            self._apply_bucket_defaults_override(
                portal_settings.bucket_defaults,
                override.bucket_defaults,
            )

    def _effective_portal_settings(self, account: S3Account, base_settings: Optional[PortalSettings] = None) -> PortalSettings:
        base = base_settings or self._portal_settings()
        admin_override = self._load_portal_settings_overrides(account)
        effective = base.model_copy(deep=True)
        self._apply_admin_overrides(effective, admin_override)
        return effective

    def get_effective_portal_settings(
        self,
        account: S3Account,
        *,
        base_settings: Optional[PortalSettings] = None,
    ) -> PortalSettings:
        return self._effective_portal_settings(account, base_settings=base_settings)

    def get_portal_account_settings(self, account: S3Account) -> PortalAccountSettings:
        base = self._portal_settings()
        admin_override = self._load_portal_settings_overrides(account)
        effective = base.model_copy(deep=True)
        self._apply_admin_overrides(effective, admin_override)
        return PortalAccountSettings(
            effective=effective,
            admin_override=admin_override,
            delegated_to_portal_managers=bool(account.portal_settings_delegated),
        )

    def get_portal_project_settings(
        self,
        account: S3Account,
        *,
        can_update: bool,
    ) -> PortalProjectSettings:
        account_settings = self.get_portal_account_settings(account)
        return PortalProjectSettings(
            effective=account_settings.effective,
            project_override=account_settings.admin_override,
            delegated_to_portal_managers=account_settings.delegated_to_portal_managers,
            can_update=can_update,
        )

    def update_admin_portal_settings_override(
        self,
        account: S3Account,
        override: PortalSettingsOverride,
        *,
        delegated_to_portal_managers: Optional[bool] = None,
    ) -> PortalAccountSettings:
        payload = override.model_dump(exclude_unset=True, exclude_none=False)
        admin_override = PortalSettingsOverride.model_validate(payload)
        effective = self._portal_settings().model_copy(deep=True)
        self._apply_admin_overrides(effective, admin_override)
        self.reconcile_portal_server_access_logging(account, portal_settings=effective)
        self._persist_portal_settings_overrides(
            account,
            admin_override,
            delegated_to_portal_managers=delegated_to_portal_managers,
        )
        return self.get_portal_account_settings(account)
