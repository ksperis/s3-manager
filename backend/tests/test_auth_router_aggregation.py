# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.routers import (
    auth,
    auth_api_tokens,
    auth_ldap,
    auth_local,
    auth_mfa,
    auth_oidc,
    auth_s3,
    auth_sessions,
)


def test_auth_router_aggregates_each_authentication_domain() -> None:
    feature_routers = (
        auth_api_tokens.router,
        auth_local.router,
        auth_ldap.router,
        auth_s3.router,
        auth_oidc.router,
        auth_mfa.router,
        auth_sessions.router,
    )
    included_routers = tuple(route.original_router for route in auth.router.routes)

    assert included_routers == feature_routers
    assert sum(len(router.routes) for router in feature_routers) == 32
