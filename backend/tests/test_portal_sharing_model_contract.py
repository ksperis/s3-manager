# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.main import app
from app.models.portal_sharing import PortalPublicLink, PortalStorageSpaceAccessSummary


def test_portal_sharing_models_have_a_single_canonical_module() -> None:
    assert PortalPublicLink.__module__ == "app.models.portal_sharing"
    assert PortalStorageSpaceAccessSummary.__module__ == "app.models.portal_sharing"


def test_portal_sharing_routes_preserve_their_openapi_contracts() -> None:
    paths = app.openapi()["paths"]

    access_summary = paths["/api/portal/storage-spaces/{space_id}/access-summary"]["get"]
    assert access_summary["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalStorageSpaceAccessSummary"
    }

    collaborators = paths["/api/portal/collaborators"]["get"]
    assert collaborators["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalCollaboratorsResponse"
    }

    create_link = paths["/api/portal/storage-spaces/{space_id}/public-links"]["post"]
    assert create_link["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalPublicLinkCreate"
    }
    assert create_link["responses"]["201"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalPublicLink"
    }
