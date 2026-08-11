# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from pydantic import BaseModel, ConfigDict


class ApiModel(BaseModel):
    """Canonical base for strict backend API data-transfer objects."""

    model_config = ConfigDict(extra="forbid")
