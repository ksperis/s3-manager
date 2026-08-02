# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from app.services.effective_access_service import EffectiveAccessService


def get_effective_access_service(db: Session):
    return EffectiveAccessService(db)
