# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from pydantic import BaseModel, Field, field_validator

LDAP_USERNAME_MAX_LENGTH = 256
LDAP_PASSWORD_MAX_LENGTH = 1024


class LDAPProviderInfo(BaseModel):
    id: str
    display_name: str


class LDAPLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=LDAP_USERNAME_MAX_LENGTH)
    password: str = Field(min_length=1, max_length=LDAP_PASSWORD_MAX_LENGTH)

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value):
        if not isinstance(value, str):
            raise ValueError("username must be a string")
        normalized = value.strip()
        if not normalized:
            raise ValueError("username cannot be empty")
        return normalized
