# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.main import app
from app.models import portal as legacy_portal_models
from app.models.portal_usage import PortalStorageSpaceUsageStatsResponse, PortalUsage


def test_portal_usage_models_have_a_single_canonical_module() -> None:
    assert PortalUsage.__module__ == "app.models.portal_usage"
    assert PortalStorageSpaceUsageStatsResponse.__module__ == "app.models.portal_usage"
    assert not hasattr(legacy_portal_models, "PortalUsage")
    assert not hasattr(legacy_portal_models, "PortalStorageSpaceUsageStatsResponse")


def test_portal_usage_routes_preserve_their_openapi_contracts() -> None:
    paths = app.openapi()["paths"]

    usage = paths["/api/portal/usage"]["get"]
    assert usage["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalUsage"
    }

    storage_stats = paths["/api/portal/storage-spaces/{space_id}/usage-stats"]["get"]
    assert storage_stats["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalStorageSpaceUsageStatsResponse"
    }
