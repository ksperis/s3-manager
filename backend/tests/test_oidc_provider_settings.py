# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from importlib import util
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
import sqlalchemy as sa
from sqlalchemy import create_engine, text

from app.core.config import OIDCProviderSettings, Settings
from app.db import AuditLog, OidcLoginState, OidcProvider, User, UserRole
from app.main import app
from app.routers import dependencies
from app.services.oidc_provider_settings_service import (
    _load_scopes,
    list_effective_oidc_providers,
    resolve_oidc_provider_map,
)
from app.services.oidc_service import OidcService


def _provider_settings(*, enabled: bool = True, display_name: str = "Google") -> OIDCProviderSettings:
    return OIDCProviderSettings(
        display_name=display_name,
        discovery_url="https://issuer.example.test/.well-known/openid-configuration",
        client_id="client-id",
        client_secret="env-secret",
        redirect_uri="https://app.example.test/auth/callback",
        scopes=["openid", "email", "profile"],
        enabled=enabled,
    )


def _ui_provider(provider_id: str, *, enabled: bool = True, display_name: str | None = None) -> OidcProvider:
    return OidcProvider(
        provider_id=provider_id,
        display_name=display_name or provider_id.title(),
        discovery_url=f"https://{provider_id}.example.test/.well-known/openid-configuration",
        client_id=f"{provider_id}-client",
        client_secret=f"{provider_id}-secret",
        redirect_uri=f"https://app.example.test/auth/{provider_id}/callback",
        scopes_json='["openid","email"]',
        enabled=enabled,
        use_pkce=True,
        use_nonce=True,
    )


