# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from .portal._shared import *
from .portal.access_keys import PortalAccessKeysMixin
from .portal.activity import PortalActivityMixin
from .portal.buckets_users import PortalBucketsUsersMixin
from .portal.iam import PortalIamMixin
from .portal.objects import PortalObjectsMixin
from .portal.settings import PortalSettingsMixin
from .portal.sharing import PortalSharingMixin
from .portal.state_usage import PortalStateUsageMixin
from .portal.storage_spaces import PortalStorageSpacesMixin


class PortalService(
    PortalSettingsMixin,
    PortalIamMixin,
    PortalStorageSpacesMixin,
    PortalObjectsMixin,
    PortalSharingMixin,
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
        self._bucket_access_sid = "PortalUserBuckets"
        self._storage_space_share_sid_prefix = "PortalStorageSpace"
        self._storage_space_private_sid = "PortalStorageSpacePrivate"
        self._storage_space_archived_sid = "PortalStorageSpaceArchived"
        self._bucket_access_default_actions = PortalSettings().bucket_access_policy.actions



def get_portal_service(db: Session) -> PortalService:
    return PortalService(db)
