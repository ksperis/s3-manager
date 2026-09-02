# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.main import app
from app.models import storage_endpoint as storage_endpoint_models
from app.models.base import ApiModel
from app.models.storage_endpoint import StorageEndpoint, StorageEndpointCreate


def test_storage_endpoint_create_is_the_canonical_write_base() -> None:
    assert StorageEndpointCreate.__bases__ == (ApiModel,)
    assert StorageEndpoint.__bases__ == (StorageEndpointCreate,)
    assert not hasattr(storage_endpoint_models, "StorageEndpointBase")


def test_storage_endpoint_create_openapi_contract_is_preserved() -> None:
    operation = app.openapi()["paths"]["/api/admin/storage-endpoints"]["post"]

    assert operation["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/StorageEndpointCreate"
    }
    assert operation["responses"]["201"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/StorageEndpoint"
    }

    assert "StorageEndpointBase" not in app.openapi()["components"]["schemas"]
