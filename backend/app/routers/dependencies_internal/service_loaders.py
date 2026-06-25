# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import sys

from sqlalchemy.orm import Session

from app.services.effective_access_service import EffectiveAccessService as _EffectiveAccessService

EffectiveAccessService = _EffectiveAccessService


def get_effective_access_service(db: Session):
    facade = sys.modules.get("app.routers.dependencies")
    if facade is not None:
        service_cls = getattr(facade, "EffectiveAccessService", None)
        if callable(service_cls):
            return service_cls(db)
    return _EffectiveAccessService(db)
