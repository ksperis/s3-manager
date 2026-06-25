# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import copy
import json
import logging
import os
import re
import secrets
import sys
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Tuple, TYPE_CHECKING

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import (
    AuditLog,
    AccountIAMUser,
    AccountRole,
    PortalPublicLink as DBPortalPublicLink,
    PortalStorageSpaceMetadata,
    S3Account,
    StorageEndpoint,
    User,
    UserRole,
    UserS3Account,
    is_admin_ui_role,
)
from app.models.app_settings import (
    PortalBucketDefaults,
    PortalBucketDefaultsOverride,
    PortalBucketDefaultsOverridePolicy,
    PortalIAMPolicyOverride,
    PortalIAMPolicySettings,
    PortalSettings,
    PortalSettingsOverride,
    PortalSettingsOverridePolicy,
)
from app.models.bucket import Bucket
from app.models.iam import AccessKey as ModelAccessKey, IAMUser
from app.models.portal import (
    PortalAccessKey,
    PortalAccessKeysState,
    PortalAccountSettings,
    PortalActivityItem,
    PortalAlert,
    PortalIAMUser,
    PortalIamComplianceIssue,
    PortalIamComplianceReport,
    PortalPublicLink,
    PortalState,
    PortalTransfer,
    PortalStorageObjectDetail,
    PortalStorageSpace,
    PortalStorageSpaceNamingMode,
    PortalStorageSpaceRole,
    PortalStorageSpaceShare,
    PortalStorageSpaceSummary,
    PortalStorageSpaceVisibility,
    PortalUsage,
    PortalUsageStorageSpace,
)
from app.services.app_settings_service import load_app_settings as _load_app_settings
from app.services import s3_client
from app.services.s3_client import get_s3_client as _get_s3_client
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.services.rgw_iam import RGWIAMService, get_iam_service
from app.utils.rgw import extract_bucket_list, get_supervision_rgw_client, resolve_admin_uid
from app.utils.storage_endpoint_features import resolve_feature_flags, resolve_admin_endpoint
from app.utils.s3_endpoint import resolve_s3_client_options as _resolve_s3_client_options, resolve_s3_endpoint
from app.utils.normalize import normalize_string_list
from app.utils.quota_stats import extract_quota_limits
from app.utils.usage_stats import extract_usage_stats
from app.utils.time import utcnow

if TYPE_CHECKING:
    from app.routers.dependencies import AccountAccess

logger = logging.getLogger(__name__)
settings = get_settings()


def _facade_override(name: str):
    facade = sys.modules.get("app.services.portal_service")
    if facade is None:
        return None
    override = getattr(facade, name, None)
    current = globals().get(name)
    if callable(override) and override is not current:
        return override
    return None


def load_app_settings():
    override = _facade_override("load_app_settings")
    if override is not None:
        return override()
    return _load_app_settings()


def get_s3_client(*args, **kwargs):
    override = _facade_override("get_s3_client")
    if override is not None:
        return override(*args, **kwargs)
    return _get_s3_client(*args, **kwargs)


def resolve_s3_client_options(*args, **kwargs):
    override = _facade_override("resolve_s3_client_options")
    if override is not None:
        return override(*args, **kwargs)
    return _resolve_s3_client_options(*args, **kwargs)


def _parse_positive_limit(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        parsed = int(value)
    elif isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        try:
            parsed = int(float(normalized))
        except ValueError:
            return None
    else:
        return None
    return parsed if parsed > 0 else None


def _extract_account_limit(payload: Any, key: str) -> Optional[int]:
    if not isinstance(payload, dict):
        return None
    limits_payload = payload.get("limits") if isinstance(payload.get("limits"), dict) else {}
    return _parse_positive_limit(payload.get(key) or limits_payload.get(key))


class PortalAccessKeyLimitExceeded(RuntimeError):
    """Raised when a portal user reaches the configured IAM user key limit."""


class PortalAccessKeyManagementDisabled(RuntimeError):
    """Raised when portal access-key mutations are disabled by settings."""


class PortalAccessKeyProtected(RuntimeError):
    """Raised when a request targets the active portal credential."""


__all__ = [name for name in globals() if not name.startswith("__")]
