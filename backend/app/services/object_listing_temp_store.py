# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import sqlite3
import tempfile
from types import TracebackType
from typing import Optional, Type


class TemporarySqliteStore:
    def __init__(self, *, prefix: str) -> None:
        self._temp_dir = tempfile.TemporaryDirectory(prefix=prefix)
        self.path = f"{self._temp_dir.name}/store.sqlite3"
        try:
            self.connection = sqlite3.connect(self.path)
        except Exception:
            self._temp_dir.cleanup()
            raise
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA synchronous = OFF")
        self.connection.execute("PRAGMA journal_mode = OFF")

    def close(self) -> None:
        try:
            self.connection.close()
        finally:
            self._temp_dir.cleanup()

    def __enter__(self) -> "TemporarySqliteStore":
        return self

    def __exit__(
        self,
        _exc_type: Optional[Type[BaseException]],
        _exc: Optional[BaseException],
        _traceback: Optional[TracebackType],
    ) -> None:
        self.close()
