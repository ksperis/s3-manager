# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from fastapi import APIRouter

from app.routers import browser_bucket_config
from app.routers.ceph_admin import (
    bucket_config as ceph_admin_bucket_config,
    bucket_config_access as ceph_admin_bucket_config_access,
    bucket_config_core as ceph_admin_bucket_config_core,
    bucket_config_rules as ceph_admin_bucket_config_rules,
)
from app.routers.manager import (
    bucket_config as manager_bucket_config,
    bucket_config_access as manager_bucket_config_access,
    bucket_config_core as manager_bucket_config_core,
    bucket_config_rules as manager_bucket_config_rules,
)


def _route_operations(router: APIRouter) -> set[tuple[str, tuple[str, ...]]]:
    return {
        (route.path, tuple(sorted(route.methods or ())))
        for route in router.routes
        if hasattr(route, "methods")
    }


def test_browser_bucket_config_exposes_only_inspector_reads() -> None:
    assert _route_operations(browser_bucket_config.router) == {
        ("/buckets/config/{bucket_name}/logging", ("GET",)),
        ("/buckets/config/{bucket_name}/policy", ("GET",)),
        ("/buckets/config/{bucket_name}/properties", ("GET",)),
        ("/buckets/config/{bucket_name}/stats", ("GET",)),
        ("/buckets/config/{bucket_name}/website", ("GET",)),
    }


def test_manager_bucket_config_router_aggregates_every_feature_family() -> None:
    feature_routers = (
        manager_bucket_config_core.router,
        manager_bucket_config_access.router,
        manager_bucket_config_rules.router,
    )
    expected_operations = set().union(
        *(_route_operations(router) for router in feature_routers)
    )
    included_routers = tuple(
        route.original_router for route in manager_bucket_config.router.routes
    )

    assert included_routers == feature_routers
    assert sum(len(router.routes) for router in feature_routers) == 36
    assert len(expected_operations) == 36


def test_ceph_admin_bucket_config_router_aggregates_every_feature_family() -> None:
    feature_routers = (
        ceph_admin_bucket_config_core.router,
        ceph_admin_bucket_config_access.router,
        ceph_admin_bucket_config_rules.router,
    )
    expected_operations = set().union(
        *(_route_operations(router) for router in feature_routers)
    )
    included_routers = tuple(
        route.original_router for route in ceph_admin_bucket_config.router.routes
    )

    assert included_routers == feature_routers
    assert sum(len(router.routes) for router in feature_routers) == 37
    assert len(expected_operations) == 37
