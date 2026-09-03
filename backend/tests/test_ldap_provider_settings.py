# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from importlib import util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from pydantic import ValidationError
import sqlalchemy as sa
from sqlalchemy import create_engine, text

from app.core.config import LDAPProviderSettings, Settings
from app.db import AuditLog, ExternalIdentity, LdapProvider, User, UserRole
from app.main import app
from app.routers import dependencies
from app.services.ldap_provider_settings_service import (
    list_effective_ldap_providers,
    resolve_ldap_provider_map,
)
from app.services.ldap_service import LDAPAuthService, LDAPIdentity
from app.services.users_service import get_users_service
from tests.auth_test_utils import authenticate_ui_client


def _provider_settings(*, enabled: bool = True, display_name: str = "Corporate LDAP") -> LDAPProviderSettings:
    return LDAPProviderSettings(
        display_name=display_name,
        url="ldaps://ldap.example.test",
        bind_dn="cn=bucketreef,ou=svc,dc=example,dc=test",
        bind_password="env-secret",
        user_base_dn="ou=people,dc=example,dc=test",
        enabled=enabled,
    )


def test_environment_ldap_provider_rejects_unknown_fields():
    payload = _provider_settings().model_dump()
    payload["obsolete_field"] = True

    with pytest.raises(ValidationError, match="obsolete_field"):
        Settings(ldap_providers={"corp": payload})


def _ui_provider(provider_id: str, *, enabled: bool = True, display_name: str | None = None) -> LdapProvider:
    return LdapProvider(
        provider_id=provider_id,
        display_name=display_name or provider_id.title(),
        url=f"ldaps://{provider_id}.example.test",
        bind_dn=f"cn={provider_id},ou=svc,dc=example,dc=test",
        bind_password=f"{provider_id}-secret",
        user_base_dn="ou=people,dc=example,dc=test",
        user_filter="(uid={username})",
        email_attribute="mail",
        name_attribute="displayName",
        start_tls=False,
        tls_verify=True,
        timeout_seconds=5.0,
        enabled=enabled,
    )


