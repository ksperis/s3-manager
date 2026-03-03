# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

from app.db import StorageProvider
from app.routers.ceph_admin import endpoints as endpoints_router


class _FakeQuery:
    def __init__(self, endpoints):
        self._endpoints = endpoints

    def order_by(self, *args, **kwargs):
        return self

    def all(self):
        return self._endpoints


class _FakeSession:
    def __init__(self, endpoints):
        self._endpoints = endpoints

    def query(self, model):
        return _FakeQuery(self._endpoints)


def _build_endpoint(
    endpoint_id: int,
    *,
    admin_enabled: bool = True,
    usage_enabled: bool = True,
    metrics_enabled: bool = True,
    has_supervision_credentials: bool = True,
):
    features_yaml = (
        "features:\n"
        "  admin:\n"
        f"    enabled: {'true' if admin_enabled else 'false'}\n"
        "  usage:\n"
        f"    enabled: {'true' if usage_enabled else 'false'}\n"
        "  metrics:\n"
        f"    enabled: {'true' if metrics_enabled else 'false'}\n"
    )
    return SimpleNamespace(
        id=endpoint_id,
        name=f"ceph-{endpoint_id}",
        provider=StorageProvider.CEPH.value,
        endpoint_url="https://s3.example.test",
        region="",
        is_default=False,
        features_config=features_yaml,
        supervision_access_key="METRICS-AK" if has_supervision_credentials else None,
        supervision_secret_key="METRICS-SK" if has_supervision_credentials else None,
        ceph_admin_access_key="ADMIN-AK",
        ceph_admin_secret_key="ADMIN-SK",
    )


def test_list_ceph_admin_endpoints_does_not_validate_identity(monkeypatch):
    endpoint = _build_endpoint(1)

    def _unexpected_validate(_endpoint):
        raise AssertionError("validate_ceph_admin_service_identity should not be called from list")

    monkeypatch.setattr(endpoints_router, "validate_ceph_admin_service_identity", _unexpected_validate)

    payload = endpoints_router.list_ceph_admin_endpoints(db=_FakeSession([endpoint]), _=SimpleNamespace())

    assert len(payload) == 1
    assert payload[0].id == 1


def test_list_ceph_admin_endpoints_includes_ceph_even_when_admin_feature_disabled(monkeypatch):
    endpoint = _build_endpoint(2, admin_enabled=False)

    def _unexpected_validate(_endpoint):
        raise AssertionError("validate_ceph_admin_service_identity should not be called from list")

    monkeypatch.setattr(endpoints_router, "validate_ceph_admin_service_identity", _unexpected_validate)

    payload = endpoints_router.list_ceph_admin_endpoints(db=_FakeSession([endpoint]), _=SimpleNamespace())

    assert len(payload) == 1
    assert payload[0].id == 2


def test_get_ceph_admin_endpoint_access_reports_warning_and_metrics_capability(monkeypatch):
    endpoint = _build_endpoint(11, usage_enabled=False, metrics_enabled=True, has_supervision_credentials=True)

    monkeypatch.setattr(
        endpoints_router,
        "validate_ceph_admin_service_identity",
        lambda _endpoint: "Ceph Admin workspace is unavailable for this endpoint",
    )

    payload = endpoints_router.get_ceph_admin_endpoint_access(endpoint=endpoint)

    assert payload.endpoint_id == endpoint.id
    assert payload.can_admin is False
    assert payload.can_accounts is False
    assert payload.can_metrics is True
    assert payload.admin_warning == "Ceph Admin workspace is unavailable for this endpoint"


def test_get_ceph_admin_endpoint_access_disables_metrics_without_supervision_credentials(monkeypatch):
    endpoint = _build_endpoint(12, usage_enabled=True, metrics_enabled=True, has_supervision_credentials=False)
    monkeypatch.setattr(endpoints_router, "validate_ceph_admin_service_identity", lambda _endpoint: None)
    monkeypatch.setattr(
        endpoints_router,
        "get_rgw_admin_client",
        lambda **kwargs: SimpleNamespace(get_account=lambda account_id, allow_not_found=True: None),
    )

    payload = endpoints_router.get_ceph_admin_endpoint_access(endpoint=endpoint)

    assert payload.can_admin is True
    assert payload.can_accounts is True
    assert payload.can_metrics is False
    assert payload.admin_warning is None


def test_get_ceph_admin_endpoint_access_disables_accounts_when_account_api_unavailable(monkeypatch):
    endpoint = _build_endpoint(13, usage_enabled=True, metrics_enabled=True, has_supervision_credentials=True)
    monkeypatch.setattr(endpoints_router, "validate_ceph_admin_service_identity", lambda _endpoint: None)

    class _FailingClient:
        def get_account(self, account_id, allow_not_found=True):
            raise endpoints_router.RGWAdminError("RGW admin error 403: AccessDenied")

    monkeypatch.setattr(endpoints_router, "get_rgw_admin_client", lambda **kwargs: _FailingClient())

    payload = endpoints_router.get_ceph_admin_endpoint_access(endpoint=endpoint)

    assert payload.can_admin is True
    assert payload.can_accounts is False
    assert payload.can_metrics is True
