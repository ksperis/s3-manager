# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.audit_service import AuditService, get_audit_service as build_audit_service

def get_audit_logger(
    db: Session = Depends(get_db),
) -> AuditService:
    return build_audit_service(db)
