# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import S3Account


def _seed_account(
    db_session,
    *,
    name: str,
    rgw_account_id: str | None,
) -> S3Account:
    row = S3Account(
        name=name,
        rgw_account_id=rgw_account_id,
        rgw_access_key=f"AK-{name}",
        rgw_secret_key="SECRET",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def test_admin_accounts_default_sort_is_name_case_insensitive(client, db_session):
    _seed_account(db_session, name="Zulu", rgw_account_id="RGW-SORT-A")
    _seed_account(db_session, name="alpha", rgw_account_id="RGW-SORT-B")
    _seed_account(db_session, name="Beta", rgw_account_id="RGW-SORT-C")

    response = client.get("/api/admin/accounts")
    assert response.status_code == 200, response.text
    payload = response.json()

    assert [item["name"] for item in payload["items"]] == ["alpha", "Beta", "Zulu"]


def test_admin_accounts_sort_by_name_desc_is_case_insensitive(client, db_session):
    _seed_account(db_session, name="same", rgw_account_id="RGW-SAME-01")
    _seed_account(db_session, name="Same", rgw_account_id="RGW-SAME-02")
    _seed_account(db_session, name="alpha", rgw_account_id="RGW-SAME-03")

    response = client.get("/api/admin/accounts?sort_by=name&sort_dir=desc")
    assert response.status_code == 200, response.text
    payload = response.json()

    names = [item["name"] for item in payload["items"]]
    assert names == ["same", "Same", "alpha"]


def test_admin_accounts_non_name_sort_keeps_behavior_with_stable_id_tiebreak(client, db_session):
    case_1 = _seed_account(db_session, name="case-1", rgw_account_id="RGWCASE")
    case_2 = _seed_account(db_session, name="case-2", rgw_account_id="rgwcase")
    _seed_account(db_session, name="higher", rgw_account_id="RGWZZZ")

    response = client.get("/api/admin/accounts?sort_by=rgw_account_id&sort_dir=desc")
    assert response.status_code == 200, response.text
    payload = response.json()

    ids = [item["db_id"] for item in payload["items"]]
    names = [item["name"] for item in payload["items"]]
    assert names[0] == "higher"
    assert ids.index(case_2.id) < ids.index(case_1.id)


def test_admin_accounts_minimal_is_sorted_case_insensitive(client, db_session):
    _seed_account(db_session, name="Zulu", rgw_account_id="RGW-MIN-A")
    _seed_account(db_session, name="alpha", rgw_account_id="RGW-MIN-B")
    _seed_account(db_session, name="Beta", rgw_account_id="RGW-MIN-C")

    response = client.get("/api/admin/accounts/minimal")
    assert response.status_code == 200, response.text
    payload = response.json()

    assert [item["name"] for item in payload] == ["alpha", "Beta", "Zulu"]
