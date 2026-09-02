# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.main import app
from app.services.bucket_listing_enrichment import (
    BUCKET_FEATURE_INCLUDES,
    BUCKET_LISTING_INCLUDES,
    COLUMN_DETAIL_KEYS,
)
from app.services.ceph_admin_bucket_listing_request import CephAdminBucketListingRequest
from app.services.storage_ops_bucket_listing_request import (
    prepare_storage_ops_bucket_listing_request,
)


def test_bucket_listing_include_contract_is_shared_across_surfaces() -> None:
    includes = ["tags", "versioning", "object_lock_mode", "unknown"]

    ceph_admin = CephAdminBucketListingRequest.parse(
        raw_filter=None,
        raw_advanced_filter=None,
        sort_by="name",
        sort_dir="asc",
        include=includes,
        with_stats=False,
    )
    storage_ops = prepare_storage_ops_bucket_listing_request(
        filter=None,
        advanced_filter=None,
        include=includes,
        with_stats=False,
        sort_by="name",
    )

    assert BUCKET_LISTING_INCLUDES == BUCKET_FEATURE_INCLUDES | COLUMN_DETAIL_KEYS
    assert ceph_admin.requested_features == frozenset({"versioning"})
    assert ceph_admin.requested_detail_fields == frozenset({"object_lock_mode"})
    assert ceph_admin.include_tags is True
    assert storage_ops.requested_features == {"versioning", "object_lock_mode"}
    assert storage_ops.include_tags is True


def test_bucket_listing_query_routes_share_request_schema() -> None:
    paths = app.openapi()["paths"]
    ceph_schema = paths[
        "/api/ceph-admin/endpoints/{endpoint_id}/buckets/query"
    ]["post"]["requestBody"]["content"]["application/json"]["schema"]
    storage_ops_schema = paths["/api/storage-ops/buckets/query"]["post"][
        "requestBody"
    ]["content"]["application/json"]["schema"]

    assert ceph_schema == {"$ref": "#/components/schemas/BucketListingRequest"}
    assert storage_ops_schema == ceph_schema
