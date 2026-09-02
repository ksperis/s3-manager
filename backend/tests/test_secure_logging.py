# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import sys

from app.db import EndpointHealthCheck, EndpointHealthLatest, HealthCheckStatus, StorageEndpoint
from app.core.logging_security import SensitiveDataFormatter
from app.core.sensitive_data import sanitize_persisted_error
from app.services.bucket_migration._shared import _truncate_optional_db_text
from app.services.healthcheck_common import HealthCheckResult
from app.services.healthcheck_persistence_service import HealthCheckPersistenceService
from app.utils.time import utcnow


def _format_record(*, message: str, exc_info=None) -> str:
    record = logging.LogRecord(
        name="security-test",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg=message,
        args=(),
        exc_info=exc_info,
    )
    return SensitiveDataFormatter("%(levelname)s %(message)s").format(record)


def test_formatter_redacts_secrets_urls_aws_keys_and_control_characters():
    rendered = _format_record(
        message=(
            "password=super-secret access_key_id=AKIA1234567890ABCDEF "
            "https://rgw.example.test/object?X-Amz-Signature=deadbeef\r\x1b[31m"
        )
    )

    assert "super-secret" not in rendered
    assert "AKIA1234567890ABCDEF" not in rendered
    assert "rgw.example.test" not in rendered
    assert "deadbeef" not in rendered
    assert "\r" not in rendered
    assert "\x1b" not in rendered
    assert "password=<redacted>" in rendered
    assert "<redacted-url>" in rendered


def test_formatter_redacts_exception_text_inside_traceback():
    try:
        raise RuntimeError(
            "token=trace-secret https://rgw.example.test/path?X-Amz-Credential=credential-secret"
        )
    except RuntimeError:
        rendered = _format_record(message="operation failed", exc_info=sys.exc_info())

    assert "trace-secret" not in rendered
    assert "credential-secret" not in rendered
    assert "rgw.example.test" not in rendered
    assert "token=<redacted>" in rendered
    assert "<redacted-url>" in rendered


def test_persisted_error_is_redacted_and_bounded():
    rendered = sanitize_persisted_error(
        "secret_access_key=must-not-persist " + ("x" * 200),
        max_chars=64,
    )

    assert len(rendered) <= 64
    assert "must-not-persist" not in rendered
    assert "secret_access_key=<redacted>" in rendered


def test_migration_error_boundary_redacts_exception_derived_text():
    rendered = _truncate_optional_db_text(
        "password=migration-secret https://rgw.example.test/object?X-Amz-Signature=deadbeef",
        max_chars=256,
    )

    assert rendered is not None
    assert "migration-secret" not in rendered
    assert "rgw.example.test" not in rendered
    assert "deadbeef" not in rendered


def test_healthcheck_persistence_redacts_error_messages(db_session):
    endpoint = StorageEndpoint(
        name="healthcheck secure persistence",
        endpoint_url="https://health.example.test",
        provider="other",
    )
    db_session.add(endpoint)
    db_session.flush()
    result = HealthCheckResult(
        endpoint_id=endpoint.id,
        status=HealthCheckStatus.DOWN,
        checked_at=utcnow(),
        latency_ms=None,
        http_status=None,
        error_message=(
            "password=health-secret "
            "https://health.example.test/check?X-Amz-Signature=deadbeef"
        ),
        check_mode="http",
    )

    HealthCheckPersistenceService(db_session).record_results([result])

    history = db_session.query(EndpointHealthCheck).one()
    latest = db_session.query(EndpointHealthLatest).one()
    for persisted in (history.error_message, latest.error_message):
        assert persisted is not None
        assert "health-secret" not in persisted
        assert "health.example.test" not in persisted
        assert "deadbeef" not in persisted