def _superadmin_user() -> User:
    return User(
        id=4101,
        email="superadmin@example.com",
        full_name="Super Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )


def _authenticate_superadmin(client, db_session) -> None:
    actor = _superadmin_user()
    db_session.add(actor)
    db_session.commit()
    authenticate_ui_client(client, db_session, actor, mfa_verified=True)


def _payload(**overrides) -> dict:
    payload = {
        "provider_id": "ui",
        "display_name": "UI LDAP",
        "url": "ldaps://ldap-ui.example.test",
        "bind_dn": "cn=bucketreef,ou=svc,dc=example,dc=test",
        "bind_password": "first-secret",
        "user_base_dn": "ou=people,dc=example,dc=test",
        "user_filter": "(uid={username})",
        "email_attribute": "mail",
        "name_attribute": "displayName",
        "subject_attribute": "",
        "start_tls": False,
        "tls_verify": True,
        "tls_ca_file": "",
        "timeout_seconds": 5,
        "enabled": True,
        "allow_insecure": False,
    }
    payload.update(overrides)
    return payload


def test_ldap_providers_migration_creates_and_drops_table(monkeypatch):
    migration_path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0055_ldap_providers.py"
    spec = util.spec_from_file_location("migration_0055_ldap_providers", migration_path)
    assert spec is not None and spec.loader is not None
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(migration, "op", operations)

        migration.upgrade()
        inspector = sa.inspect(connection)
        assert "ldap_providers" in inspector.get_table_names()
        columns = {column["name"] for column in inspector.get_columns("ldap_providers")}
        assert {
            "provider_id",
            "display_name",
            "url",
            "bind_dn",
            "bind_password",
            "user_base_dn",
            "user_filter",
            "email_attribute",
            "name_attribute",
            "subject_attribute",
            "start_tls",
            "tls_verify",
            "tls_ca_file",
            "timeout_seconds",
            "enabled",
            "allow_insecure",
            "allow_email_linking",
            "created_at",
            "updated_at",
        } <= columns

        migration.downgrade()
        assert "ldap_providers" not in sa.inspect(connection).get_table_names()


def test_optional_ldap_bind_credentials_migration_changes_nullability(monkeypatch):
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0067_optional_ldap_bind_credentials.py"
    )
    spec = util.spec_from_file_location("migration_0067_optional_ldap_bind_credentials", migration_path)
    assert spec is not None and spec.loader is not None
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    sa.Table(
        "ldap_providers",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bind_dn", sa.String(), nullable=False),
        sa.Column("bind_password", sa.String(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(migration, "op", operations)

        migration.upgrade()
        columns = {column["name"]: column for column in sa.inspect(connection).get_columns("ldap_providers")}
        assert columns["bind_dn"]["nullable"] is True
        assert columns["bind_password"]["nullable"] is True

        migration.downgrade()
        columns = {column["name"]: column for column in sa.inspect(connection).get_columns("ldap_providers")}
        assert columns["bind_dn"]["nullable"] is False
        assert columns["bind_password"]["nullable"] is False


def test_ldap_legacy_tls_compatibility_migration_adds_and_drops_flag(monkeypatch):
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0068_ldap_legacy_tls_compatibility.py"
    )
    spec = util.spec_from_file_location("migration_0068_ldap_legacy_tls_compatibility", migration_path)
    assert spec is not None and spec.loader is not None
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    sa.Table(
        "ldap_providers",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(migration, "op", operations)

        migration.upgrade()
        columns = {column["name"]: column for column in sa.inspect(connection).get_columns("ldap_providers")}
        assert columns["allow_legacy_tls"]["nullable"] is False

        migration.downgrade()
        columns = {column["name"] for column in sa.inspect(connection).get_columns("ldap_providers")}
        assert "allow_legacy_tls" not in columns


def test_ldap_resolver_merges_env_and_ui_with_env_precedence(db_session):
    settings = Settings(ldap_providers={"corp": _provider_settings(display_name="Env LDAP")})
    db_session.add_all(
        [
            _ui_provider("corp", display_name="Shadow LDAP"),
            _ui_provider("ui", display_name="UI LDAP"),
            _ui_provider("disabled", enabled=False, display_name="Disabled LDAP"),
        ]
    )
    db_session.commit()

    effective = list_effective_ldap_providers(db_session, settings)
    by_id = {item.provider_id: item for item in effective}
    assert by_id["corp"].source == "environment"
    assert by_id["corp"].display_name == "Env LDAP"
    assert by_id["corp"].editable is False
    assert by_id["corp"].field_locks["bind_password"].source == "LDAP_PROVIDERS__CORP__BIND_PASSWORD"
    assert by_id["ui"].source == "ui"
    assert by_id["ui"].editable is True
    assert "disabled" in by_id

    runtime = resolve_ldap_provider_map(db_session, settings)
    assert runtime["corp"].display_name == "Env LDAP"
    assert runtime["ui"].display_name == "UI LDAP"

    service = LDAPAuthService(db_session, get_users_service(db_session), settings=settings)
    assert service.list_providers() == [
        {"id": "corp", "display_name": "Env LDAP"},
        {"id": "ui", "display_name": "UI LDAP"},
    ]


def test_ldap_service_authenticate_uses_ui_defined_provider(db_session, monkeypatch):
    db_session.add(_ui_provider("ui", display_name="UI LDAP"))
    db_session.commit()
    service = LDAPAuthService(
        db_session,
        get_users_service(db_session),
        settings=Settings(ldap_providers={}),
    )
    monkeypatch.setattr(
        service,
        "_authenticate_directory",
        lambda *args, **kwargs: LDAPIdentity(
            provider="ui",
            subject="uuid-123",
            dn="uid=jane,ou=people,dc=example,dc=test",
            email="jane@example.test",
            full_name="Jane Doe",
        ),
    )

    user, created = service.authenticate("ui", "jane", "secret-password")

    assert created is True
    assert user.email == "jane@example.test"
    identity = db_session.query(ExternalIdentity).one()
    assert identity.user_id == user.id
    assert identity.provider_type == "ldap"
    assert identity.provider_id == "ui"
    assert identity.subject == "uuid-123"


def test_admin_ldap_api_never_returns_secret_and_preserves_replaces_it(client, db_session, monkeypatch):
    monkeypatch.setattr(
        "app.services.ldap_provider_settings_service.get_settings",
        lambda: Settings(ldap_providers={}),
    )
    app.dependency_overrides[dependencies.get_current_user] = _superadmin_user
    app.dependency_overrides.pop(dependencies.get_current_ui_superadmin, None)
    _authenticate_superadmin(client, db_session)

    response = client.post("/api/admin/settings/ldap/providers", json=_payload())
    assert response.status_code == 201, response.text
    body = response.json()
    assert "bind_password" not in body
    assert body["has_bind_password"] is True

    raw_secret = db_session.execute(
        text("select bind_password from ldap_providers where provider_id = 'ui'")
    ).scalar_one()
    assert raw_secret != "first-secret"
    assert db_session.query(LdapProvider).filter(LdapProvider.provider_id == "ui").one().bind_password == "first-secret"

    listed = client.get("/api/admin/settings/ldap/providers")
    assert listed.status_code == 200, listed.text
    assert "bind_password" not in listed.json()[0]
    assert "first-secret" not in listed.text

    preserve_payload = _payload(display_name="Updated LDAP", bind_password="")
    response = client.put("/api/admin/settings/ldap/providers/ui", json=preserve_payload)
    assert response.status_code == 200, response.text
    provider = db_session.query(LdapProvider).filter(LdapProvider.provider_id == "ui").one()
    assert provider.display_name == "Updated LDAP"
    assert provider.bind_password == "first-secret"

    replace_payload = _payload(display_name="Updated LDAP", bind_password="second-secret")
    response = client.put("/api/admin/settings/ldap/providers/ui", json=replace_payload)
    assert response.status_code == 200, response.text
    assert db_session.query(LdapProvider).filter(LdapProvider.provider_id == "ui").one().bind_password == "second-secret"

    clear_payload = _payload(bind_password="", clear_bind_password=True)
    response = client.put("/api/admin/settings/ldap/providers/ui", json=clear_payload)
    assert response.status_code == 400, response.text
    assert "first-secret" not in response.text
    assert "second-secret" not in response.text

    audit_payload = "\n".join(log.metadata_json or "" for log in db_session.query(AuditLog).all())
    assert "first-secret" not in audit_payload
    assert "second-secret" not in audit_payload
    assert "ldap_provider.create" in {log.action for log in db_session.query(AuditLog).all()}
    assert "ldap_provider.update" in {log.action for log in db_session.query(AuditLog).all()}


def test_admin_ldap_api_supports_anonymous_search_and_clears_stored_credentials(
    client,
    db_session,
    monkeypatch,
):
    monkeypatch.setattr(
        "app.services.ldap_provider_settings_service.get_settings",
        lambda: Settings(ldap_providers={}),
    )
    app.dependency_overrides[dependencies.get_current_user] = _superadmin_user
    app.dependency_overrides.pop(dependencies.get_current_ui_superadmin, None)
    _authenticate_superadmin(client, db_session)

    response = client.post(
        "/api/admin/settings/ldap/providers",
        json=_payload(bind_dn="", bind_password=""),
    )
    assert response.status_code == 201, response.text
    assert response.json()["bind_dn"] is None
    assert response.json()["has_bind_password"] is False

    provider = db_session.query(LdapProvider).filter(LdapProvider.provider_id == "ui").one()
    assert provider.bind_dn is None
    assert provider.bind_password is None

    response = client.put(
        "/api/admin/settings/ldap/providers/ui",
        json=_payload(
            bind_dn="cn=bucketreef,ou=svc,dc=example,dc=test",
            bind_password="service-secret",
            allow_legacy_tls=True,
        ),
    )
    assert response.status_code == 200, response.text
    assert response.json()["has_bind_password"] is True
    assert response.json()["allow_legacy_tls"] is True
    assert db_session.query(LdapProvider).filter(LdapProvider.provider_id == "ui").one().allow_legacy_tls is True

    response = client.put(
        "/api/admin/settings/ldap/providers/ui",
        json=_payload(bind_dn="", bind_password="", clear_bind_password=True),
    )
    assert response.status_code == 200, response.text
    assert response.json()["bind_dn"] is None
    assert response.json()["has_bind_password"] is False
    db_session.expire_all()
    provider = db_session.query(LdapProvider).filter(LdapProvider.provider_id == "ui").one()
    assert provider.bind_dn is None
    assert provider.bind_password is None


def test_admin_ldap_api_rejects_partial_bind_credentials(client, db_session, monkeypatch):
    monkeypatch.setattr(
        "app.services.ldap_provider_settings_service.get_settings",
        lambda: Settings(ldap_providers={}),
    )
    app.dependency_overrides[dependencies.get_current_user] = _superadmin_user
    app.dependency_overrides.pop(dependencies.get_current_ui_superadmin, None)
    _authenticate_superadmin(client, db_session)

    response = client.post(
        "/api/admin/settings/ldap/providers",
        json=_payload(bind_password=""),
    )

    assert response.status_code == 400, response.text
    assert "configured together" in response.text


def test_admin_ldap_api_locks_environment_managed_provider(client, db_session, monkeypatch):
    monkeypatch.setattr(
        "app.services.ldap_provider_settings_service.get_settings",
        lambda: Settings(ldap_providers={"corp": _provider_settings(display_name="Env LDAP")}),
    )
    app.dependency_overrides[dependencies.get_current_user] = _superadmin_user
    app.dependency_overrides.pop(dependencies.get_current_ui_superadmin, None)
    _authenticate_superadmin(client, db_session)

    response = client.get("/api/admin/settings/ldap/providers")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body[0]["provider_id"] == "corp"
    assert body[0]["source"] == "environment"
    assert body[0]["editable"] is False
    assert body[0]["field_locks"]["display_name"]["source"] == "LDAP_PROVIDERS__CORP__DISPLAY_NAME"
    assert "bind_password" not in body[0]

    mutation = _payload(provider_id="corp", bind_password="ignored")
    assert client.post("/api/admin/settings/ldap/providers", json=mutation).status_code == 409
    assert client.put("/api/admin/settings/ldap/providers/corp", json=mutation).status_code == 409
    assert client.delete("/api/admin/settings/ldap/providers/corp").status_code == 409
