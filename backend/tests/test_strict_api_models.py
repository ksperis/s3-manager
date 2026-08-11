# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any

from app.main import app


def _collect_schema_refs(value: Any, refs: set[str]) -> None:
    if isinstance(value, dict):
        ref = value.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            refs.add(ref.rsplit("/", 1)[-1])
        for nested in value.values():
            _collect_schema_refs(nested, refs)
    elif isinstance(value, list):
        for nested in value:
            _collect_schema_refs(nested, refs)


def test_application_api_object_schemas_reject_unknown_fields():
    spec = app.openapi()
    generated_non_json_body_schemas: set[str] = set()
    for path_item in spec["paths"].values():
        for operation in path_item.values():
            if not isinstance(operation, dict):
                continue
            request_body = operation.get("requestBody")
            if not request_body:
                continue
            for content_type, media_type in request_body["content"].items():
                if content_type != "application/json":
                    _collect_schema_refs(media_type["schema"], generated_non_json_body_schemas)

    framework_schemas = {"HTTPValidationError", "ValidationError"}
    allowed_permissive_schemas = framework_schemas | generated_non_json_body_schemas
    schemas = spec["components"]["schemas"]
    permissive_application_schemas = sorted(
        name
        for name, schema in schemas.items()
        if "properties" in schema
        and schema.get("additionalProperties") is not False
        and name not in allowed_permissive_schemas
    )

    assert permissive_application_schemas == []


def test_json_route_rejects_unknown_fields(client):
    response = client.post(
        "/api/auth/ldap/corp/login",
        json={"username": "jane", "password": "secret-password", "obsolete_field": True},
    )

    assert response.status_code == 422
    assert any(error["loc"][-1] == "obsolete_field" for error in response.json()["detail"])