def _superadmin_user() -> User:
    return User(
        id=4001,
        email="superadmin@example.com",
        full_name="Super Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )


def test_ui_provider_scopes_require_a_non_empty_string_list():
    assert _load_scopes('["openid","email"]') == ["openid", "email"]
    for raw in ("{", "{}", "[]", '["openid",""]', '["openid",42]'):
        with pytest.raises(ValueError):
            _load_scopes(raw)


class _FakeUsersService:
    def get_or_create_oidc_user(self, **_kwargs):
        return SimpleNamespace(id=1, email="oidc@example.test"), True

    def mark_last_login(self, user):
        return user


def test_oidc_providers_migration_creates_and_drops_table(monkeypatch):
    migration_path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0054_oidc_providers.py"
    spec = util.spec_from_file_location("migration_0054_oidc_providers", migration_path)
    assert spec is not None and spec.loader is not None
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(migration, "op", operations)

        migration.upgrade()
        inspector = sa.inspect(connection)
        assert "oidc_providers" in inspector.get_table_names()
        columns = {column["name"] for column in inspector.get_columns("oidc_providers")}
        assert {
            "provider_id",
            "display_name",
            "discovery_url",
            "client_id",
            "client_secret",
            "redirect_uri",
            "scopes_json",
            "prompt",
            "enabled",
            "icon_url",
            "use_pkce",
            "use_nonce",
            "created_at",
            "updated_at",
        } <= columns

        migration.downgrade()
        assert "oidc_providers" not in sa.inspect(connection).get_table_names()


def test_oidc_resolver_merges_env_and_ui_with_env_precedence(db_session):
    settings = Settings(
        oidc_state_ttl_seconds=60,
        oidc_providers={"google": _provider_settings(display_name="Env Google")},
    )
    db_session.add_all(
        [
            _ui_provider("google", display_name="Shadow Google"),
            _ui_provider("ui", display_name="UI Provider"),
            _ui_provider("disabled", enabled=False, display_name="Disabled Provider"),
        ]
    )
    db_session.commit()

    effective = list_effective_oidc_providers(db_session, settings)
    by_id = {item.provider_id: item for item in effective}
    assert by_id["google"].source == "environment"
    assert by_id["google"].display_name == "Env Google"
    assert by_id["google"].editable is False
    assert by_id["google"].field_locks["client_id"].source == "OIDC_PROVIDERS__GOOGLE__CLIENT_ID"
    assert by_id["ui"].source == "ui"
    assert by_id["ui"].editable is True
    assert "disabled" in by_id

    runtime = resolve_oidc_provider_map(db_session, settings)
    assert runtime["google"].display_name == "Env Google"
    assert runtime["ui"].display_name == "UI Provider"

    service = OidcService(db_session, users_service=_FakeUsersService(), settings=settings)
    assert service.list_providers() == [
        {"id": "google", "display_name": "Env Google", "icon_url": None},
        {"id": "ui", "display_name": "UI Provider", "icon_url": None},
    ]


def test_oidc_service_start_login_uses_ui_defined_provider(db_session, monkeypatch):
    db_session.add(_ui_provider("ui", display_name="UI Provider"))
    db_session.commit()
    service = OidcService(
        db_session,
        users_service=_FakeUsersService(),
        settings=Settings(oidc_state_ttl_seconds=60, oidc_providers={}),
    )
    monkeypatch.setattr(
        service,
        "_get_metadata",
        lambda *args, **kwargs: {"authorization_endpoint": "https://ui.example.test/auth"},
    )

    result = service.start_login("ui", "/admin")

    assert result["provider"] == "ui"
    assert result["authorization_url"].startswith("https://ui.example.test/auth?")
    stored = db_session.query(OidcLoginState).filter(OidcLoginState.state == result["state"]).one()
    assert stored.provider == "ui"
    assert stored.redirect_path == "/admin"


def test_admin_oidc_api_never_returns_secret_and_preserves_replaces_clears_it(client, db_session, monkeypatch):
    monkeypatch.setattr(
        "app.services.oidc_provider_settings_service.get_settings",
        lambda: Settings(oidc_providers={}, oidc_state_ttl_seconds=60),
    )
    app.dependency_overrides[dependencies.get_current_user] = _superadmin_user
    app.dependency_overrides.pop(dependencies.get_current_ui_superadmin, None)

    payload = {
        "provider_id": "ui",
        "display_name": "UI Provider",
        "discovery_url": "https://issuer.example.test/.well-known/openid-configuration",
        "client_id": "client-id",
        "client_secret": "first-secret",
        "redirect_uri": "https://app.example.test/auth/callback",
        "scopes": ["openid", "email"],
        "prompt": "login",
        "enabled": True,
        "icon_url": "https://issuer.example.test/icon.svg",
        "use_pkce": True,
        "use_nonce": True,
    }
    response = client.post("/api/admin/settings/oidc/providers", json=payload)
    assert response.status_code == 201, response.text
    body = response.json()
    assert "client_secret" not in body
    assert body["has_client_secret"] is True

    raw_secret = db_session.execute(
        text("select client_secret from oidc_providers where provider_id = 'ui'")
    ).scalar_one()
    assert raw_secret != "first-secret"
    assert db_session.query(OidcProvider).filter(OidcProvider.provider_id == "ui").one().client_secret == "first-secret"

    listed = client.get("/api/admin/settings/oidc/providers")
    assert listed.status_code == 200, listed.text
    assert "client_secret" not in listed.json()[0]
    assert "first-secret" not in listed.text

    preserve_payload = {**payload, "display_name": "Updated Provider", "client_secret": ""}
    response = client.put("/api/admin/settings/oidc/providers/ui", json=preserve_payload)
    assert response.status_code == 200, response.text
    provider = db_session.query(OidcProvider).filter(OidcProvider.provider_id == "ui").one()
    assert provider.display_name == "Updated Provider"
    assert provider.client_secret == "first-secret"

    replace_payload = {**preserve_payload, "client_secret": "second-secret"}
    response = client.put("/api/admin/settings/oidc/providers/ui", json=replace_payload)
    assert response.status_code == 200, response.text
    assert db_session.query(OidcProvider).filter(OidcProvider.provider_id == "ui").one().client_secret == "second-secret"

    clear_payload = {**preserve_payload, "client_secret": "", "clear_client_secret": True}
    response = client.put("/api/admin/settings/oidc/providers/ui", json=clear_payload)
    assert response.status_code == 200, response.text
    assert db_session.query(OidcProvider).filter(OidcProvider.provider_id == "ui").one().client_secret is None

    audit_payload = "\n".join(log.metadata_json or "" for log in db_session.query(AuditLog).all())
    assert "first-secret" not in audit_payload
    assert "second-secret" not in audit_payload
    assert "oidc_provider.create" in {log.action for log in db_session.query(AuditLog).all()}
    assert "oidc_provider.update" in {log.action for log in db_session.query(AuditLog).all()}


def test_admin_oidc_api_locks_environment_managed_provider(client, monkeypatch):
    monkeypatch.setattr(
        "app.services.oidc_provider_settings_service.get_settings",
        lambda: Settings(
            oidc_state_ttl_seconds=60,
            oidc_providers={"google": _provider_settings(display_name="Env Google")},
        ),
    )
    app.dependency_overrides[dependencies.get_current_user] = _superadmin_user
    app.dependency_overrides.pop(dependencies.get_current_ui_superadmin, None)

    response = client.get("/api/admin/settings/oidc/providers")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body[0]["provider_id"] == "google"
    assert body[0]["source"] == "environment"
    assert body[0]["editable"] is False
    assert body[0]["field_locks"]["display_name"]["source"] == "OIDC_PROVIDERS__GOOGLE__DISPLAY_NAME"
    assert "client_secret" not in body[0]

    mutation = {
        "provider_id": "google",
        "display_name": "Blocked",
        "discovery_url": "https://issuer.example.test/.well-known/openid-configuration",
        "client_id": "client-id",
        "redirect_uri": "https://app.example.test/auth/callback",
        "scopes": ["openid"],
        "enabled": True,
        "use_pkce": True,
        "use_nonce": True,
    }
    assert client.post("/api/admin/settings/oidc/providers", json=mutation).status_code == 409
    assert client.put("/api/admin/settings/oidc/providers/google", json=mutation).status_code == 409
    assert client.delete("/api/admin/settings/oidc/providers/google").status_code == 409
