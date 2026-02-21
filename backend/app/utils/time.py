# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import UTC, datetime


def utcnow() -> datetime:
    """Return current UTC as a naive datetime.

    The codebase historically stores naive UTC datetimes. This helper avoids
    deprecated utcnow() while preserving that storage format.
    """
    return datetime.now(UTC).replace(tzinfo=None)
