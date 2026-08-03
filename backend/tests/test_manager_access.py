# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from types import SimpleNamespace

from fastapi import HTTPException
import pytest

from app.routers.manager.access import require_bucket_management_context


@pytest.mark.parametrize(
    "capabilities",
    [None, SimpleNamespace(can_manage_buckets=True)],
)
def test_bucket_management_context_accepts_unrestricted_or_capable_contexts(capabilities):
    require_bucket_management_context(
        SimpleNamespace(manager_capabilities=capabilities)
    )


def test_bucket_management_context_rejects_missing_capability():
    account = SimpleNamespace(
        manager_capabilities=SimpleNamespace(can_manage_buckets=False)
    )

    with pytest.raises(HTTPException) as exc_info:
        require_bucket_management_context(account)

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Bucket management is not allowed for this context"
