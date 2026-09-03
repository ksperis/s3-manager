# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.routers.manager import (
    migrations,
    migrations_actions,
    migrations_definition,
    migrations_read,
)


def test_manager_migrations_router_aggregates_each_workflow_family() -> None:
    feature_routers = (
        migrations_read.router,
        migrations_definition.router,
        migrations_actions.router,
    )
    included_routers = tuple(route.original_router for route in migrations.router.routes)

    assert included_routers == feature_routers
    assert sum(len(router.routes) for router in feature_routers) == 17


def test_manager_migrations_router_preserves_the_public_route_contract() -> None:
    feature_routers = (
        migrations_read.router,
        migrations_definition.router,
        migrations_actions.router,
    )
    routes = {
        (method, route.path)
        for router in feature_routers
        for route in router.routes
        for method in route.methods
    }

    assert routes == {
        ("DELETE", "/manager/migrations/{migration_id}"),
        ("GET", "/manager/migrations"),
        ("GET", "/manager/migrations/{migration_id}"),
        ("GET", "/manager/migrations/{migration_id}/stream"),
        ("PATCH", "/manager/migrations/{migration_id}"),
        ("POST", "/manager/migrations"),
        ("POST", "/manager/migrations/{migration_id}/continue"),
        ("POST", "/manager/migrations/{migration_id}/items/retry-failed"),
        ("POST", "/manager/migrations/{migration_id}/items/rollback-failed"),
        ("POST", "/manager/migrations/{migration_id}/items/{item_id}/retry"),
        ("POST", "/manager/migrations/{migration_id}/items/{item_id}/rollback"),
        ("POST", "/manager/migrations/{migration_id}/pause"),
        ("POST", "/manager/migrations/{migration_id}/precheck"),
        ("POST", "/manager/migrations/{migration_id}/resume"),
        ("POST", "/manager/migrations/{migration_id}/rollback"),
        ("POST", "/manager/migrations/{migration_id}/start"),
        ("POST", "/manager/migrations/{migration_id}/stop"),
    }
