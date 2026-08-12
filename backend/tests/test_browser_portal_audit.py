# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from inspect import signature

import pytest

from app.routers import browser, browser_objects, browser_transfers, portal
from app.routers.manager import objects as manager_objects


@pytest.mark.parametrize(
    "endpoint",
    [
        browser_objects.update_object_metadata,
        browser_objects.put_object_tags,
        browser_objects.put_object_acl,
        browser_objects.put_object_legal_hold,
        browser_objects.put_object_retention,
        browser_objects.delete_objects,
        browser_objects.copy_object,
        browser_objects.create_folder,
        browser_transfers.upload_via_proxy,
        browser_transfers.download_object,
        browser_transfers.multipart_init,
        browser_transfers.complete_multipart_upload,
        browser_transfers.abort_multipart_upload,
        browser_objects.restore_object,
        browser_objects.cleanup_object_versions,
        portal.portal_restore_storage_space_object,
        portal.portal_delete_storage_space_object,
        portal.portal_download_storage_space_object,
        manager_objects.upload_object,
        manager_objects.create_folder,
        manager_objects.delete_objects,
    ],
)
def test_data_plane_endpoints_do_not_resolve_application_audit(endpoint) -> None:
    assert "audit_service" not in signature(endpoint).parameters


@pytest.mark.parametrize(
    "endpoint",
    [
        browser.create_bucket,
        portal.portal_restore_deleted_prefix_stream,
    ],
)
def test_control_plane_and_global_workflow_endpoints_keep_application_audit(endpoint) -> None:
    assert "audit_service" in signature(endpoint).parameters
