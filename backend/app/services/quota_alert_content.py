# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional

from app.services.quota_alert_state_service import QUOTA_ALERT_FULL
from app.services.quota_subject import SubjectContext


@dataclass(frozen=True)
class QuotaAlertContent:
    event_key: str
    title: str
    message: str
    severity: str
    payload: dict[str, Any]


def build_quota_alert_content(
    *,
    subject: SubjectContext,
    previous_level: Optional[str],
    alert_level: str,
    ratio_pct: Optional[float],
    threshold_percent: int,
    used_bytes: int,
    used_objects: int,
    quota_size_bytes: Optional[int],
    quota_objects: Optional[int],
    checked_at: datetime,
) -> QuotaAlertContent:
    subject_label = (
        "RGW account"
        if subject.subject_type == "account"
        else "RGW user"
    )
    ratio_display = (
        f"{ratio_pct:.3f}%" if ratio_pct is not None else "n/a"
    )
    is_full = alert_level == QUOTA_ALERT_FULL
    title = "Quota reached" if is_full else "Quota near limit"
    if is_full:
        message = (
            f"{subject_label} {subject.subject_name} has reached its quota "
            f"({ratio_display})."
        )
    else:
        message = (
            f"{subject_label} {subject.subject_name} is near its quota limit "
            f"({ratio_display})."
        )
    transition_from = previous_level or "new"
    event_key = (
        f"quota:{subject.subject_type}:{subject.endpoint_id}:"
        f"{subject.subject_id}:{transition_from}:{alert_level}:"
        f"{checked_at.isoformat()}"
    )
    return QuotaAlertContent(
        event_key=event_key,
        title=title,
        message=message,
        severity="error" if is_full else "warning",
        payload={
            "alert_level": alert_level,
            "subject_type": subject.subject_type,
            "subject_label": subject_label,
            "subject_name": subject.subject_name,
            "endpoint_name": subject.endpoint_name,
            "threshold_percent": int(threshold_percent),
            "usage_ratio_pct": ratio_pct,
            "used_bytes": int(used_bytes),
            "quota_size_bytes": quota_size_bytes,
            "used_objects": int(used_objects),
            "quota_objects": quota_objects,
            "checked_at": checked_at.isoformat(),
        },
    )
