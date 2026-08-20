# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from .portal.access_keys import PortalAccessKeysMixin
from .portal.account_runtime import PortalAccountRuntimeMixin
from .portal.activity import PortalActivityMixin
from .portal.buckets_users import PortalBucketsUsersMixin
from .portal.iam import PortalIamMixin
from .portal.iam_policy_documents import PortalIamPolicyDocumentsMixin
from .portal.objects import PortalObjectsMixin
from .portal.public_links import PortalPublicLinksMixin
from .portal.server_access_logging import PortalServerAccessLoggingMixin
from .portal.settings import PortalSettingsMixin
from .portal.sharing import PortalSharingMixin
from .portal.space_settings import PortalStorageSpaceSettingsMixin
from .portal.state_usage import PortalStateUsageMixin
from .portal.storage_space_access import PortalStorageSpaceAccessMixin
from .portal.storage_space_bucket_policies import PortalStorageSpaceBucketPoliciesMixin
from .portal.storage_spaces import PortalStorageSpacesMixin
from .portal.trash_restore import PortalDeletedPrefixRestoreMixin
from .portal.version_cleanup import PortalStorageSpaceVersionCleanupMixin


class PortalService(
    PortalSettingsMixin,
    PortalAccountRuntimeMixin,
    PortalIamPolicyDocumentsMixin,
    PortalStorageSpaceBucketPoliciesMixin,
    PortalStorageSpaceAccessMixin,
    PortalIamMixin,
    PortalServerAccessLoggingMixin,
    PortalStorageSpaceVersionCleanupMixin,
    PortalStorageSpaceSettingsMixin,
    PortalDeletedPrefixRestoreMixin,
    PortalStorageSpacesMixin,
    PortalObjectsMixin,
    PortalSharingMixin,
    PortalPublicLinksMixin,
    PortalActivityMixin,
    PortalStateUsageMixin,
    PortalAccessKeysMixin,
    PortalBucketsUsersMixin,
):
    def __init__(self, db: Session) -> None:
        self.db = db
        self._inline_policy_name = "portal-self-service"
        self._manager_group_policy_name = "portal-manager"
        self._manager_group_name = "portal-manager"
        self._user_group_name = "portal-user"
        self._bucket_access_policy_name = "portal-user-buckets"
        self._external_access_policy_name = "portal-external-storage-space"
        self._bucket_access_sid = "PortalUserBuckets"
        self._storage_space_share_sid_prefix = "PortalStorageSpace"
        self._storage_space_access_sid = "PortalStorageSpaceAccess"
        self._storage_space_private_sid = "PortalStorageSpacePrivate"
        self._storage_space_archived_sid = "PortalStorageSpaceArchived"



def get_portal_service(db: Session) -> PortalService:
    return PortalService(db)
