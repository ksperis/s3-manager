# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from importlib.util import find_spec

from app.main import app
from app.models.portal_monitoring import PortalActivityItem, PortalAlert
from app.models.portal_settings import PortalAccountSettings, PortalProjectSettings


def test_historical_portal_model_module_is_removed() -> None:
    assert find_spec("app.models.portal") is None


def test_remaining_portal_models_have_canonical_domain_modules() -> None:
    assert PortalActivityItem.__module__ == "app.models.portal_monitoring"
    assert PortalAlert.__module__ == "app.models.portal_monitoring"
    assert PortalAccountSettings.__module__ == "app.models.portal_settings"
    assert PortalProjectSettings.__module__ == "app.models.portal_settings"


def test_monitoring_and_settings_routes_preserve_their_openapi_contracts() -> None:
    paths = app.openapi()["paths"]

    activity_schema = paths["/api/portal/activity"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]
    assert activity_schema["items"] == {"$ref": "#/components/schemas/PortalActivityItem"}

    alerts_schema = paths["/api/portal/alerts"]["get"]["responses"]["200"]["content"]["application/json"][
        "schema"
    ]
    assert alerts_schema["items"] == {"$ref": "#/components/schemas/PortalAlert"}

    project_settings = paths["/api/portal/settings"]["get"]
    assert project_settings["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalProjectSettings"
    }

    account_settings = paths["/api/admin/accounts/{account_id}/portal-settings"]["get"]
    assert account_settings["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalAccountSettings"
    }
