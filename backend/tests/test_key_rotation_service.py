# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from app.db import S3Account, S3User, StorageEndpoint, StorageProvider
from app.models.key_rotation import KeyRotationRequest, KeyRotationType
from app.services.key_rotation_service import KeyRotationService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError


class FakeRgwRegistry:
    def __init__(self, *, status_supported: bool = True) -> None:
        self.identities: dict[tuple[str, Optional[str]], dict] = {}
        self.access_index: dict[str, tuple[str, Optional[str]]] = {}
        self.counter = 1
        self.status_supported = status_supported

    def add_identity(
        self,
        *,
        uid: str,
        tenant: Optional[str],
        keys: list[tuple[str, str]],
        account_id: Optional[str] = None,
        admin: bool = False,
        system: bool = False,
    ) -> None:
        key = (uid, tenant)
        payload = {
            "uid": uid,
            "tenant": tenant,
            "account_id": account_id,
            "admin": admin,
            "system": system,
            "keys": [
                {"access_key": access_key, "secret_key": secret_key, "status": "enabled"}
                for access_key, secret_key in keys
            ],
        }
        self.identities[key] = payload
        for entry in payload["keys"]:
            self.access_index[entry["access_key"]] = key

    def resolve_identity(self, uid: str, tenant: Optional[str]) -> Optional[dict]:
        if tenant is not None:
            exact = self.identities.get((uid, tenant))
            if exact:
                return exact
        exact_default = self.identities.get((uid, None))
        if exact_default:
            return exact_default
        if tenant is None:
            for (candidate_uid, _), payload in self.identities.items():
                if candidate_uid == uid:
                    return payload
        return None


class FakeRGWAdmin:
    def __init__(self, registry: FakeRgwRegistry) -> None:
        self.registry = registry

    def _extract_keys(self, data):  # noqa: ANN001
        return RGWAdminClient._extract_keys(self, data)

    def _serialize_payload(self, identity: dict) -> dict:
        return {
            "uid": identity["uid"],
            "tenant": identity["tenant"],
            "account_id": identity["account_id"],
            "admin": identity["admin"],
            "system": identity["system"],
            "keys": [dict(entry) for entry in identity["keys"]],
        }

    def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):  # noqa: ARG002
        identity_key = self.registry.access_index.get(access_key)
        if not identity_key:
            return None
        identity = self.registry.identities[identity_key]
        return self._serialize_payload(identity)

    def get_user(self, uid: str, tenant: Optional[str] = None, allow_not_found: bool = False):  # noqa: ARG002
        identity = self.registry.resolve_identity(uid, tenant)
        if not identity:
            return {"not_found": True}
        return self._serialize_payload(identity)

    def create_access_key(self, uid: str, tenant: Optional[str] = None):
        identity = self.registry.resolve_identity(uid, tenant)
        if not identity:
            raise RGWAdminError("user not found")
        index = self.registry.counter
        self.registry.counter += 1
        entry = {
            "access_key": f"NEW-{uid}-{index}",
            "secret_key": f"SEC-{uid}-{index}",
            "status": "enabled",
        }
        identity["keys"].append(dict(entry))
        identity_key = (identity["uid"], identity["tenant"])
        self.registry.access_index[entry["access_key"]] = identity_key
        return {"keys": [entry]}

    def delete_access_key(self, uid: str, access_key: str, tenant: Optional[str] = None) -> None:
        identity = self.registry.resolve_identity(uid, tenant)
        if not identity:
            raise RGWAdminError("user not found")
        previous_count = len(identity["keys"])
        identity["keys"] = [entry for entry in identity["keys"] if entry.get("access_key") != access_key]
        if len(identity["keys"]) == previous_count:
            raise RGWAdminError("key not found")
        self.registry.access_index.pop(access_key, None)

    def set_access_key_status(self, uid: str, access_key: str, enabled: bool, tenant: Optional[str] = None) -> None:
        if not self.registry.status_supported:
            raise RGWAdminError("status update not supported")
        identity = self.registry.resolve_identity(uid, tenant)
        if not identity:
            raise RGWAdminError("user not found")
        for entry in identity["keys"]:
            if entry.get("access_key") == access_key:
                entry["status"] = "enabled" if enabled else "suspended"
                return
        raise RGWAdminError("key not found")


