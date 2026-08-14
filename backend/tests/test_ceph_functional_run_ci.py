# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

from tests_ceph_functional import run_ci


def _seed_required_endpoint_env(monkeypatch):
    monkeypatch.setenv("CEPH_TEST_LAB_S3_ENDPOINT", "https://s3.example.test")
    monkeypatch.setenv("CEPH_TEST_RGW_ADMIN_ENDPOINT", "https://admin.example.test")
    monkeypatch.setenv("CEPH_TEST_RGW_ADMIN_ACCESS_KEY", "admin-ak")
    monkeypatch.setenv("CEPH_TEST_RGW_ADMIN_SECRET_KEY", "admin-sk")
    monkeypatch.setenv("CEPH_TEST_SUPERVISION_ACCESS_KEY", "supervision-ak")
    monkeypatch.setenv("CEPH_TEST_SUPERVISION_SECRET_KEY", "supervision-sk")
    monkeypatch.setenv("CEPH_TEST_CEPH_ADMIN_ACCESS_KEY", "ceph-admin-ak")
    monkeypatch.setenv("CEPH_TEST_CEPH_ADMIN_SECRET_KEY", "ceph-admin-sk")


def test_ci_endpoint_payload_enables_replication(monkeypatch):
    _seed_required_endpoint_env(monkeypatch)
    monkeypatch.delenv("CEPH_TEST_LAB_S3_ENDPOINT_Z2", raising=False)

    payload = json.loads(run_ci._build_endpoint_payload())

    assert len(payload) == 1
    assert payload[0]["name"] == "Lab Ceph"
    assert payload[0]["endpoint_url"] == "https://s3.example.test"
    assert payload[0]["is_default"] is True
    assert payload[0]["features"]["replication"] == {"enabled": True}


def test_ci_app_settings_payload_enables_portal_features():
    payload = json.loads(run_ci._build_app_settings_payload())

    assert payload["general"]["portal_enabled"] is True
    assert payload["general"]["browser_portal_enabled"] is True


def test_ci_endpoint_payload_can_seed_two_lab_zones(monkeypatch):
    _seed_required_endpoint_env(monkeypatch)
    monkeypatch.setenv("CEPH_TEST_LAB_S3_ENDPOINT_Z2", "https://s3-z2.example.test")

    payload = json.loads(run_ci._build_endpoint_payload())

    assert [item["name"] for item in payload] == ["s3-z1", "s3-z2"]
    assert [item["endpoint_url"] for item in payload] == [
        "https://s3.example.test",
        "https://s3-z2.example.test",
    ]
    assert [item["is_default"] for item in payload] == [True, False]
    assert [item["features"]["sts"]["endpoint"] for item in payload] == [
        "https://s3.example.test",
        "https://s3-z2.example.test",
    ]
    assert payload[0]["admin_access_key"] == payload[1]["admin_access_key"] == "admin-ak"
    assert payload[0]["ceph_admin_secret_key"] == payload[1]["ceph_admin_secret_key"] == "ceph-admin-sk"


def test_ci_endpoint_payload_can_use_env_storage_endpoints():
    storage_endpoints = [
        {
            "name": "s3-z1",
            "endpoint_url": "https://s3-z1.example.test",
            "provider": "ceph",
            "region": "us-east-1",
            "verify_tls": True,
            "features": {
                "admin": {"enabled": True, "endpoint": "https://admin-z1.example.test"},
                "account": {"enabled": True, "endpoint": "https://admin-z1.example.test"},
                "sns": {"enabled": True},
            },
            "admin_access_key": "admin-ak",
            "admin_secret_key": "admin-sk",
            "supervision_access_key": "supervision-ak",
            "supervision_secret_key": "supervision-sk",
            "ceph_admin_access_key": "ceph-admin-ak",
            "ceph_admin_secret_key": "ceph-admin-sk",
            "is_default": True,
        }
    ]
    env = {"ENV_STORAGE_ENDPOINTS": json.dumps(storage_endpoints)}

    assert json.loads(run_ci._build_endpoint_payload(env)) == storage_endpoints

    run_ci._derive_ceph_test_env_from_storage_endpoints(env)

    assert env["CEPH_TEST_LAB_S3_ENDPOINT"] == "https://s3-z1.example.test"
    assert env["CEPH_TEST_RGW_ADMIN_ENDPOINT"] == "https://admin-z1.example.test"
    assert env["CEPH_TEST_RGW_ADMIN_ACCESS_KEY"] == "admin-ak"
    assert env["CEPH_TEST_SUPERVISION_SECRET_KEY"] == "supervision-sk"
    assert env["CEPH_TEST_CEPH_ADMIN_ACCESS_KEY"] == "ceph-admin-ak"
    assert env["CEPH_TEST_RGW_VERIFY_TLS"] == "true"


def test_prepare_environment_generates_keyring_settings(monkeypatch, tmp_path):
    _seed_required_endpoint_env(monkeypatch)
    monkeypatch.setenv("CI", "true")
    monkeypatch.delenv("JWT_KEYS", raising=False)
    monkeypatch.delenv("CREDENTIAL_KEYS", raising=False)

    env = run_ci._prepare_environment(tmp_path, "http://127.0.0.1:8765")

    assert len(json.loads(env["JWT_KEYS"])) == 1
    assert len(json.loads(env["CREDENTIAL_KEYS"])) == 1
    assert env["PUBLIC_ORIGIN"] == "http://127.0.0.1:8765"
    assert json.loads(env["CORS_ORIGINS"]) == ["http://127.0.0.1:8765"]
    assert env["CEPH_TEST_REQUEST_ORIGIN"] == "http://127.0.0.1:8765"
