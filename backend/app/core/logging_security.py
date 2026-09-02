# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from app.core.sensitive_data import sanitize_log_text


class SensitiveDataFormatter(logging.Formatter):
    """Apply the shared secret redaction policy to messages and tracebacks."""

    def formatException(self, exc_info) -> str:  # noqa: N802
        return sanitize_log_text(super().formatException(exc_info))

    def format(self, record: logging.LogRecord) -> str:
        return sanitize_log_text(super().format(record))


def configure_secure_logging(*, level: str) -> None:
    root_logger = logging.getLogger()
    root_logger.setLevel(level)
    formatter = SensitiveDataFormatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    if not root_logger.handlers:
        root_logger.addHandler(logging.StreamHandler())
    configured_loggers = [
        root_logger,
        *[
            candidate
            for candidate in logging.Logger.manager.loggerDict.values()
            if isinstance(candidate, logging.Logger)
        ],
    ]
    for configured_logger in configured_loggers:
        for handler in configured_logger.handlers:
            handler.setFormatter(formatter)
