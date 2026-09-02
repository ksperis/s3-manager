# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.main import app


def _response_schema(path: str) -> dict:
    return app.openapi()["paths"][path]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]


def test_manager_and_portal_usage_trends_share_response_schema() -> None:
    manager_schema = _response_schema("/api/manager/stats/usage-trends")
    portal_schema = _response_schema("/api/portal/usage-trends")

    assert manager_schema == {"$ref": "#/components/schemas/UsageTrendsResponse"}
    assert portal_schema == manager_schema

    schemas = app.openapi()["components"]["schemas"]
    assert "UsageTrendBaseline" in schemas
    assert "ManagerUsageTrendBaseline" not in schemas
    assert "ManagerUsageTrendsResponse" not in schemas
