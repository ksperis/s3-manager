# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.utils.account_roles import (
    max_portal_account_role,
    portal_account_role_rank,
    require_manager_account_role,
    require_portal_account_role,
)


def test_account_role_validators_are_axis_specific_and_strict():
    assert (
        require_manager_account_role("account_administrator")
        == "account_administrator"
    )
    assert require_portal_account_role("portal_user") == "portal_user"

    with pytest.raises(ValueError, match="Invalid Manager account role"):
        require_manager_account_role("portal_manager")
    with pytest.raises(ValueError, match="Invalid Portal account role"):
        require_portal_account_role(" PORTAL_USER ")


def test_portal_role_precedence_is_shared_and_rejects_unknown_values():
    assert portal_account_role_rank(None) == 0
    assert max_portal_account_role(None, "portal_user") == "portal_user"
    assert (
        max_portal_account_role("portal_user", "portal_manager")
        == "portal_manager"
    )

    with pytest.raises(ValueError, match="Invalid Portal account role"):
        max_portal_account_role("account_administrator")