class SupervisionRestrictedRGWAdmin(FakeRGWAdmin):
    def __init__(self, registry: FakeRgwRegistry, *, access_key: str) -> None:
        super().__init__(registry)
        self._access_key = access_key

    def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):  # noqa: ARG002
        if self._access_key.startswith("SUP-"):
            raise RGWAdminError("RGW admin error 403:")
        return super().get_user_by_access_key(access_key, allow_not_found=allow_not_found)


def _seed_endpoint(db_session, *, name: str) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider=StorageProvider.CEPH.value,
        admin_access_key="ADM-OLD",
        admin_secret_key="ADM-OLD-SEC",
        supervision_access_key="SUP-OLD",
        supervision_secret_key="SUP-OLD-SEC",
        ceph_admin_access_key="CADM-OLD",
        ceph_admin_secret_key="CADM-OLD-SEC",
        features_config="features:\n  admin:\n    enabled: true\n",
        is_default=True,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def test_rotate_keys_across_endpoint_account_and_user_deletes_old_keys(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session, name="ceph-main-1")
    account = S3Account(
        name="acc-one",
        rgw_account_id="RGW00000000000000001",
        rgw_user_uid="RGW00000000000000001-admin",
        rgw_access_key="ACC-OLD",
        rgw_secret_key="ACC-OLD-SEC",
        storage_endpoint_id=endpoint.id,
    )
    s3_user = S3User(
        name="user-one",
        rgw_user_uid="user-one",
        rgw_access_key="USR-OLD",
        rgw_secret_key="USR-OLD-SEC",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.add(s3_user)
    db_session.commit()

    registry = FakeRgwRegistry()
    registry.add_identity(uid="svc-admin", tenant=None, keys=[("ADM-OLD", "ADM-OLD-SEC")], admin=True)
    registry.add_identity(uid="svc-supervision", tenant=None, keys=[("SUP-OLD", "SUP-OLD-SEC")], admin=True)
    registry.add_identity(uid="svc-ceph-admin", tenant=None, keys=[("CADM-OLD", "CADM-OLD-SEC")], admin=True)
    registry.add_identity(
        uid="RGW00000000000000001-admin",
        tenant="RGW00000000000000001",
        keys=[("ACC-OLD", "ACC-OLD-SEC")],
        account_id="RGW00000000000000001",
    )
    registry.add_identity(uid="user-one", tenant=None, keys=[("USR-OLD", "USR-OLD-SEC")])

    def fake_client_factory(access_key: Optional[str] = None, **kwargs):  # noqa: ANN003, ARG001
        if not access_key or access_key not in registry.access_index:
            raise RGWAdminError("unknown access key")
        return FakeRGWAdmin(registry)

    monkeypatch.setattr("app.services.key_rotation_service.get_rgw_admin_client", fake_client_factory)

    service = KeyRotationService(db_session)
    result = service.rotate_keys(
        KeyRotationRequest(
            endpoint_ids=[endpoint.id],
            key_types=[
                KeyRotationType.ENDPOINT_ADMIN,
                KeyRotationType.ENDPOINT_SUPERVISION,
                KeyRotationType.ACCOUNT,
                KeyRotationType.S3_USER,
                KeyRotationType.CEPH_ADMIN,
            ],
            deactivate_only=False,
        )
    )

    db_session.refresh(endpoint)
    db_session.refresh(account)
    db_session.refresh(s3_user)

    assert result.summary.failed == 0
    assert result.summary.rotated == 5
    assert result.summary.deleted_old_keys == 5
    assert result.summary.disabled_old_keys == 0

    assert endpoint.admin_access_key != "ADM-OLD"
    assert endpoint.supervision_access_key != "SUP-OLD"
    assert endpoint.ceph_admin_access_key != "CADM-OLD"
    assert account.rgw_access_key != "ACC-OLD"
    assert s3_user.rgw_access_key != "USR-OLD"

    assert "ADM-OLD" not in registry.access_index
    assert "SUP-OLD" not in registry.access_index
    assert "CADM-OLD" not in registry.access_index
    assert "ACC-OLD" not in registry.access_index
    assert "USR-OLD" not in registry.access_index


def test_rotate_keys_can_deactivate_old_keys_instead_of_deleting(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session, name="ceph-main-2")
    s3_user = S3User(
        name="user-two",
        rgw_user_uid="user-two",
        rgw_access_key="USR2-OLD",
        rgw_secret_key="USR2-OLD-SEC",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(s3_user)
    db_session.commit()

    registry = FakeRgwRegistry(status_supported=True)
    registry.add_identity(uid="svc-admin", tenant=None, keys=[("ADM-OLD", "ADM-OLD-SEC")], admin=True)
    registry.add_identity(uid="user-two", tenant=None, keys=[("USR2-OLD", "USR2-OLD-SEC")])

    def fake_client_factory(access_key: Optional[str] = None, **kwargs):  # noqa: ANN003, ARG001
        if not access_key or access_key not in registry.access_index:
            raise RGWAdminError("unknown access key")
        return FakeRGWAdmin(registry)

    monkeypatch.setattr("app.services.key_rotation_service.get_rgw_admin_client", fake_client_factory)

    service = KeyRotationService(db_session)
    result = service.rotate_keys(
        KeyRotationRequest(
            endpoint_ids=[endpoint.id],
            key_types=[KeyRotationType.S3_USER],
            deactivate_only=True,
        )
    )

    db_session.refresh(s3_user)
    assert result.summary.failed == 0
    assert result.summary.rotated == 1
    assert result.summary.deleted_old_keys == 0
    assert result.summary.disabled_old_keys == 1
    assert s3_user.rgw_access_key != "USR2-OLD"

    identity = registry.resolve_identity("user-two", None)
    assert identity is not None
    old_entry = next((entry for entry in identity["keys"] if entry["access_key"] == "USR2-OLD"), None)
    assert old_entry is not None
    assert old_entry.get("status") == "suspended"


def test_rotate_keys_reports_error_for_non_ceph_endpoint(db_session):
    endpoint = StorageEndpoint(
        name="other-main",
        endpoint_url="https://other-main.example.test",
        provider=StorageProvider.OTHER.value,
        features_config="features:\n  admin:\n    enabled: false\n",
        is_default=True,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)

    service = KeyRotationService(db_session)
    result = service.rotate_keys(
        KeyRotationRequest(
            endpoint_ids=[endpoint.id],
            key_types=[KeyRotationType.ACCOUNT],
            deactivate_only=False,
        )
    )

    assert result.summary.total == 1
    assert result.summary.failed == 1
    assert result.results[0].status == "failed"
    assert "only supported for Ceph" in (result.results[0].message or "")


def test_rotate_supervision_uses_admin_ops_identity(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session, name="ceph-main-supervision-via-admin")
    registry = FakeRgwRegistry()
    registry.add_identity(uid="svc-admin", tenant=None, keys=[("ADM-OLD", "ADM-OLD-SEC")], admin=True)
    registry.add_identity(uid="svc-supervision", tenant=None, keys=[("SUP-OLD", "SUP-OLD-SEC")], admin=False)

    def fake_client_factory(access_key: Optional[str] = None, **kwargs):  # noqa: ANN003, ARG001
        if not access_key or access_key not in registry.access_index:
            raise RGWAdminError("unknown access key")
        return SupervisionRestrictedRGWAdmin(registry, access_key=access_key)

    monkeypatch.setattr("app.services.key_rotation_service.get_rgw_admin_client", fake_client_factory)

    service = KeyRotationService(db_session)
    result = service.rotate_keys(
        KeyRotationRequest(
            endpoint_ids=[endpoint.id],
            key_types=[KeyRotationType.ENDPOINT_SUPERVISION],
            deactivate_only=False,
        )
    )

    db_session.refresh(endpoint)
    assert result.summary.failed == 0
    assert result.summary.rotated == 1
    assert endpoint.supervision_access_key != "SUP-OLD"


def test_rotate_supervision_skips_without_admin_ops_key(db_session):
    endpoint = StorageEndpoint(
        name="ceph-main-no-admin-ops",
        endpoint_url="https://ceph-main-no-admin-ops.example.test",
        provider=StorageProvider.CEPH.value,
        admin_access_key=None,
        admin_secret_key=None,
        supervision_access_key="SUP-OLD",
        supervision_secret_key="SUP-OLD-SEC",
        features_config="features:\n  admin:\n    enabled: true\n",
        is_default=True,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)

    service = KeyRotationService(db_session)
    result = service.rotate_keys(
        KeyRotationRequest(
            endpoint_ids=[endpoint.id],
            key_types=[KeyRotationType.ENDPOINT_SUPERVISION],
            deactivate_only=False,
        )
    )

    assert result.summary.total == 1
    assert result.summary.failed == 0
    assert result.summary.skipped == 1
    assert result.results[0].status == "skipped"
    assert "Admin Ops credentials are missing" in (result.results[0].message or "")
