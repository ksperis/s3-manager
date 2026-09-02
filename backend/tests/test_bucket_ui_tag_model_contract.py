# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.main import app
from app.models.base import ApiModel
from app.models.bucket_ui_tags import (
    CephAdminBucketUiTagCreate,
    CephAdminBucketUiTagDefinitionPatch,
    StorageOpsBucketUiTagCreate,
    StorageOpsBucketUiTagDefinitionPatch,
)


def test_storage_ops_ui_tag_models_are_the_canonical_bases() -> None:
    assert StorageOpsBucketUiTagCreate.__bases__ == (ApiModel,)
    assert CephAdminBucketUiTagCreate.__bases__ == (StorageOpsBucketUiTagCreate,)
    assert StorageOpsBucketUiTagDefinitionPatch.__bases__ == (ApiModel,)
    assert CephAdminBucketUiTagDefinitionPatch.__bases__ == (StorageOpsBucketUiTagDefinitionPatch,)


def test_ui_tag_definition_routes_keep_public_patch_components() -> None:
    paths = app.openapi()["paths"]

    ceph_patch = paths["/api/ceph-admin/endpoints/{endpoint_id}/bucket-ui-tags/{tag_id}"]["patch"]
    storage_ops_patch = paths["/api/storage-ops/bucket-ui-tags/{tag_id}"]["patch"]

    assert ceph_patch["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/CephAdminBucketUiTagDefinitionPatch"
    }
    assert storage_ops_patch["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/StorageOpsBucketUiTagDefinitionPatch"
    }

    schemas = app.openapi()["components"]["schemas"]
    assert "_BucketUiTagCreateBase" not in schemas
    assert "_BucketUiTagDefinitionPatchBase" not in schemas
