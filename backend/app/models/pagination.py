# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from pydantic import BaseModel


class PaginatedResponse(BaseModel):
    items: list
    total: int
    page: int
    page_size: int
    has_next: bool
