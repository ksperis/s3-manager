# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.models.base import ApiModel


class OnboardingStatus(ApiModel):
    dismissed: bool
    complete: bool
    endpoint_configured: bool
    storage_access_configured: bool
