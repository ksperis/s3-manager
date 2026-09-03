# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from fastapi import APIRouter

from app.routers import (
    browser_bucket_config,
    browser_bucket_config_access,
    browser_bucket_config_core,
    browser_bucket_config_rules,
)


def _route_operations(router: APIRouter) -> set[tuple[str, tuple[str, ...]]]:
    return {
        (route.path, tuple(sorted(route.methods or ())))
        for route in router.routes
        if hasattr(route, "methods")
    }


def test_browser_bucket_config_router_aggregates_every_feature_family() -> None:
    feature_routers = (
        browser_bucket_config_core.router,
        browser_bucket_config_access.router,
        browser_bucket_config_rules.router,
    )
    expected_operations = set().union(
        *(_route_operations(router) for router in feature_routers)
    )
    included_routers = tuple(
        route.original_router for route in browser_bucket_config.router.routes
    )

    assert included_routers == feature_routers
    assert sum(len(router.routes) for router in feature_routers) == 40
    assert len(expected_operations) == 40
