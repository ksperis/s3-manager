# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from pydantic import BaseModel


class OnboardingStatus(BaseModel):
    dismissed: bool
    can_dismiss: bool
    seed_user_configured: bool
    endpoint_configured: bool

