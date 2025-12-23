# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from pydantic import BaseModel


class PortalSettings(BaseModel):
    allow_portal_key: bool = False
    allow_portal_user_bucket_create: bool = False


class ManagerSettings(BaseModel):
    allow_manager_user_usage_stats: bool = True


class AppSettings(BaseModel):
    portal: PortalSettings = PortalSettings()
    manager: ManagerSettings = ManagerSettings()
