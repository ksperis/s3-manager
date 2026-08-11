# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.models.base import ApiModel


class OnboardingStatus(ApiModel):
    dismissed: bool
    can_dismiss: bool
    seed_user_configured: bool
    endpoint_configured: bool

