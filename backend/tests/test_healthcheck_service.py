# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import requests

from app.db import HealthCheckStatus
from app.services import healthcheck_service
from app.services.healthcheck_service import EndpointCheckTarget, HealthCheckProfile, HealthCheckService


def _build_target(*, verify_tls: bool) -> EndpointCheckTarget:
    return EndpointCheckTarget(
        endpoint_id=1,
        name="endpoint-1",
        endpoint_url="https://endpoint.example.test",
        verify_tls=verify_tls,
        region="us-east-1",
        supervision_access_key="AKIA-TEST",
        supervision_secret_key="SECRET-TEST",
        admin_access_key=None,
        admin_secret_key=None,
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
