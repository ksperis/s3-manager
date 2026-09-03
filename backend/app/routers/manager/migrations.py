# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Aggregate Manager bucket-migration routers."""

from fastapi import APIRouter

from app.routers.manager import (
    migrations_actions,
    migrations_definition,
    migrations_read,
)

router = APIRouter()
router.include_router(migrations_read.router)
router.include_router(migrations_definition.router)
router.include_router(migrations_actions.router)
