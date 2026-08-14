# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from app.models.admin_automation import AdminAutomationItemResult


class AdminAutomationResultFactory:
    @staticmethod
    def _created(
        resource: str,
        key: str,
        entity_id: Optional[int] = None,
        *,
        dry_run: bool,
    ) -> AdminAutomationItemResult:
        return AdminAutomationItemResult(
            resource=resource,
            key=key,
            action="created",
            changed=True,
            id=str(entity_id) if entity_id is not None else None,
            dry_run=dry_run,
        )

    @staticmethod
    def _updated(
        resource: str,
        key: str,
        entity_id: Optional[int] = None,
        diff: Optional[dict[str, dict[str, Any]]] = None,
        *,
        dry_run: bool,
    ) -> AdminAutomationItemResult:
        return AdminAutomationItemResult(
            resource=resource,
            key=key,
            action="updated",
            changed=True,
            id=str(entity_id) if entity_id is not None else None,
            diff=diff,
            dry_run=dry_run,
        )

    @staticmethod
    def _deleted(
        resource: str,
        key: str,
        entity_id: Optional[int] = None,
        *,
        dry_run: bool,
    ) -> AdminAutomationItemResult:
        return AdminAutomationItemResult(
            resource=resource,
            key=key,
            action="deleted",
            changed=True,
            id=str(entity_id) if entity_id is not None else None,
            dry_run=dry_run,
        )

    @staticmethod
    def _skipped(resource: str, key: str, *, dry_run: bool) -> AdminAutomationItemResult:
        return AdminAutomationItemResult(
            resource=resource,
            key=key,
            action="skipped",
            changed=False,
            dry_run=dry_run,
        )

    @staticmethod
    def _failed(resource: str, key: str, exc: Exception, *, dry_run: bool) -> AdminAutomationItemResult:
        return AdminAutomationItemResult(
            resource=resource,
            key=key,
            action="failed",
            changed=False,
            error=str(exc),
            dry_run=dry_run,
        )
