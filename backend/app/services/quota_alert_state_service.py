# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import QuotaAlertState
from app.services.quota_subject import SubjectContext, quota_subject_ids


QUOTA_ALERT_NORMAL = "normal"
QUOTA_ALERT_THRESHOLD = "threshold"
QUOTA_ALERT_FULL = "full"

_LEVEL_ORDER = {
    QUOTA_ALERT_NORMAL: 0,
    QUOTA_ALERT_THRESHOLD: 1,
    QUOTA_ALERT_FULL: 2,
}

QuotaAlertStateKey = tuple[int, Optional[int], Optional[int]]


@dataclass(frozen=True)
class QuotaAlertTransition:
    should_alert: bool
    next_level: str
    previous_level: Optional[str]


class QuotaAlertStateService:
    """Persist quota alert levels and determine notification transitions."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def load_states(self) -> dict[QuotaAlertStateKey, QuotaAlertState]:
        rows = self.db.query(QuotaAlertState).all()
        return {
            (
                int(row.storage_endpoint_id),
                row.s3_account_id,
                row.s3_user_id,
            ): row
            for row in rows
        }

    def update(
        self,
        *,
        subject: SubjectContext,
        states: dict[QuotaAlertStateKey, QuotaAlertState],
        ratio_pct: Optional[float],
        threshold_percent: int,
        now: datetime,
    ) -> QuotaAlertTransition:
        key = self._state_key(subject)
        state = states.get(key)
        previous_level = state.last_level if state is not None else None
        next_level = self._determine_level(
            ratio_pct,
            threshold_percent,
        )

        if state is None:
            state = self._create_state(
                subject=subject,
                next_level=next_level,
                ratio_pct=ratio_pct,
                now=now,
            )
            try:
                with self.db.begin_nested():
                    self.db.add(state)
                    self.db.flush()
            except IntegrityError:
                state = self._find_state(subject)
                if state is None:
                    raise
                previous_level = state.last_level
            states[key] = state

        should_alert = self._should_alert(
            ratio_pct=ratio_pct,
            previous_level=previous_level,
            next_level=next_level,
        )
        state.last_level = next_level
        state.last_ratio_pct = ratio_pct
        state.last_checked_at = now
        state.updated_at = now

        if should_alert:
            state.last_notified_level = next_level
            state.last_notified_at = now

        return QuotaAlertTransition(
            should_alert=should_alert,
            next_level=next_level,
            previous_level=previous_level,
        )

    @staticmethod
    def _state_key(subject: SubjectContext) -> QuotaAlertStateKey:
        account_id, user_id = quota_subject_ids(subject)
        return int(subject.endpoint_id), account_id, user_id

    def _find_state(
        self,
        subject: SubjectContext,
    ) -> Optional[QuotaAlertState]:
        account_id, user_id = quota_subject_ids(subject)
        return (
            self.db.query(QuotaAlertState)
            .filter(
                QuotaAlertState.storage_endpoint_id == subject.endpoint_id,
                QuotaAlertState.s3_account_id == account_id,
                QuotaAlertState.s3_user_id == user_id,
            )
            .first()
        )

    @staticmethod
    def _create_state(
        *,
        subject: SubjectContext,
        next_level: str,
        ratio_pct: Optional[float],
        now: datetime,
    ) -> QuotaAlertState:
        account_id, user_id = quota_subject_ids(subject)
        return QuotaAlertState(
            storage_endpoint_id=subject.endpoint_id,
            s3_account_id=account_id,
            s3_user_id=user_id,
            last_level=next_level,
            last_ratio_pct=ratio_pct,
            last_checked_at=now,
            created_at=now,
            updated_at=now,
        )

    @staticmethod
    def _determine_level(
        ratio_pct: Optional[float],
        threshold_percent: int,
    ) -> str:
        if ratio_pct is None:
            return QUOTA_ALERT_NORMAL
        if ratio_pct >= 100.0:
            return QUOTA_ALERT_FULL
        if ratio_pct >= float(threshold_percent):
            return QUOTA_ALERT_THRESHOLD
        return QUOTA_ALERT_NORMAL

    @staticmethod
    def _should_alert(
        *,
        ratio_pct: Optional[float],
        previous_level: Optional[str],
        next_level: str,
    ) -> bool:
        if ratio_pct is None or next_level not in {
            QUOTA_ALERT_THRESHOLD,
            QUOTA_ALERT_FULL,
        }:
            return False
        if previous_level is None:
            return True
        return _LEVEL_ORDER[next_level] > _LEVEL_ORDER.get(
            previous_level,
            0,
        )
