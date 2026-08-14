# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from dataclasses import dataclass
from typing import Literal, Optional


@dataclass
class SubjectContext:
    subject_type: Literal["account", "s3_user"]
    subject_id: int
    endpoint_id: int
    endpoint_name: str
    subject_name: str
    subject_identifier: str
    usage_uid: Optional[str]
    quota_account_id: Optional[str]
    quota_user_uid: Optional[str]
    contact_email: Optional[str]


def quota_subject_ids(
    subject: SubjectContext,
) -> tuple[Optional[int], Optional[int]]:
    if subject.subject_type == "account":
        return subject.subject_id, None
    if subject.subject_type == "s3_user":
        return None, subject.subject_id
    raise ValueError(
        f"Unsupported quota subject type: {subject.subject_type}"
    )
