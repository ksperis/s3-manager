# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from tests_ceph_functional.conftest import (
    _grant_account_access_to_user,
    _select_storage_endpoint,
)
from tests_ceph_functional.test_browser_clipboard_flow import _grant_account_root_access


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


def test_grant_account_root_access_preserves_existing_account_links() -> None:
    class StubAdminSession:
        def __init__(self) -> None:
            self.updated: tuple[str, dict, int] | None = None

        def get(self, path: str, *, params: dict) -> dict:
            assert path == "/admin/users"
            assert params == {"page": 1, "page_size": 200}
            return {
                "items": [
                    {
                        "id": 7,
                        "account_links": [
                            {
                                "account_id": 11,
                                "role": "account_administrator",
                                "allow_manager_browser_data_access": True,
                            }
                        ],
                    }
                ]
            }

        def put(self, path: str, *, json: dict, expected_status: int) -> None:
            self.updated = (path, json, expected_status)

    session = StubAdminSession()

    _grant_account_root_access(session, user_id=7, account_id=12)  # type: ignore[arg-type]

    assert session.updated == (
        "/admin/users/7",
        {
            "account_links": [
                {
                    "account_id": 11,
                    "role": "account_administrator",
                    "allow_manager_browser_data_access": True,
                },
                {
                    "account_id": 12,
                    "role": "account_administrator",
                    "allow_manager_browser_data_access": True,
                },
            ]
        },
        200,
    )

def test_grant_account_access_to_user_preserves_existing_account_links() -> None:
    class StubAdminSession:
        def __init__(self) -> None:
            self.updated: tuple[str, dict, int] | None = None

        def get(self, path: str, *, params: dict) -> dict:
            assert path == "/admin/users"
            assert params == {"page": 1, "page_size": 200}
            return {
                "items": [
                    {
                        "id": 3,
                        "account_links": [
                            {
                                "account_id": 21,
                                "role": "account_administrator",
                                "allow_manager_browser_data_access": False,
                            }
                        ],
                    }
                ]
            }

        def put(self, path: str, *, json: dict, expected_status: int) -> None:
            self.updated = (path, json, expected_status)

    session = StubAdminSession()

    _grant_account_access_to_user(  # type: ignore[arg-type]
        session,
        user_id=3,
        account_id=22,
    )

    assert session.updated == (
        "/admin/users/3",
        {
            "account_links": [
                {
                    "account_id": 21,
                    "role": "account_administrator",
                    "allow_manager_browser_data_access": False,
                },
                {
                    "account_id": 22,
                    "role": "account_administrator",
                    "allow_manager_browser_data_access": True,
                },
            ]
        },
        200,
    )
