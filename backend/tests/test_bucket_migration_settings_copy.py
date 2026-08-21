# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import ANY

import pytest

from app.services.bucket_migration_service import BucketMigrationService


def _execution_plan(strategy: str) -> str:
    return json.dumps(
        {
            "report_version": 2,
            "strategy": strategy,
            "supported": True,
            "blocked": False,
            "delete_source_safe": True,
            "rollback_safe": True,
            "same_endpoint_copy_safe": True,
            "blocking_codes": [],
        }
    )


class _SettingsStub:
    def __init__(self, *, fail_write: str | None = None) -> None:
        self.fail_write = fail_write
        self.calls: list[tuple[str, object]] = []

    def _read(self, name: str, value):
        self.calls.append((name, None))
        return value

    def _write(self, name: str, value=None) -> None:
        self.calls.append((name, value))
        if name == self.fail_write:
            raise RuntimeError(f"{name} failed")

    def get_bucket_properties(self, *_args):
        return self._read(
            "get_bucket_properties",
            SimpleNamespace(versioning_status="Enabled"),
        )

    def set_versioning(self, *_args, enabled: bool):
        self._write("set_versioning", enabled)

    def get_bucket_object_lock(self, *_args):
        return self._read(
            "get_bucket_object_lock",
            SimpleNamespace(enabled=True, mode="GOVERNANCE", days=7, years=None),
        )

    def set_object_lock(self, *_args):
        self._write("set_object_lock")

    def get_bucket_encryption(self, *_args):
        return self._read(
            "get_bucket_encryption",
            SimpleNamespace(rules=[{"algorithm": "AES256"}]),
        )

    def set_bucket_encryption(self, *_args):
        self._write("set_bucket_encryption")

    def delete_bucket_encryption(self, *_args):
        self._write("delete_bucket_encryption")

    def get_public_access_block(self, *_args):
        return self._read("get_public_access_block", {"block_public_acls": True})

    def set_public_access_block(self, *_args):
        self._write("set_public_access_block")

    def get_lifecycle(self, *_args):
        return self._read("get_lifecycle", SimpleNamespace(rules=[]))

    def set_lifecycle(self, *_args):
        self._write("set_lifecycle")

    def delete_lifecycle(self, *_args):
        self._write("delete_lifecycle")

    def get_bucket_cors(self, *_args):
        return self._read("get_bucket_cors", [{"allowed_methods": ["GET"]}])

    def set_cors(self, *_args):
        self._write("set_cors")

    def delete_cors(self, *_args):
        self._write("delete_cors")

    def get_policy(self, *_args):
        return self._read("get_policy", None)

    def put_policy(self, *_args):
        self._write("put_policy")

    def delete_policy(self, *_args):
        self._write("delete_policy")

    def get_bucket_tags(self, *_args):
        return self._read(
            "get_bucket_tags",
            [SimpleNamespace(key="team", value="storage")],
        )

    def set_bucket_tags(self, *_args):
        self._write("set_bucket_tags", _args[-1])

    def delete_bucket_tags(self, *_args):
        self._write("delete_bucket_tags")

    def get_bucket_logging(self, *_args):
        return self._read("get_bucket_logging", {"enabled": True})

    def set_bucket_logging(self, *_args):
        self._write("set_bucket_logging")


def _run_copy(db_session, *, strategy: str, settings: _SettingsStub):
    service = BucketMigrationService(db_session)
    service._configuration = settings  # type: ignore[assignment]
    events: list[dict[str, object]] = []
    service._add_event = (  # type: ignore[method-assign]
        lambda *_args, **kwargs: events.append(kwargs)
    )
    service._copy_bucket_settings(
        object(),
        "source-bucket",
        object(),
        "target-bucket",
        SimpleNamespace(),
        SimpleNamespace(execution_plan_json=_execution_plan(strategy)),
    )
    return events


def test_copy_bucket_settings_runs_declarative_operations_in_order(db_session):
    settings = _SettingsStub()

    events = _run_copy(db_session, strategy="current_only", settings=settings)

    assert settings.calls == [
        ("get_bucket_properties", None),
        ("set_versioning", True),
        ("get_bucket_object_lock", None),
        ("set_object_lock", None),
        ("get_bucket_encryption", None),
        ("set_bucket_encryption", None),
        ("get_public_access_block", None),
        ("set_public_access_block", None),
        ("get_lifecycle", None),
        ("delete_lifecycle", None),
        ("get_bucket_cors", None),
        ("set_cors", None),
        ("get_policy", None),
        ("delete_policy", None),
        ("get_bucket_tags", None),
        ("set_bucket_tags", [{"key": "team", "value": "storage"}]),
        ("get_bucket_logging", None),
        ("set_bucket_logging", None),
    ]
    assert events == [
        {
            "item": ANY,
            "level": "info",
            "message": "Bucket settings copied.",
        }
    ]


def test_copy_bucket_settings_forces_versioning_for_version_aware_strategy(
    db_session,
):
    settings = _SettingsStub()

    events = _run_copy(db_session, strategy="version_aware", settings=settings)

    assert settings.calls[0] == ("set_versioning", True)
    assert all(name != "get_bucket_properties" for name, _value in settings.calls)
    assert events[-1]["message"] == "Bucket settings copied."


def test_copy_bucket_settings_continues_after_failure_and_aggregates(db_session):
    settings = _SettingsStub(fail_write="set_bucket_encryption")
    service = BucketMigrationService(db_session)
    service._configuration = settings  # type: ignore[assignment]
    events: list[dict[str, object]] = []
    service._add_event = (  # type: ignore[method-assign]
        lambda *_args, **kwargs: events.append(kwargs)
    )

    with pytest.raises(
        RuntimeError,
        match="Bucket settings copy failed.*encryption: set_bucket_encryption failed",
    ):
        service._copy_bucket_settings(
            object(),
            "source-bucket",
            object(),
            "target-bucket",
            SimpleNamespace(),
            SimpleNamespace(execution_plan_json=_execution_plan("current_only")),
        )

    assert ("set_bucket_logging", None) in settings.calls
    assert events == [
        {
            "item": ANY,
            "level": "error",
            "message": "Default bucket encryption copy failed.",
            "metadata": {
                "error": "set_bucket_encryption failed",
                "setting": "encryption",
            },
        }
    ]
