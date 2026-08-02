# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from inspect import signature

import pytest

from app.routers import browser, portal
from app.routers.manager import objects as manager_objects


@pytest.mark.parametrize(
    "endpoint",
    [
        browser.update_object_metadata,
        browser.put_object_tags,
        browser.put_object_acl,
        browser.put_object_legal_hold,
        browser.put_object_retention,
        browser.delete_objects,
        browser.copy_object,
        browser.create_folder,
        browser.upload_via_proxy,
        browser.download_object,
        browser.multipart_init,
        browser.complete_multipart_upload,
        browser.abort_multipart_upload,
        browser.restore_object,
        browser.cleanup_object_versions,
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
