# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator, TypeEngine

from app.utils.time import normalize_utc


class UTCDateTime(TypeDecorator[datetime]):
    """Persist timezone-aware datetimes and always expose normalized UTC values.

    PostgreSQL uses ``TIMESTAMP WITH TIME ZONE``. SQLite has no timezone-aware
    datetime storage, so its driver representation remains naive UTC while the
    public Python value is restored as aware UTC on read.
    """

    impl = DateTime
    cache_ok = True

    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[datetime]:
        return dialect.type_descriptor(DateTime(timezone=dialect.name != "sqlite"))

    def process_bind_param(
        self,
        value: datetime | None,
        dialect: Dialect,
    ) -> datetime | None:
        if value is None:
            return None
        normalized = normalize_utc(value, name="UTCDateTime")
        if dialect.name == "sqlite":
            return normalized.replace(tzinfo=None)
        return normalized

    def process_result_value(
        self,
        value: datetime | None,
        dialect: Dialect,
    ) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            if dialect.name != "sqlite":
                raise ValueError("Database returned a naive UTCDateTime value")
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
