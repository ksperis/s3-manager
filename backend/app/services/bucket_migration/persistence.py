# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


class BucketMigrationPersistenceMixin:
    def _commit(self) -> None:
        self.db.commit()

    def _json_dumps_safe(self, value: Any) -> Optional[str]:
        if value is None:
            return None
        return _json_dumps(value)

    def _is_context_authorized(self, context_id: str) -> bool:
        if self._authorized_context_ids is None:
            return True
        return str(context_id or "").strip() in self._authorized_context_ids

    def _assert_context_authorized_for_mutation(self, context_id: str) -> None:
        if self._is_context_authorized(context_id):
            return
        raise PermissionError("Not authorized for this context")

    def _is_account_context_id(self, context_id: str) -> bool:
        return str(context_id or "").strip().isdigit()

    def _assert_cross_account_admin_contexts(self, source_context_id: str, target_context_id: str) -> None:
        if self._admin_account_context_ids is None:
            return

        source_value = str(source_context_id or "").strip()
        target_value = str(target_context_id or "").strip()
        if source_value == target_value:
            return
        if not self._is_account_context_id(source_value) or not self._is_account_context_id(target_value):
            return
        if source_value in self._admin_account_context_ids and target_value in self._admin_account_context_ids:
            return
        raise PermissionError(
            "Cross-account migrations require admin access on both source and target account contexts"
        )

    def _validate_configured_webhook_url(self, webhook_url: str) -> None:
        try:
            _validate_webhook_target_url(webhook_url)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
