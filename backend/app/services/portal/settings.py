# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from typing import Optional

from app.db import S3Account
from app.models.app_settings import (
    PortalBucketDefaults,
    PortalBucketDefaultsOverride,
    PortalSettings,
    PortalSettingsOverride,
)
from app.models.portal_settings import PortalAccountSettings, PortalProjectSettings
from app.services.app_settings_service import load_app_settings


class PortalSettingsMixin:
    def _portal_settings(self) -> PortalSettings:
        return load_app_settings().portal

    def _load_portal_settings_override(
        self,
        account: S3Account,
    ) -> PortalSettingsOverride:
        raw = account.portal_settings_override
        if raw is None:
            return PortalSettingsOverride()
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("Persisted Portal settings override must be a JSON object")
        return PortalSettingsOverride.model_validate(payload, strict=True)

    def _override_payload(self, override: PortalSettingsOverride) -> dict:
        return override.model_dump(exclude_unset=True, exclude_none=True)

    def _persist_portal_settings_override(
        self,
        account: S3Account,
        override: PortalSettingsOverride,
        *,
        delegated_to_portal_managers: Optional[bool] = None,
    ) -> None:
        payload = self._override_payload(override)
        account.portal_settings_override = (
            json.dumps(payload, separators=(",", ":"), sort_keys=True)
            if payload
            else None
        )
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

    def _apply_override(
        self,
        portal_settings: PortalSettings,
        override: PortalSettingsOverride,
    ) -> None:
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
        override = self._load_portal_settings_override(account)
        effective = base.model_copy(deep=True)
        self._apply_override(effective, override)
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
        admin_override = self._load_portal_settings_override(account)
        effective = base.model_copy(deep=True)
        self._apply_override(effective, admin_override)
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
        effective = self._portal_settings().model_copy(deep=True)
        self._apply_override(effective, override)
        self.reconcile_portal_server_access_logging(account, portal_settings=effective)
        self._persist_portal_settings_override(
            account,
            override,
            delegated_to_portal_managers=delegated_to_portal_managers,
        )
        return self.get_portal_account_settings(account)
