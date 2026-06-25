# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

from app.db import AccountIAMUser
from app.services.mappers.portal import (
    portal_access_key_from_active_link,
    portal_access_key_from_iam_metadata,
    portal_access_key_is_active,
)


def test_portal_access_key_from_iam_metadata_maps_public_fields():
    created_at = "2026-01-01T00:00:00Z"
    metadata = SimpleNamespace(access_key_id="AKIAUSER", status="Inactive", created_at=created_at)

    key = portal_access_key_from_iam_metadata(
        metadata,
        is_portal=False,
        deletable=True,
        secret_access_key="secret-on-create",
    )

    assert key.access_key_id == "AKIAUSER"
    assert key.status == "Inactive"
    assert key.created_at == created_at
    assert key.is_active is False
    assert key.is_portal is False
    assert key.deletable is True
    assert key.secret_access_key == "secret-on-create"


def test_portal_access_key_mapper_can_override_status_default():
    metadata = SimpleNamespace(access_key_id="AKIAUSER", status=None, created_at=None)

    key = portal_access_key_from_iam_metadata(
        metadata,
        is_portal=False,
        deletable=True,
        active_default=False,
        status="Active",
    )

    assert key.status == "Active"
    assert key.is_active is True
    assert portal_access_key_is_active(None, default=False) is False


def test_portal_access_key_from_active_link_controls_secret_visibility():
    link = AccountIAMUser(active_access_key="AKIAPORTAL", active_secret_key="portal-secret")

    hidden = portal_access_key_from_active_link(link, include_secret=False)
    visible = portal_access_key_from_active_link(link, include_secret=True)

    assert hidden.access_key_id == "AKIAPORTAL"
    assert hidden.secret_access_key is None
    assert hidden.is_portal is True
    assert hidden.deletable is False
    assert visible.secret_access_key == "portal-secret"
