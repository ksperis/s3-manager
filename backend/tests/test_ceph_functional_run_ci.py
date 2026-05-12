# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

from tests_ceph_functional import run_ci


def test_ci_endpoint_payload_enables_replication(monkeypatch):
    monkeypatch.setenv("CEPH_TEST_LAB_S3_ENDPOINT", "https://s3.example.test")
    monkeypatch.setenv("CEPH_TEST_RGW_ADMIN_ENDPOINT", "https://admin.example.test")
    monkeypatch.setenv("CEPH_TEST_RGW_ADMIN_ACCESS_KEY", "admin-ak")
    monkeypatch.setenv("CEPH_TEST_RGW_ADMIN_SECRET_KEY", "admin-sk")
    monkeypatch.setenv("CEPH_TEST_SUPERVISION_ACCESS_KEY", "supervision-ak")
    monkeypatch.setenv("CEPH_TEST_SUPERVISION_SECRET_KEY", "supervision-sk")
    monkeypatch.setenv("CEPH_TEST_CEPH_ADMIN_ACCESS_KEY", "ceph-admin-ak")
    monkeypatch.setenv("CEPH_TEST_CEPH_ADMIN_SECRET_KEY", "ceph-admin-sk")

    payload = json.loads(run_ci._build_endpoint_payload())

    assert payload[0]["features"]["replication"] == {"enabled": True}
