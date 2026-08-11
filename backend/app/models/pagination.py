# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.models.base import ApiModel


class PaginatedResponse(ApiModel):
    items: list
    total: int
    page: int
    page_size: int
    has_next: bool
