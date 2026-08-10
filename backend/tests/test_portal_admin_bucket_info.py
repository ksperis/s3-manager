# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace
from unittest.mock import Mock, call

from app.services.portal_service import PortalService


def test_admin_bucket_info_uses_canonical_root_uid_without_unscoped_retry():
    service = PortalService(Mock())
    account = SimpleNamespace(rgw_user_uid="root-user")
    admin = Mock()
    admin.get_bucket_info.return_value = {"bucket": "research-data"}

    result = service._admin_bucket_info(account, "research-data", admin=admin)

    assert result == {"bucket": "research-data"}
    admin.get_bucket_info.assert_called_once_with(
        "research-data",
        allow_not_found=True,
        uid="root-user",
    )


def test_admin_bucket_info_retries_unscoped_only_when_scoped_lookup_misses():
    service = PortalService(Mock())
    account = SimpleNamespace(rgw_user_uid="root-user")
    admin = Mock()
    admin.get_bucket_info.side_effect = [None, {"bucket": "research-data"}]

    result = service._admin_bucket_info(account, "research-data", admin=admin)

    assert result == {"bucket": "research-data"}
    assert admin.get_bucket_info.call_args_list == [
        call("research-data", allow_not_found=True, uid="root-user"),
        call("research-data", allow_not_found=True),
    ]
