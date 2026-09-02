# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.main import app
from app.models import portal as legacy_portal_models
from app.models.portal_objects import PortalStorageObjectDeleteResponse, PortalStorageObjectDetail


def test_portal_object_models_have_a_single_canonical_module() -> None:
    assert PortalStorageObjectDetail.__module__ == "app.models.portal_objects"
    assert PortalStorageObjectDeleteResponse.__module__ == "app.models.portal_objects"
    assert not hasattr(legacy_portal_models, "PortalStorageObjectDetail")
    assert not hasattr(legacy_portal_models, "PortalStorageObjectDeleteResponse")


def test_portal_object_routes_preserve_their_openapi_contracts() -> None:
    paths = app.openapi()["paths"]

    detail = paths["/api/portal/storage-spaces/{space_id}/objects/detail"]["get"]
    assert detail["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalStorageObjectDetail"
    }

    delete = paths["/api/portal/storage-spaces/{space_id}/objects"]["delete"]
    assert delete["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalStorageObjectDeleteResponse"
    }
