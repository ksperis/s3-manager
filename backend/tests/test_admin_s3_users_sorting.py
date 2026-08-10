# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import UTC, datetime

from app.db import S3User, StorageEndpoint, StorageProvider, UiGroup, UiGroupS3User, User, UserRole, UserS3User
from app.services.tags_service import TagsService


def _seed_s3_user(
    db_session,
    *,
    name: str,
    uid: str,
    created_at: datetime | None = None,
) -> S3User:
    endpoint = db_session.query(StorageEndpoint).order_by(StorageEndpoint.id.asc()).first()
    if endpoint is None:
        endpoint = StorageEndpoint(
            name="sorting-ceph",
            endpoint_url="https://sorting-ceph.example.test",
            provider=StorageProvider.CEPH.value,
            is_default=True,
        )
        db_session.add(endpoint)
        db_session.flush()
    row = S3User(
        name=name,
        rgw_user_uid=uid,
        email=f"{uid}@example.test",
        rgw_access_key=f"AK-{uid}",
        rgw_secret_key="SECRET",
        created_at=created_at,
        updated_at=created_at,
        storage_endpoint_id=endpoint.id,
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
    base_time = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
    _seed_s3_user(db_session, name="alpha", uid="uid-time-alpha", created_at=base_time)
    _seed_s3_user(
        db_session,
        name="bravo",
        uid="uid-time-bravo",
        created_at=datetime(2026, 1, 2, 12, 0, 0, tzinfo=UTC),
    )
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


def test_admin_s3_users_search_and_detail_include_direct_group_links(client, db_session):
    linked = _seed_s3_user(db_session, name="group-linked-user", uid="uid-group-linked")
    _seed_s3_user(db_session, name="plain-user", uid="uid-group-plain")
    group = UiGroup(name="Ops Readers")
    db_session.add(group)
    db_session.flush()
    db_session.add(UiGroupS3User(group_id=group.id, s3_user_id=linked.id))
    db_session.commit()

    response = client.get("/api/admin/s3-users", params={"search": "ops readers"})
    assert response.status_code == 200, response.text
    payload = response.json()

    assert [item["name"] for item in payload["items"]] == ["group-linked-user"]
    assert payload["items"][0]["group_ids"] == [group.id]
    assert payload["items"][0]["group_details"][0]["id"] == group.id
    assert payload["items"][0]["group_details"][0]["name"] == "Ops Readers"
    assert payload["items"][0]["group_details"][0]["avatar"]["initials"] == "OR"

    detail = client.get(f"/api/admin/s3-users/{linked.id}")
    assert detail.status_code == 200, detail.text
    detail_payload = detail.json()
    assert detail_payload["group_ids"] == [group.id]
    assert detail_payload["group_details"][0]["id"] == group.id
    assert detail_payload["group_details"][0]["name"] == "Ops Readers"
    assert detail_payload["group_details"][0]["avatar"]["initials"] == "OR"


def test_admin_s3_users_search_matches_linked_ui_user_email(client, db_session):
    linked = _seed_s3_user(db_session, name="email-linked-user", uid="uid-email-linked")
    user = User(
        email="linked.search@example.test",
        hashed_password="x",
        role=UserRole.UI_USER.value,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    db_session.add(UserS3User(user_id=user.id, s3_user_id=linked.id))
    db_session.commit()

    response = client.get("/api/admin/s3-users", params={"search": "linked.search"})
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert [item["name"] for item in items] == ["email-linked-user"]
    assert items[0]["user_details"][0]["id"] == user.id
    assert items[0]["user_details"][0]["email"] == "linked.search@example.test"
    assert items[0]["user_details"][0]["avatar"]["initials"] == "LS"


def test_admin_s3_users_update_replaces_direct_group_links(client, db_session):
    s3_user = _seed_s3_user(db_session, name="group-edit-user", uid="uid-group-edit")
    old_group = UiGroup(name="Old User Group")
    new_group = UiGroup(name="New User Group")
    linked_user = User(
        email="manager-browser-link@example.test",
        hashed_password="x",
        role=UserRole.UI_USER.value,
        is_active=True,
    )
    db_session.add_all([old_group, new_group, linked_user])
    db_session.flush()
    db_session.add(UiGroupS3User(group_id=old_group.id, s3_user_id=s3_user.id))
    db_session.commit()

    response = client.put(
        f"/api/admin/s3-users/{s3_user.id}",
        json={
            "user_links": [
                {
                    "user_id": linked_user.id,
                    "allow_manager_browser_data_access": True,
                }
            ],
            "group_links": [
                {
                    "group_id": new_group.id,
                    "allow_manager_browser_data_access": True,
                }
            ],
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()

    assert payload["group_ids"] == [new_group.id]
    assert payload["group_details"][0]["id"] == new_group.id
    assert payload["group_details"][0]["name"] == "New User Group"
    assert payload["group_details"][0]["avatar"]["initials"] == "NG"
    assert payload["user_links"][0]["user_id"] == linked_user.id
    assert payload["user_links"][0]["allow_manager_browser_data_access"] is True
    assert payload["group_links"][0]["group_id"] == new_group.id
    assert payload["group_links"][0]["allow_manager_browser_data_access"] is True
    rows = db_session.query(UiGroupS3User).filter(UiGroupS3User.s3_user_id == s3_user.id).all()
    assert [row.group_id for row in rows] == [new_group.id]

    compatible = client.put(
        f"/api/admin/s3-users/{s3_user.id}",
        json={"user_ids": [linked_user.id], "group_ids": [new_group.id]},
    )
    assert compatible.status_code == 200, compatible.text
    assert compatible.json()["user_links"][0]["allow_manager_browser_data_access"] is True
    assert compatible.json()["group_links"][0]["allow_manager_browser_data_access"] is True

    ambiguous = client.put(
        f"/api/admin/s3-users/{s3_user.id}",
        json={
            "user_ids": [linked_user.id],
            "user_links": [
                {
                    "user_id": linked_user.id,
                    "allow_manager_browser_data_access": False,
                }
            ],
        },
    )
    assert ambiguous.status_code == 422
