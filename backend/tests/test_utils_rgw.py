# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.rgw import is_rgw_account_id, resolve_account_scope


def test_resolve_account_scope_with_account_id():
    account_id = "RGW12345678901234567"
    resolved_account_id, tenant = resolve_account_scope(account_id)
    assert resolved_account_id == account_id
    assert tenant is None
    assert is_rgw_account_id(account_id)


def test_resolve_account_scope_with_tenant_name():
    identifier = "env-admin"
    resolved_account_id, tenant = resolve_account_scope(identifier)
    assert resolved_account_id is None
    assert tenant == identifier
    assert not is_rgw_account_id(identifier)
