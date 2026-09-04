# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.services.browser_service import BrowserService


ORIGIN = "https://browser.example.test"


def _direct_transfer_rule(*, expose_headers=None):
    rule = {
        "AllowedOrigins": [ORIGIN],
        "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
        "AllowedHeaders": ["Content-Type", "x-amz-*"],
    }
    if expose_headers is not None:
        rule["ExposeHeaders"] = expose_headers
    return rule


class CorsClient:
    def __init__(self, rules):
        self.rules = rules
        self.put_calls = []

    def get_bucket_cors(self, **_kwargs):
        return {"CORSRules": self.rules}

    def put_bucket_cors(self, **kwargs):
        self.put_calls.append(kwargs)
        self.rules = kwargs["CORSConfiguration"]["CORSRules"]


def _service_with_client(monkeypatch, client):
    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: client)
    return service


def test_cors_status_rejects_direct_transfers_when_etag_is_not_exposed(monkeypatch):
    service = _service_with_client(
        monkeypatch,
        CorsClient([_direct_transfer_rule()]),
    )

    status = service.get_bucket_cors_status("bucket-a", object(), origin=ORIGIN)

    assert status.enabled is False
    assert status.rules[0].expose_headers == []


@pytest.mark.parametrize("exposed_header", ["ETag", "etag", "*"])
def test_cors_status_accepts_readable_multipart_etag(monkeypatch, exposed_header):
    service = _service_with_client(
        monkeypatch,
        CorsClient([_direct_transfer_rule(expose_headers=[exposed_header])]),
    )

    status = service.get_bucket_cors_status("bucket-a", object(), origin=ORIGIN)

    assert status.enabled is True


def test_ensure_cors_repairs_missing_multipart_etag_exposure(monkeypatch):
    client = CorsClient([_direct_transfer_rule()])
    service = _service_with_client(monkeypatch, client)

    status = service.ensure_bucket_cors("bucket-a", object(), ORIGIN)

    assert status.enabled is True
    assert client.put_calls
    assert "ETag" in client.rules[0]["ExposeHeaders"]
