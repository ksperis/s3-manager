# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlalchemy.sql.elements import ColumnElement


def s3_user_name_order_by(model: Any) -> tuple[ColumnElement[Any], ColumnElement[Any], ColumnElement[Any]]:
    return (
        func.lower(model.name).asc(),
        model.name.asc(),
        model.id.asc(),
    )
