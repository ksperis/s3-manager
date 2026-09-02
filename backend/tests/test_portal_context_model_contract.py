# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.main import app
from app.models.portal_context import PortalAccount, PortalState


def test_portal_context_models_have_a_single_canonical_module() -> None:
    assert PortalAccount.__module__ == "app.models.portal_context"
    assert PortalState.__module__ == "app.models.portal_context"


def test_portal_context_routes_preserve_their_openapi_contracts() -> None:
    paths = app.openapi()["paths"]

    accounts = paths["/api/portal/accounts"]["get"]
    assert accounts["responses"]["200"]["content"]["application/json"]["schema"] == {
        "items": {"$ref": "#/components/schemas/PortalAccount"},
        "type": "array",
        "title": "Response List Portal Accounts Api Portal Accounts Get",
    }

    state = paths["/api/portal/state"]["get"]
    assert state["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalState"
    }
