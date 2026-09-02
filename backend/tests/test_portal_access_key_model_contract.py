# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.main import app
from app.models.portal_access_keys import PortalAccessKey, PortalAccessKeysState


def test_portal_access_key_models_have_a_single_canonical_module() -> None:
    assert PortalAccessKey.__module__ == "app.models.portal_access_keys"
    assert PortalAccessKeysState.__module__ == "app.models.portal_access_keys"


def test_portal_access_key_routes_preserve_their_openapi_contracts() -> None:
    paths = app.openapi()["paths"]

    list_keys = paths["/api/portal/access-keys"]["get"]
    assert list_keys["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalAccessKeysState"
    }

    create_key = paths["/api/portal/access-keys"]["post"]
    assert create_key["requestBody"]["content"]["application/json"]["schema"] == {
        "anyOf": [
            {"$ref": "#/components/schemas/PortalAccessKeyCreate"},
            {"type": "null"},
        ],
        "title": "Payload",
    }
    assert create_key["responses"]["201"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalAccessKey"
    }
