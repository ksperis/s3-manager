# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import requests

from app.db import HealthCheckStatus, StorageEndpoint, StorageProvider
from app.services import healthcheck_service
from app.services.healthcheck_service import EndpointCheckTarget, HealthCheckProfile, HealthCheckService, HealthWindow


def _build_target(*, verify_tls: bool, force_path_style: bool = False) -> EndpointCheckTarget:
    return EndpointCheckTarget(
        endpoint_id=1,
        name="endpoint-1",
        endpoint_url="https://endpoint.example.test",
        force_path_style=force_path_style,
        verify_tls=verify_tls,
        region="us-east-1",
        supervision_access_key="AKIA-TEST",
        supervision_secret_key="SECRET-TEST",
        admin_access_key=None,
        admin_secret_key=None,
    )


def _seed_endpoint(db_session, *, name: str, endpoint_url: str, is_default: bool) -> None:
    db_session.add(
        StorageEndpoint(
            name=name,
            endpoint_url=endpoint_url,
            provider=StorageProvider.CEPH.value,
            is_default=is_default,
            is_editable=True,
        )
    )


def test_http_healthcheck_honors_endpoint_insecure_tls(monkeypatch):
    service = HealthCheckService(db=None)
    target = _build_target(verify_tls=False)
    profile = HealthCheckProfile(mode="http", target_url="https://selfsigned.example.test")

    monkeypatch.setattr(healthcheck_service.settings, "healthcheck_verify_ssl", True)

    captured: dict[str, object] = {}

    class FakeResponse:
        status_code = 200

    def fake_get(url: str, **kwargs):
        captured["verify"] = kwargs.get("verify")
        if kwargs.get("verify"):
            raise requests.exceptions.SSLError("SSLCertVerificationError")
        return FakeResponse()

    monkeypatch.setattr(healthcheck_service.requests, "get", fake_get)

    result = service._check_endpoint(target, profile=profile, baseline_latency_ms=None)

    assert captured["verify"] is False
    assert result.status == HealthCheckStatus.UP
    assert result.error_message is None


def test_s3_healthcheck_honors_endpoint_insecure_tls(monkeypatch):
    service = HealthCheckService(db=None)
    target = _build_target(verify_tls=False)
    profile = HealthCheckProfile(mode="s3", target_url="https://selfsigned.example.test")

    monkeypatch.setattr(healthcheck_service.settings, "healthcheck_verify_ssl", True)

    captured: dict[str, object] = {}

    class FakeS3Client:
        @staticmethod
        def list_buckets():
            return {"ResponseMetadata": {"HTTPStatusCode": 200}}

    def fake_get_s3_client(**kwargs):
        captured["verify_tls"] = kwargs.get("verify_tls")
        return FakeS3Client()

    monkeypatch.setattr(healthcheck_service, "get_s3_client", fake_get_s3_client)

    result = service._check_endpoint(target, profile=profile, baseline_latency_ms=None)

    assert captured["verify_tls"] is False
    assert result.status == HealthCheckStatus.UP
    assert result.error_message is None


def test_s3_healthcheck_honors_endpoint_force_path_style(monkeypatch):
    service = HealthCheckService(db=None)
    target = _build_target(verify_tls=True, force_path_style=True)
    profile = HealthCheckProfile(mode="s3", target_url="https://path-style.example.test")

    captured: dict[str, object] = {}

    class FakeS3Client:
        @staticmethod
        def list_buckets():
            return {"ResponseMetadata": {"HTTPStatusCode": 200}}

    def fake_get_s3_client(**kwargs):
        captured["force_path_style"] = kwargs.get("force_path_style")
        return FakeS3Client()

    monkeypatch.setattr(healthcheck_service, "get_s3_client", fake_get_s3_client)

    result = service._check_endpoint(target, profile=profile, baseline_latency_ms=None)

    assert captured["force_path_style"] is True
    assert result.status == HealthCheckStatus.UP
    assert result.error_message is None


def test_healthcheck_endpoint_lists_are_sorted_by_name_case_insensitive(db_session):
    _seed_endpoint(db_session, name="Zulu", endpoint_url="https://zulu.example.test", is_default=True)
    _seed_endpoint(db_session, name="alpha", endpoint_url="https://alpha.example.test", is_default=False)
    _seed_endpoint(db_session, name="Beta", endpoint_url="https://beta.example.test", is_default=False)
    db_session.commit()

    service = HealthCheckService(db_session)
    expected = ["alpha", "Beta", "Zulu"]

    summary_names = [entry["name"] for entry in service.build_summary()["endpoints"]]
    overview_names = [entry["name"] for entry in service.build_overview(HealthWindow.WEEK)["endpoints"]]
    latency_names = [entry["name"] for entry in service.build_latency_overview(HealthWindow.DAY)["endpoints"]]
    workspace_names = [entry["name"] for entry in service.build_workspace_health_overview()["endpoints"]]

    assert summary_names == expected
    assert overview_names == expected
    assert latency_names == expected
    assert workspace_names == expected
