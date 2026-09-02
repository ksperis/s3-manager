# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime, timezone

import pytest

from app.services.rgw_user_key_parser import RgwUserKeyParser


def test_select_credentials_prefers_complete_non_excluded_key():
    entries = [
        {"access_key": " OLD ", "secret_key": " OLD-SECRET "},
        {"access_key": "NEW-WITHOUT-SECRET"},
        {"access-key": " NEW ", "secret-key": " NEW-SECRET "},
    ]

    assert RgwUserKeyParser.select_credentials(entries) == (
        "OLD",
        "OLD-SECRET",
    )
    assert RgwUserKeyParser.select_credentials(
        entries,
        exclude_access_key="OLD",
    ) == ("NEW", "NEW-SECRET")
    assert RgwUserKeyParser.select_credentials([]) == (None, None)


def test_access_key_ids_normalizes_supported_field_names():
    assert RgwUserKeyParser.access_key_ids(
        [
            {"access_key": " FIRST "},
            {"access-key": "SECOND"},
            {"access_key": ""},
        ]
    ) == {"FIRST", "SECOND"}


def test_select_complete_credentials_skips_partial_entries():
    assert RgwUserKeyParser.select_complete_credentials(
        [
            {"access_key": "PARTIAL"},
            {"access-key": " COMPLETE ", "secret-key": " SECRET "},
        ]
    ) == ("COMPLETE", "SECRET")
    assert RgwUserKeyParser.select_complete_credentials([]) == (None, None)


def test_to_access_keys_maps_status_dates_and_ui_managed_key():
    keys = RgwUserKeyParser.to_access_keys(
        [
            {
                "access_key": "UI-KEY",
                "active": "false",
                "create_time": "2026-03-12 10:00:00+00:00",
            },
            {
                "access-key": "OTHER-KEY",
                "status": "suspended",
                "timestamp": "1773313200",
            },
            {"status": "enabled"},
        ],
        ui_managed_access_key="UI-KEY",
    )

    assert [key.access_key_id for key in keys] == ["UI-KEY", "OTHER-KEY"]
    assert keys[0].status == "disabled"
    assert keys[0].is_active is False
    assert keys[0].is_ui_managed is True
    assert keys[0].created_at == datetime(2026, 3, 12, 10, 0, tzinfo=timezone.utc)
    assert keys[1].is_active is False
    assert keys[1].is_ui_managed is False
    assert keys[1].created_at == datetime.fromtimestamp(1773313200, tz=timezone.utc)


def test_to_generated_key_selects_new_complete_entry():
    generated = RgwUserKeyParser.to_generated_key(
        [
            {"access_key": "EXISTING", "secret_key": "OLD-SECRET"},
            {
                "access-key": "NEW",
                "secret-key": "NEW-SECRET",
                "created_at": "2026-03-12T14:30:00Z",
            },
        ],
        existing_access_keys={"EXISTING"},
    )

    assert generated.access_key_id == "NEW"
    assert generated.secret_access_key == "NEW-SECRET"
    assert generated.created_at == datetime(2026, 3, 12, 14, 30, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    ("entries", "message"),
    [
        ([], "RGW did not return access credentials"),
        ([{"access_key": "PARTIAL"}], "RGW did not return full access credentials"),
    ],
)
def test_to_generated_key_rejects_incomplete_payloads(entries, message):
    with pytest.raises(ValueError, match=message):
        RgwUserKeyParser.to_generated_key(
            entries,
            existing_access_keys=set(),
        )
