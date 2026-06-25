# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from .browser._shared import *
from .browser.buckets import BrowserBucketsMixin
from .browser.context import BrowserContextMixin
from .browser.listing import BrowserListingMixin
from .browser.object_details import BrowserObjectDetailsMixin
from .browser.object_operations import BrowserObjectOperationsMixin
from .browser.transfers import BrowserTransfersMixin
from .browser.versions import BrowserVersionsMixin


class BrowserService(
    BrowserContextMixin,
    BrowserTransfersMixin,
    BrowserBucketsMixin,
    BrowserListingMixin,
    BrowserVersionsMixin,
    BrowserObjectDetailsMixin,
    BrowserObjectOperationsMixin,
):
    pass


def get_browser_service() -> BrowserService:
    return BrowserService()
