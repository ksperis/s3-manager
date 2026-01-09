# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from app.main import app
from app.db import S3Account, User, UserRole
from fastapi.testclient import TestClient


@pytest.fixture
def seed_user_account(db_session):
    acc = S3Account(name="api-acc", rgw_account_id="RGW00000000000000002")
    db_session.add(acc)
    db_session.flush()
    usr = User(
        email="api-user@example.com",
        full_name="API",
        hashed_password="x",
        is_active=True,
        role=UserRole.ACCOUNT_ADMIN.value,
    )
    db_session.add(usr)
    db_session.commit()
    return usr, acc


def test_assign_user_to_account_api(client: TestClient, db_session, seed_user_account, monkeypatch):
    usr, acc = seed_user_account

    # Monkeypatch RGW call inside UsersService
    from app.services import users_service

    resp = client.post(f"/api/admin/users/{usr.id}/assign-account", json={"account_id": acc.id})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert acc.id in data.get("accounts", [])
