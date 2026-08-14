# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterator

from fastapi import APIRouter


@dataclass(frozen=True)
class EffectiveRoute:
    """Stable route view across eager and deferred FastAPI router inclusion."""

    path: str
    endpoint: Any
    methods: frozenset[str]


def effective_routes(router: APIRouter, *, prefix: str = "") -> list[EffectiveRoute]:
    return list(_iter_effective_routes(router, prefix=prefix))


def _iter_effective_routes(
    router: APIRouter,
    *,
    prefix: str,
) -> Iterator[EffectiveRoute]:
    for route in router.routes:
        included_router = getattr(route, "original_router", None)
        include_context = getattr(route, "include_context", None)
        if included_router is not None and include_context is not None:
            yield from _iter_effective_routes(
                included_router,
                prefix=f"{prefix}{include_context.prefix}",
            )
            continue
        path = getattr(route, "path", None)
        endpoint = getattr(route, "endpoint", None)
        if path is None or endpoint is None:
            continue
        yield EffectiveRoute(
            path=f"{prefix}{path}",
            endpoint=endpoint,
            methods=frozenset(getattr(route, "methods", set()) or set()),
        )
