# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi.testclient import TestClient

from app.db import AccountRole, AuditLog, PortalStorageSpaceMetadata, S3Account, User, UserRole
from app.main import app
from app.routers import dependencies
from app.routers.dependencies import AccountAccess, AccountCapabilities
from tests.s3_account_factory import make_s3_account


def _portal_access(account: S3Account, user: User, role: str) -> AccountAccess:
    is_manager = role == AccountRole.PORTAL_MANAGER.value
    return AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=role,
        capabilities=AccountCapabilities(
            can_manage_buckets=is_manager,
            can_manage_portal_users=is_manager,
        ),
    )


def _png(width: int = 1, height: int = 1) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + b"\x00\x00\x00\rIHDR"
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
    )


def _setup_space(db_session):
    account = make_s3_account(db_session, name="portal-icons", rgw_account_id="rgw-portal-icons")
    manager = User(
        email="portal-icon-manager@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    member = User(
        email="portal-icon-member@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add_all([account, manager, member])
    db_session.flush()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="research-data",
        display_name="Research data",
        visibility="shared",
        share_scope="account",
        account_member_role="Viewer",
    )
    db_session.add(metadata)
    db_session.commit()
    return account, manager, member, metadata


def test_portal_manager_can_choose_icon_and_action_is_audited(client: TestClient, db_session):
    account, manager, _member, metadata = _setup_space(db_session)
    app.dependency_overrides[dependencies.require_portal_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_portal_account_access] = lambda: _portal_access(
        account,
        manager,
        AccountRole.PORTAL_MANAGER.value,
    )

    response = client.put(
        "/api/portal/storage-spaces/research-data/icon",
        json={"source": "preset", "preset": "database"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "source": "preset",
        "preset": "database",
        "url": None,
        "updated_at": response.json()["updated_at"],
    }
    db_session.refresh(metadata)
    assert metadata.icon_source == "preset"
    assert metadata.icon_preset == "database"
    audit = db_session.query(AuditLog).filter(AuditLog.action == "update_storage_space_icon").one()
    assert audit.scope == "portal"
    assert audit.entity_id == "research-data"
    assert "database" in (audit.metadata_json or "")


def test_uploaded_icon_is_validated_served_with_versioned_private_cache_and_audited(
    client: TestClient,
    db_session,
):
    account, manager, _member, metadata = _setup_space(db_session)
    app.dependency_overrides[dependencies.require_portal_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_portal_account_access] = lambda: _portal_access(
        account,
        manager,
        AccountRole.PORTAL_MANAGER.value,
    )
    image = _png()

    uploaded = client.put(
        "/api/portal/storage-spaces/research-data/icon/image",
        files={"file": ("space.png", image, "image/png")},
    )

    assert uploaded.status_code == 200
    descriptor = uploaded.json()
    assert descriptor["source"] == "uploaded"
    assert descriptor["preset"] is None
    assert descriptor["url"].startswith(
        f"/portal/storage-spaces/research-data/icon/image?account_id={account.id}&v="
    )
    db_session.refresh(metadata)
    assert metadata.icon_image == image
    assert metadata.icon_content_type == "image/png"

    fetched = client.get(descriptor["url"].replace("/portal/", "/api/portal/"))

    assert fetched.status_code == 200
    assert fetched.content == image
    assert fetched.headers["content-type"] == "image/png"
    assert fetched.headers["cache-control"] == "private, max-age=86400"
    assert fetched.headers["etag"].startswith(
        f'"storage-space-icon-{account.id}-research-data-'
    )
    assert fetched.headers["x-content-type-options"] == "nosniff"
    assert db_session.query(AuditLog).filter(AuditLog.action == "upload_storage_space_icon").count() == 1

    disguised = client.put(
        "/api/portal/storage-spaces/research-data/icon/image",
        files={"file": ("fake.png", b"not-an-image", "image/png")},
    )
    assert disguised.status_code == 400
    assert "PNG or JPEG" in disguised.json()["detail"]

    oversized = client.put(
        "/api/portal/storage-spaces/research-data/icon/image",
        files={"file": ("large.png", b"x" * (1024 * 1024 + 1), "image/png")},
    )
    assert oversized.status_code == 400
    assert "1 MiB" in oversized.json()["detail"]


def test_portal_user_cannot_configure_icons_but_can_fetch_visible_space_icon(
    client: TestClient,
    db_session,
):
    account, _manager, member, metadata = _setup_space(db_session)
    image = _png()
    metadata.icon_source = "uploaded"
    metadata.icon_image = image
    metadata.icon_content_type = "image/png"
    db_session.add(metadata)
    db_session.commit()
    app.dependency_overrides[dependencies.require_portal_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_portal_account_access] = lambda: _portal_access(
        account,
        member,
        AccountRole.PORTAL_USER.value,
    )

    denied = client.put(
        "/api/portal/storage-spaces/research-data/icon",
        json={"source": "preset", "preset": "folder"},
    )
    fetched = client.get(
        f"/api/portal/storage-spaces/research-data/icon/image?account_id={account.id}&v=0"
    )

    assert denied.status_code == 403
    assert denied.json()["detail"] == "Manager rights required for this account"
    assert fetched.status_code == 200
    assert fetched.content == image
