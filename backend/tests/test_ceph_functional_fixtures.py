# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from tests_ceph_functional.conftest import _select_storage_endpoint


def test_select_storage_endpoint_prefers_configured_name() -> None:
    endpoints = [
        {"id": 1, "name": "default", "is_default": True},
        {"id": 2, "name": "Lab Ceph", "is_default": False},
    ]

    selected = _select_storage_endpoint(endpoints, preferred_name=" lab ceph ")

    assert selected == endpoints[1]


def test_select_storage_endpoint_falls_back_to_default() -> None:
    endpoints = [
        {"id": 1, "name": "secondary", "is_default": False},
        {"id": 2, "name": "default", "is_default": True},
    ]

    selected = _select_storage_endpoint(endpoints, preferred_name=None)

    assert selected == endpoints[1]
