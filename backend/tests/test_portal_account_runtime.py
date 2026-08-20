# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.services.portal_service import PortalService
from tests.s3_account_factory import make_s3_account


class _AccountLimitsAdmin:
    def __init__(self) -> None:
        self.account_calls = 0

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ) -> dict:
        self.account_calls += 1
        return {
            "id": account_id,
            "limits": {"max_buckets": 5},
        }

    def get_account_quota(self, account_id: str) -> tuple[int, int]:
        pytest.fail(f"account payload must not be loaded twice for {account_id}")


def test_account_limits_do_not_repeat_lookup_without_embedded_quota(db_session, monkeypatch) -> None:
    account = make_s3_account(db_session, name="portal-limits")
    service = PortalService(db_session)
    admin = _AccountLimitsAdmin()
    monkeypatch.setattr(service, "_quota_admin_for_account", lambda _account: admin)

    assert service._account_limits(account) == (None, None, 5)
    assert admin.account_calls == 1
