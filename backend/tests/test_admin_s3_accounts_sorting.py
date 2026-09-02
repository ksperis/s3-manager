# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import ManagerAccountRole, PortalAccountRole, S3Account, UiGroup, UiGroupS3Account, User, UserRole, UserS3Account
from app.services.tags_service import TagsService
from tests.s3_account_factory import make_s3_account


def _seed_account(
    db_session,
    *,
    name: str,
    rgw_account_id: str | None,
) -> S3Account:
    row = make_s3_account(
        db_session,
        name=name,
        rgw_account_id=rgw_account_id,
        rgw_user_uid=f"{rgw_account_id.lower()}-admin",
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
    assert all("is_s3_user" not in item for item in payload["items"])


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

    ids = [item["id"] for item in payload["items"]]
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
    assert all("is_s3_user" not in item for item in payload)


def test_admin_accounts_search_matches_tag_labels(client, db_session):
    tagged = _seed_account(db_session, name="finance-account", rgw_account_id="RGW-TAG-ACCOUNT")
    _seed_account(db_session, name="plain-account", rgw_account_id="RGW-PLAIN-ACCOUNT")
    TagsService(db_session).replace_account_tags(tagged, [{"label": "prod", "color_key": "emerald"}])
    db_session.commit()

    response = client.get("/api/admin/accounts", params={"search": "prod"})
    assert response.status_code == 200, response.text
    payload = response.json()

    assert [item["name"] for item in payload["items"]] == ["finance-account"]


def test_admin_accounts_search_matches_direct_group_links(client, db_session):
    linked = _seed_account(db_session, name="group-linked-account", rgw_account_id="RGW-GROUP-LINKED")
    _seed_account(db_session, name="plain-account", rgw_account_id="RGW-GROUP-PLAIN")
    group = UiGroup(name="Analytics Team")
    db_session.add(group)
    db_session.flush()
    db_session.add(
        UiGroupS3Account(
            account_id=linked.id,
            group_id=group.id,
            manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
            portal_role=None,
        )
    )
    db_session.commit()

    response = client.get("/api/admin/accounts", params={"search": "analytics"})
    assert response.status_code == 200, response.text
    payload = response.json()

    assert [item["name"] for item in payload["items"]] == ["group-linked-account"]
    assert "group_ids" not in payload["items"][0]
    group_link = payload["items"][0]["group_links"][0]
    assert group_link["group_id"] == group.id
    assert group_link["group_name"] == "Analytics Team"
    assert group_link["manager_role"] == ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value
    assert group_link["portal_role"] is None
    assert group_link["group_avatar"]["initials"] == "AT"


def test_admin_accounts_search_matches_linked_user_email_and_exposes_avatar(client, db_session):
    linked = _seed_account(db_session, name="user-linked-account", rgw_account_id="RGW-USER-LINKED")
    user = User(
        email="specific.member@example.test",
        full_name="Specific Member",
        hashed_password="x",
        role=UserRole.UI_USER.value,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    db_session.add(
        UserS3Account(
            account_id=linked.id,
            user_id=user.id,
            manager_role=None,
            portal_role=PortalAccountRole.PORTAL_USER.value,
        )
    )
    db_session.commit()

    response = client.get("/api/admin/accounts", params={"search": "specific.member"})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert [item["name"] for item in payload["items"]] == ["user-linked-account"]
    user_link = payload["items"][0]["user_links"][0]
    assert user_link["user_email"] == user.email
    assert user_link["user_full_name"] == "Specific Member"
    assert user_link["user_avatar"]["initials"] == "SM"


def test_admin_accounts_update_replaces_direct_group_links(client, db_session):
    account = _seed_account(db_session, name="group-edit-account", rgw_account_id="RGW-GROUP-EDIT")
    old_group = UiGroup(name="Old Account Group")
    new_group = UiGroup(name="New Account Group")
    db_session.add_all([old_group, new_group])
    db_session.flush()
    db_session.add(
        UiGroupS3Account(
            account_id=account.id,
            group_id=old_group.id,
            manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
            portal_role=None,
        )
    )
    db_session.commit()

    response = client.put(
        f"/api/admin/accounts/{account.id}",
        json={
            "group_links": [
                {
                    "group_id": new_group.id,
                    "manager_role": None,
                    "portal_role": PortalAccountRole.PORTAL_MANAGER.value,
                }
            ]
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()

    assert "group_ids" not in payload
    group_link = payload["group_links"][0]
    assert group_link["group_id"] == new_group.id
    assert group_link["group_name"] == "New Account Group"
    assert group_link["manager_role"] is None
    assert group_link["portal_role"] == PortalAccountRole.PORTAL_MANAGER.value
    assert group_link["group_avatar"]["initials"] == "NG"
    rows = db_session.query(UiGroupS3Account).filter(UiGroupS3Account.account_id == account.id).all()
    assert [(row.group_id, row.manager_role, row.portal_role) for row in rows] == [
        (new_group.id, None, PortalAccountRole.PORTAL_MANAGER.value)
    ]


def test_admin_accounts_update_rejects_legacy_principal_id_fields(client, db_session):
    account = _seed_account(db_session, name="strict-account", rgw_account_id="RGW-STRICT")

    for legacy_field in ("user_ids", "group_ids"):
        response = client.put(
            f"/api/admin/accounts/{account.id}",
            json={legacy_field: []},
        )

        assert response.status_code == 422, response.text


def test_admin_accounts_update_rejects_null_principal_links(client, db_session):
    account = _seed_account(db_session, name="strict-links-account", rgw_account_id="RGW-STRICT-LINKS")

    for link_field in ("user_links", "group_links"):
        response = client.put(
            f"/api/admin/accounts/{account.id}",
            json={link_field: None},
        )

        assert response.status_code == 422, response.text
