# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import UTC, datetime, timedelta

from app.db import QuotaAlertState
from app.services.quota_alert_state_service import (
    QUOTA_ALERT_FULL,
    QUOTA_ALERT_NORMAL,
    QUOTA_ALERT_THRESHOLD,
    QuotaAlertStateService,
)
from app.services.quota_subject import SubjectContext


def _subject() -> SubjectContext:
    return SubjectContext(
        subject_type="account",
        subject_id=42,
        endpoint_id=7,
        endpoint_name="ceph",
        subject_name="account",
        subject_identifier="account",
        usage_uid="account",
        quota_account_id="account",
        quota_user_uid=None,
        contact_email=None,
    )


def test_quota_alert_state_tracks_escalation_reset_and_reentry(db_session):
    service = QuotaAlertStateService(db_session)
    states = service.load_states()
    subject = _subject()
    now = datetime(2026, 8, 14, 12, 0, tzinfo=UTC)

    first = service.update(
        subject=subject,
        states=states,
        ratio_pct=90.0,
        threshold_percent=85,
        now=now,
    )
    repeated = service.update(
        subject=subject,
        states=states,
        ratio_pct=90.0,
        threshold_percent=85,
        now=now + timedelta(minutes=1),
    )
    full = service.update(
        subject=subject,
        states=states,
        ratio_pct=100.0,
        threshold_percent=85,
        now=now + timedelta(minutes=2),
    )
    reset = service.update(
        subject=subject,
        states=states,
        ratio_pct=40.0,
        threshold_percent=85,
        now=now + timedelta(minutes=3),
    )
    reentry = service.update(
        subject=subject,
        states=states,
        ratio_pct=90.0,
        threshold_percent=85,
        now=now + timedelta(minutes=4),
    )
    db_session.commit()

    assert first.should_alert is True
    assert first.next_level == QUOTA_ALERT_THRESHOLD
    assert first.previous_level is None
    assert repeated.should_alert is False
    assert repeated.previous_level == QUOTA_ALERT_THRESHOLD
    assert full.should_alert is True
    assert full.next_level == QUOTA_ALERT_FULL
    assert reset.should_alert is False
    assert reset.next_level == QUOTA_ALERT_NORMAL
    assert reentry.should_alert is True
    assert reentry.previous_level == QUOTA_ALERT_NORMAL

    state = db_session.query(QuotaAlertState).one()
    assert state.s3_account_id == subject.subject_id
    assert state.s3_user_id is None
    assert state.last_level == QUOTA_ALERT_THRESHOLD
    assert state.last_notified_level == QUOTA_ALERT_THRESHOLD
    assert state.last_notified_at == now + timedelta(minutes=4)
