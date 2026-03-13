# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime

from app.db import S3Connection


def _seed_connection(
    db_session,
    *,
    name: str,
    is_public: bool = True,
    owner_user_id: int | None = None,
    created_at: datetime | None = None,
) -> S3Connection:
    row = S3Connection(
        name=name,
        owner_user_id=owner_user_id,
        is_public=is_public,
        is_shared=False,
        is_temporary=False,
        access_manager=True,
        access_browser=True,
        access_key_id=f"AK-{name}-{owner_user_id or 0}",
        secret_access_key="SECRET",
        created_at=created_at,
        updated_at=created_at,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def test_admin_s3_connections_default_sort_is_name_case_insensitive(client, db_session):
    _seed_connection(db_session, name="Zulu")
    _seed_connection(db_session, name="alpha")
    _seed_connection(db_session, name="Beta")

    response = client.get("/api/admin/s3-connections")
    assert response.status_code == 200, response.text
    payload = response.json()

    assert [item["name"] for item in payload["items"]] == ["alpha", "Beta", "Zulu"]


def test_admin_s3_connections_sort_by_name_desc_is_stable_by_id(client, db_session):
    first_same = _seed_connection(db_session, name="same")
    second_same = _seed_connection(db_session, name="same")
    _seed_connection(db_session, name="alpha")

    response = client.get("/api/admin/s3-connections?sort_by=name&sort_dir=desc")
    assert response.status_code == 200, response.text
    payload = response.json()

    names = [item["name"] for item in payload["items"]]
    same_ids = [item["id"] for item in payload["items"] if item["name"] == "same"]
    assert names == ["same", "same", "alpha"]
    assert same_ids == sorted([first_same.id, second_same.id], reverse=True)


def test_admin_s3_connections_non_name_sort_still_applies(client, db_session):
    base_time = datetime(2026, 1, 1, 12, 0, 0)
    _seed_connection(db_session, name="alpha", created_at=base_time)
    _seed_connection(db_session, name="bravo", created_at=datetime(2026, 1, 2, 12, 0, 0))
    same_time_1 = _seed_connection(db_session, name="charlie", created_at=base_time)
    same_time_2 = _seed_connection(db_session, name="delta", created_at=base_time)

    response = client.get("/api/admin/s3-connections?sort_by=created_at&sort_dir=desc")
    assert response.status_code == 200, response.text
    payload = response.json()

    ids = [item["id"] for item in payload["items"]]
    names = [item["name"] for item in payload["items"]]
    assert names[0] == "bravo"
    assert ids.index(same_time_2.id) < ids.index(same_time_1.id)


def test_admin_s3_connections_minimal_is_sorted_case_insensitive(client, db_session):
    _seed_connection(db_session, name="Zulu")
    _seed_connection(db_session, name="alpha")
    _seed_connection(db_session, name="Beta")

    response = client.get("/api/admin/s3-connections/minimal")
    assert response.status_code == 200, response.text
    payload = response.json()

    assert [item["name"] for item in payload] == ["alpha", "Beta", "Zulu"]
