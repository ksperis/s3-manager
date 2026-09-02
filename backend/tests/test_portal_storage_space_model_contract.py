# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.main import app
from app.models.portal_storage_spaces import PortalStorageSpaceSummary


def test_portal_storage_space_models_have_a_single_canonical_module() -> None:
    assert PortalStorageSpaceSummary.__module__ == "app.models.portal_storage_spaces"


def test_portal_storage_space_routes_preserve_their_openapi_contracts() -> None:
    paths = app.openapi()["paths"]

    list_spaces = paths["/api/portal/storage-spaces"]["get"]
    list_schema = list_spaces["responses"]["200"]["content"]["application/json"]["schema"]
    assert list_schema["type"] == "array"
    assert list_schema["items"] == {"$ref": "#/components/schemas/PortalStorageSpaceSummary"}

    create_space = paths["/api/portal/storage-spaces"]["post"]
    assert create_space["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalStorageSpaceCreate"
    }
    assert create_space["responses"]["201"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalStorageSpaceSummary"
    }

    assert "PortalStorageSpace" not in app.openapi()["components"]["schemas"]
