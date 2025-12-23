# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from pydantic import BaseModel


class OIDCProviderInfo(BaseModel):
    id: str
    display_name: str
    icon_url: Optional[str] = None


class OIDCStartRequest(BaseModel):
    redirect_path: Optional[str] = None


class OIDCStartResponse(BaseModel):
    provider: str
    authorization_url: str
    state: str


class OIDCCallbackRequest(BaseModel):
    code: str
    state: str
