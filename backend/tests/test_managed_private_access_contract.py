# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from pydantic import ValidationError

from app.main import app
from app.models.managed_private_access import (
    ManagedIAMPrivateAccessRequest,
    ManagedRGWUserPrivateAccessRequest,
)


@pytest.mark.parametrize(
    "forbidden_field,value",
    [
        ("access_key_id", "AK"),
        ("secret_access_key", "SECRET"),
        ("iam_username", "chosen-name"),
        ("endpoint_url", "https://other.example.test"),
        ("storage_endpoint_id", 42),
        ("region", "us-east-1"),
        ("provider_hint", "ceph"),
        ("force_path_style", True),
        ("verify_tls", False),
        ("user_id", 9),
        ("source_context_id", 11),
    ],
)
def test_iam_payload_forbids_server_derived_fields(forbidden_field, value):
    payload = {
        "connection_name": "private",
        "access_browser": True,
        "access_manager": False,
        "groups": [],
        "managed_policies": [],
        "inline_policies": [],
        forbidden_field: value,
    }
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        ManagedIAMPrivateAccessRequest.model_validate(payload)


def test_access_flags_are_explicit_and_at_least_one_is_enabled():
    with pytest.raises(ValidationError):
        ManagedRGWUserPrivateAccessRequest.model_validate({"connection_name": "private"})
    with pytest.raises(ValidationError, match="At least one access flag"):
        ManagedRGWUserPrivateAccessRequest(
            connection_name="private",
            access_browser=False,
            access_manager=False,
        )


def test_openapi_response_has_no_secret_or_generated_key_model():
    schema = app.openapi()
    operation = schema["paths"]["/api/manager/private-access/iam"]["post"]
    request_ref = operation["requestBody"]["content"]["application/json"]["schema"]["$ref"]
    request_schema = schema["components"]["schemas"][request_ref.rsplit("/", 1)[-1]]
    assert set(request_schema["required"]) >= {
        "connection_name",
        "access_browser",
        "access_manager",
    }
    response_ref = operation["responses"]["201"]["content"]["application/json"]["schema"]["$ref"]
    response_schema = schema["components"]["schemas"][response_ref.rsplit("/", 1)[-1]]
    assert "secret_access_key" not in response_schema.get("properties", {})
    assert set(response_schema.get("properties", {})) == {"provisioning_id", "status", "connection"}
    assert "/api/manager/private-access/rgw-user" in schema["paths"]
    assert "/api/manager/private-access/provisionings/{provisioning_id}/retry-cleanup" in schema["paths"]
