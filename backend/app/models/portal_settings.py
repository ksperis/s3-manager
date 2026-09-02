# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal account and project settings API contracts."""

from app.models.app_settings import PortalSettings, PortalSettingsOverride
from app.models.base import ApiModel


class PortalAccountSettings(ApiModel):
    effective: PortalSettings
    admin_override: PortalSettingsOverride
    delegated_to_portal_managers: bool = False


class PortalProjectSettings(ApiModel):
    effective: PortalSettings
    project_override: PortalSettingsOverride
    delegated_to_portal_managers: bool = False
    can_update: bool = False
