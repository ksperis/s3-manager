# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import UTC, datetime

from app.services.quota_alert_content import build_quota_alert_content
from app.services.quota_alert_state_service import QUOTA_ALERT_FULL
from app.services.quota_subject import SubjectContext


def test_build_quota_alert_content_keeps_notification_contract():
    checked_at = datetime(2026, 8, 14, 16, 30, tzinfo=UTC)
    subject = SubjectContext(
        subject_type="account",
        subject_id=42,
        endpoint_id=7,
        endpoint_name="ceph",
        subject_name="research",
        subject_identifier="RGW-RESEARCH",
        usage_uid="research-root",
        quota_account_id="RGW-RESEARCH",
        quota_user_uid=None,
        contact_email="owner@example.test",
    )

    content = build_quota_alert_content(
        subject=subject,
        previous_level="threshold",
        alert_level=QUOTA_ALERT_FULL,
        ratio_pct=100.0,
        threshold_percent=85,
        used_bytes=100,
        used_objects=10,
        quota_size_bytes=100,
        quota_objects=10,
        checked_at=checked_at,
    )

    assert content.event_key == (
        "quota:account:7:42:threshold:full:"
        "2026-08-14T16:30:00+00:00"
    )
    assert content.title == "Quota reached"
    assert content.message == (
        "RGW account research has reached its quota (100.000%)."
    )
    assert content.severity == "error"
    assert content.payload == {
        "alert_level": "full",
        "subject_type": "account",
        "subject_label": "RGW account",
        "subject_name": "research",
        "endpoint_name": "ceph",
        "threshold_percent": 85,
        "usage_ratio_pct": 100.0,
        "used_bytes": 100,
        "quota_size_bytes": 100,
        "used_objects": 10,
        "quota_objects": 10,
        "checked_at": "2026-08-14T16:30:00+00:00",
    }
