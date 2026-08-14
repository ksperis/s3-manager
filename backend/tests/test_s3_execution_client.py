# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest

from app.services.s3_execution_client import (
    require_s3_execution_credentials,
    s3_execution_client_kwargs,
)


def test_require_s3_execution_credentials_preserves_requested_error() -> None:
    account = SimpleNamespace(effective_rgw_credentials=lambda: (None, None))

    with pytest.raises(RuntimeError, match="custom credentials error"):
        require_s3_execution_credentials(
            account,
            error_message="custom credentials error",
        )


def test_s3_execution_client_kwargs_includes_session_overrides() -> None:
    account = SimpleNamespace(
        storage_endpoint=None,
        session_endpoint="https://s3.example.test",
        session_region="us-east-2",
        session_force_path_style=True,
        session_verify_tls=False,
        session_token=lambda: "session-token",
    )

    assert s3_execution_client_kwargs(account) == {
        "endpoint": "https://s3.example.test",
        "region": "us-east-2",
        "force_path_style": True,
        "verify_tls": False,
        "session_token": "session-token",
    }
