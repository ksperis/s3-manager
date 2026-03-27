# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime

from app.db import S3User
from app.services.tags_service import TagsService


def _seed_s3_user(
    db_session,
    *,
    name: str,
    uid: str,
    created_at: datetime | None = None,
) -> S3User:
    row = S3User(
        name=name,
        rgw_user_uid=uid,
        email=f"{uid}@example.test",
        rgw_access_key=f"AK-{uid}",
        rgw_secret_key="SECRET",
        created_at=created_at,
        updated_at=created_at,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def test_admin_s3_users_default_sort_is_name_case_insensitive(client, db_session):
    _seed_s3_user(db_session, name="Zulu", uid="uid-zulu")
    _seed_s3_user(db_session, name="alpha", uid="uid-alpha")
    _seed_s3_user(db_session, name="Beta", uid="uid-beta")

    response = client.get("/api/admin/s3-users")
    assert response.status_code == 200, response.text
    payload = response.json()

    assert [item["name"] for item in payload["items"]] == ["alpha", "Beta", "Zulu"]


def test_admin_s3_users_sort_by_name_desc_is_stable_by_id(client, db_session):
    first_same = _seed_s3_user(db_session, name="same", uid="uid-same-1")
    second_same = _seed_s3_user(db_session, name="same", uid="uid-same-2")
    _seed_s3_user(db_session, name="alpha", uid="uid-alpha-2")

    response = client.get("/api/admin/s3-users?sort_by=name&sort_dir=desc")
    assert response.status_code == 200, response.text
    payload = response.json()

    names = [item["name"] for item in payload["items"]]
    same_ids = [item["id"] for item in payload["items"] if item["name"] == "same"]
    assert names == ["same", "same", "alpha"]
    assert same_ids == sorted([first_same.id, second_same.id], reverse=True)


def test_admin_s3_users_non_name_sort_still_applies(client, db_session):
    base_time = datetime(2026, 1, 1, 12, 0, 0)
    _seed_s3_user(db_session, name="alpha", uid="uid-time-alpha", created_at=base_time)
    _seed_s3_user(db_session, name="bravo", uid="uid-time-bravo", created_at=datetime(2026, 1, 2, 12, 0, 0))
    same_time_1 = _seed_s3_user(db_session, name="charlie", uid="uid-time-charlie", created_at=base_time)
    same_time_2 = _seed_s3_user(db_session, name="delta", uid="uid-time-delta", created_at=base_time)

    response = client.get("/api/admin/s3-users?sort_by=created_at&sort_dir=desc")
    assert response.status_code == 200, response.text
    payload = response.json()

    ids = [item["id"] for item in payload["items"]]
    names = [item["name"] for item in payload["items"]]
    assert names[0] == "bravo"
    assert ids.index(same_time_2.id) < ids.index(same_time_1.id)


def test_admin_s3_users_minimal_is_sorted_case_insensitive(client, db_session):
    _seed_s3_user(db_session, name="Zulu", uid="uid-min-zulu")
    _seed_s3_user(db_session, name="alpha", uid="uid-min-alpha")
    _seed_s3_user(db_session, name="Beta", uid="uid-min-beta")

    response = client.get("/api/admin/s3-users/minimal")
    assert response.status_code == 200, response.text
    payload = response.json()

    assert [item["name"] for item in payload] == ["alpha", "Beta", "Zulu"]


def test_admin_s3_users_search_matches_tag_labels(client, db_session):
    tagged = _seed_s3_user(db_session, name="tagged-user", uid="uid-tagged")
    _seed_s3_user(db_session, name="plain-user", uid="uid-plain")
    TagsService(db_session).replace_s3_user_tags(tagged, [{"label": "prod", "color_key": "emerald"}])
    db_session.commit()

    response = client.get("/api/admin/s3-users", params={"search": "prod"})
    assert response.status_code == 200, response.text
    payload = response.json()

    assert [item["name"] for item in payload["items"]] == ["tagged-user"]
