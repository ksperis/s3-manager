# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from pydantic import EmailStr, Field, model_validator

from app.models.base import ApiModel


class FirstAdminBootstrapStatus(ApiModel):
    available: bool


class FirstAdminBootstrapCreate(ApiModel):
    email: EmailStr
    password: str = Field(min_length=1)
    password_confirmation: str = Field(min_length=1)
    full_name: Optional[str] = None

    @model_validator(mode="after")
    def passwords_match(self) -> "FirstAdminBootstrapCreate":
        if self.password != self.password_confirmation:
            raise ValueError("Passwords do not match")
        return self
