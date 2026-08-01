# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import base64
import hashlib
import json
from app.core.security import get_password_hash, verify_password
from app.db import AccountRole, S3Account, User, UserRole, UserS3Account
from app.main import app
from app.routers import dependencies
from uuid import uuid4


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _seed_user(db_session, *, hashed_password: str | None, role: str = UserRole.UI_USER.value) -> User:
    email = f"profile-user-{uuid4().hex[:8]}@example.com"
    user = User(
        email=email,
        full_name="Profile User",
        display_name="Profile User",
        hashed_password=hashed_password,
        is_active=True,
        role=role,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_update_users_me_updates_full_name(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put("/api/users/me", json={"full_name": "Nouveau Nom"})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["full_name"] == "Nouveau Nom"
    assert payload["display_name"] == "Nouveau Nom"

    db_session.refresh(user)
    assert user.full_name == "Nouveau Nom"
    assert user.display_name == "Nouveau Nom"


def test_users_me_exposes_gravatar_descriptor_with_initials(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.get("/api/users/me")

    assert response.status_code == 200, response.text
    avatar = response.json()["avatar"]
    digest = hashlib.sha256(user.email.strip().lower().encode("utf-8")).hexdigest()
    assert avatar == {
        "preference": "auto",
        "source": "gravatar",
        "url": f"https://gravatar.com/avatar/{digest}?s=160&d=404&r=g",
        "initials": "PU",
        "updated_at": None,
    }


def test_users_me_prefers_oidc_picture_in_auto_mode(client, db_session):
    user = _seed_user(db_session, hashed_password=None)
    user.picture_url = "https://identity.example.com/profile/avatar.png"
    db_session.commit()
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.get("/api/users/me")

    assert response.status_code == 200, response.text
    assert response.json()["avatar"]["source"] == "provider"
    assert response.json()["avatar"]["url"] == user.picture_url


def test_users_me_can_select_initials_avatar(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put("/api/users/me", json={"avatar_preference": "initials"})

    assert response.status_code == 200, response.text
    assert response.json()["avatar"] == {
        "preference": "initials",
        "source": "initials",
        "url": None,
        "initials": "PU",
        "updated_at": None,
    }


def test_users_me_uploads_serves_and_deletes_profile_avatar(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    uploaded = client.put(
        "/api/users/me/avatar",
        files={"file": ("avatar.png", PNG_1X1, "image/png")},
    )

    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["avatar"]["preference"] == "uploaded"
    assert uploaded.json()["avatar"]["source"] == "uploaded"
    assert uploaded.json()["avatar"]["url"].startswith(f"/users/{user.id}/avatar?v=")

    image = client.get(f"/api/users/{user.id}/avatar")
    assert image.status_code == 200, image.text
    assert image.content == PNG_1X1
    assert image.headers["content-type"] == "image/png"
    assert image.headers["x-content-type-options"] == "nosniff"

    deleted = client.delete("/api/users/me/avatar")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["avatar"]["source"] == "gravatar"
    assert client.get(f"/api/users/{user.id}/avatar").status_code == 404


def test_avatar_upload_rejects_unsupported_content(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put(
        "/api/users/me/avatar",
        files={"file": ("avatar.svg", b"<svg></svg>", "image/svg+xml")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Avatar image must be a PNG or JPEG file."


def test_user_avatar_requires_a_shared_portal_account(client, db_session):
    account = S3Account(name="avatar-account", rgw_access_key="ROOT-AK", rgw_secret_key="ROOT-SK")
    viewer = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    target = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    outsider = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    target.avatar_image = PNG_1X1
    target.avatar_content_type = "image/png"
    target.avatar_preference = "uploaded"
    db_session.add(account)
    db_session.flush()
    db_session.add_all(
        [
            UserS3Account(user_id=viewer.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
            UserS3Account(user_id=target.id, account_id=account.id, role=AccountRole.PORTAL_USER.value),
        ]
    )
    db_session.commit()

    app.dependency_overrides[dependencies.get_current_user] = lambda: viewer
    assert client.get(f"/api/users/{target.id}/avatar").status_code == 200

    app.dependency_overrides[dependencies.get_current_user] = lambda: outsider
    assert client.get(f"/api/users/{target.id}/avatar").status_code == 404


def test_update_users_me_updates_ui_language(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put("/api/users/me", json={"ui_language": "de"})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ui_language"] == "de"

    db_session.refresh(user)
    assert user.ui_language == "de"


def test_update_users_me_clears_ui_language(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    user.ui_language = "fr"
    db_session.add(user)
    db_session.commit()
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put("/api/users/me", json={"ui_language": None})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ui_language"] is None

    db_session.refresh(user)
    assert user.ui_language is None


def test_update_users_me_updates_quota_alert_toggle(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put("/api/users/me", json={"quota_alerts_enabled": False})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["quota_alerts_enabled"] is False

    db_session.refresh(user)
    assert user.quota_alerts_enabled is False


def test_users_me_returns_empty_ui_preferences_for_malformed_storage(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    user.ui_preferences_json = "not-json"
    db_session.add(user)
    db_session.commit()
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.get("/api/users/me")

    assert response.status_code == 200, response.text
    assert response.json()["ui_preferences"] == {"theme": None, "selected_portal_account_id": None}


def test_update_users_me_updates_ui_preferences(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put(
        "/api/users/me",
        json={
            "ui_preferences": {
                "theme": "dark",
                "selected_portal_account_id": "101",
            }
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ui_preferences"] == {"theme": "dark", "selected_portal_account_id": "101"}

    db_session.refresh(user)
    assert json.loads(user.ui_preferences_json) == {"selected_portal_account_id": "101", "theme": "dark"}


def test_update_users_me_updates_global_watch_for_admin(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"), role=UserRole.UI_ADMIN.value)
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put("/api/users/me", json={"quota_alerts_global_watch": True})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["quota_alerts_global_watch"] is True

    db_session.refresh(user)
    assert user.quota_alerts_global_watch is True


def test_update_users_me_rejects_global_watch_for_non_admin(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"), role=UserRole.UI_USER.value)
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put("/api/users/me", json={"quota_alerts_global_watch": True})
    assert response.status_code == 400
    assert response.json()["detail"] == "Global quota watch requires admin role"


def test_update_users_me_changes_password_with_current_password(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put(
        "/api/users/me",
        json={
            "current_password": "old-password",
            "new_password": "new-password",
        },
    )
    assert response.status_code == 200, response.text

    db_session.refresh(user)
    assert verify_password("new-password", user.hashed_password)


def test_update_users_me_rejects_wrong_current_password(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put(
        "/api/users/me",
        json={
            "current_password": "bad-password",
            "new_password": "new-password",
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Current password is incorrect"


def test_update_users_me_rejects_password_change_without_local_password(client, db_session):
    user = _seed_user(db_session, hashed_password=None)
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put(
        "/api/users/me",
        json={
            "current_password": "irrelevant",
            "new_password": "new-password",
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Password change is unavailable for this account"


def test_update_users_me_rejects_short_new_password(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put(
        "/api/users/me",
        json={
            "current_password": "old-password",
            "new_password": "short123",
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Password must be at least 12 characters long"
