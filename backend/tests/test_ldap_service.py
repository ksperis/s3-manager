# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from importlib.metadata import version
import struct
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.core.config import LDAPProviderSettings, Settings
from app.models.ldap import LDAPLoginRequest
from app.db import ExternalIdentity, ExternalIdentityLinkRequest, User, UserRole
from app.services.external_identity_user_service import ExternalIdentityLinkRequiredError
from app.services.ldap_service import (
    LDAPAuthenticationError,
    LDAPAuthService,
    LDAPConfigurationError,
    LDAPIdentity,
    LDAP_LEGACY_TLS_CIPHERS,
    LDAPUserConflictError,
)
from app.services.users_service import get_users_service


def _provider(**overrides) -> LDAPProviderSettings:
    data = {
        "display_name": "Corporate LDAP",
        "url": "ldaps://ldap.example.test",
        "bind_dn": "cn=kaelo,ou=svc,dc=example,dc=test",
        "bind_password": "service-secret",
        "user_base_dn": "ou=people,dc=example,dc=test",
    }
    data.update(overrides)
    return LDAPProviderSettings(**data)


def _settings(provider: LDAPProviderSettings | None = None) -> Settings:
    return Settings(ldap_providers={"corp": provider or _provider()})


def _service(db_session, provider: LDAPProviderSettings | None = None) -> LDAPAuthService:
    return LDAPAuthService(db_session, get_users_service(db_session), settings=_settings(provider))


def test_pyasn1_dependency_is_pinned_to_patched_release():
    assert tuple(int(part) for part in version("pyasn1").split(".")[:3]) >= (0, 6, 4)


def test_python_multipart_dependency_is_pinned_to_patched_release():
    assert tuple(int(part) for part in version("python-multipart").split(".")[:3]) >= (0, 0, 30)


def test_ldap_login_request_rejects_unbounded_or_empty_inputs():
    assert LDAPLoginRequest(username="  jane  ", password="secret-password").username == "jane"

    with pytest.raises(ValidationError, match="username"):
        LDAPLoginRequest(username="   ", password="secret-password")
    with pytest.raises(ValidationError, match="username"):
        LDAPLoginRequest(username="j" * 257, password="secret-password")
    with pytest.raises(ValidationError, match="password"):
        LDAPLoginRequest(username="jane", password="")
    with pytest.raises(ValidationError, match="password"):
        LDAPLoginRequest(username="jane", password="p" * 1025)


def test_ldap_provider_rejects_insecure_ldap_without_starttls_or_opt_in():
    with pytest.raises(ValidationError, match="requires LDAPS or START_TLS"):
        _provider(url="ldap://ldap.example.test")

    assert _provider(url="ldap://ldap.example.test", start_tls=True).start_tls is True
    assert _provider(url="ldap://ldap.example.test", allow_insecure=True).allow_insecure is True


def test_ldap_provider_requires_username_placeholder_in_filter():
    with pytest.raises(ValidationError, match="user_filter"):
        _provider(user_filter="(mail=admin@example.test)")


def test_ldap_provider_allows_anonymous_search_and_rejects_partial_bind_credentials():
    provider = _provider(bind_dn=None, bind_password=None)

    assert provider.bind_dn is None
    assert provider.bind_password is None

    with pytest.raises(ValidationError, match="must be configured together"):
        _provider(bind_password=None)
    with pytest.raises(ValidationError, match="must be configured together"):
        _provider(bind_dn=None)


def test_settings_rejects_invalid_ldap_provider_ids():
    with pytest.raises(ValidationError, match="LDAP provider keys"):
        Settings(ldap_providers={"corp/prod": _provider()})


def test_search_filter_escapes_username():
    service = _service(SimpleNamespace())
    provider = _provider(user_filter="(uid={username})")

    assert service._build_search_filter(provider, "a*b(c)\\") == r"(uid=a\2ab\28c\29\5c)"


def test_build_server_enables_legacy_tls_ciphers_only_when_requested(db_session):
    service = _service(db_session)

    modern_server = service._build_server(_provider())
    compatible_server = service._build_server(_provider(allow_legacy_tls=True))

    assert modern_server.tls.ciphers is None
    assert modern_server.tls.sni == "ldap.example.test"
    assert compatible_server.tls.ciphers == LDAP_LEGACY_TLS_CIPHERS
    assert compatible_server.tls.sni == "ldap.example.test"


def test_bind_connection_uses_integer_receive_timeout(db_session, monkeypatch):
    service = _service(db_session)
    captured = {}

    class Connection:
        def __init__(self, _server, **kwargs):
            captured.update(kwargs)

        def bind(self):
            return True

    monkeypatch.setattr("app.services.ldap_service.Connection", Connection)

    service._bind_connection(
        _provider(timeout_seconds=5.1),
        user=None,
        password=None,
        invalid_credentials_as_auth=False,
    )

    assert captured["receive_timeout"] == 6
    assert isinstance(captured["receive_timeout"], int)


def test_bind_connection_converts_socket_timeout_packing_error_to_configuration_error(
    db_session,
    monkeypatch,
):
    service = _service(db_session)

    class Connection:
        def __init__(self, _server, **_kwargs):
            pass

        def bind(self):
            raise struct.error("required argument is not an integer")

        def unbind(self):
            return True

    monkeypatch.setattr("app.services.ldap_service.Connection", Connection)

    with pytest.raises(LDAPConfigurationError, match="Unable to bind"):
        service._bind_connection(
            _provider(),
            user=None,
            password=None,
            invalid_credentials_as_auth=False,
        )


def test_search_identity_reads_attributes_and_normalizes_email(db_session):
    service = _service(
        db_session,
        _provider(subject_attribute="entryUUID", name_attribute="displayName"),
    )

    class Entry:
        entry_dn = "uid=jane,ou=people,dc=example,dc=test"
        entry_attributes_as_dict = {
            "mail": ["JANE@Example.com"],
            "displayName": ["Jane Doe"],
            "entryUUID": ["uuid-123"],
        }

    class Connection:
        entries = [Entry()]

        def search(self, **kwargs):
            self.kwargs = kwargs
            return True

    connection = Connection()
    identity = service._search_identity("corp", service.settings.ldap_providers["corp"], connection, "jane")

    assert identity.email == "jane@example.com"
    assert identity.full_name == "Jane Doe"
    assert identity.subject == "uuid-123"
    assert connection.kwargs["size_limit"] == 2


def test_search_identity_rejects_invalid_email_attribute(db_session):
    service = _service(db_session)

    class Entry:
        entry_dn = "uid=jane,ou=people,dc=example,dc=test"
        entry_attributes_as_dict = {"mail": ["not an email address"]}

    class Connection:
        entries = [Entry()]

        def search(self, **kwargs):
            return True

    with pytest.raises(LDAPConfigurationError, match="invalid email"):
        service._search_identity("corp", service.settings.ldap_providers["corp"], Connection(), "jane")


def test_search_identity_rejects_ambiguous_results(db_session):
    service = _service(db_session)

    class Entry:
        entry_dn = "uid=jane,ou=people,dc=example,dc=test"
        entry_attributes_as_dict = {"mail": ["jane@example.test"]}

    class Connection:
        entries = [Entry(), Entry()]

        def search(self, **kwargs):
            return True

    with pytest.raises(LDAPAuthenticationError):
        service._search_identity("corp", service.settings.ldap_providers["corp"], Connection(), "jane")


def test_authenticate_directory_uses_anonymous_bind_for_user_search(db_session, monkeypatch):
    provider = _provider(bind_dn=None, bind_password=None)
    service = _service(db_session, provider)
    bind_calls = []

    class Connection:
        def unbind(self):
            return True

    def fake_bind(provider_arg, *, user, password, invalid_credentials_as_auth):
        assert provider_arg is provider
        bind_calls.append((user, password, invalid_credentials_as_auth))
        return Connection()

    identity = LDAPIdentity(
        provider="corp",
        subject="uuid-123",
        dn="uid=jane,ou=people,dc=example,dc=test",
        email="jane@example.test",
        full_name="Jane Doe",
    )
    monkeypatch.setattr(service, "_bind_connection", fake_bind)
    monkeypatch.setattr(service, "_search_identity", lambda *args: identity)

    result = service._authenticate_directory("corp", provider, "jane", "user-secret")

    assert result is identity
    assert bind_calls == [
        (None, None, False),
        ("uid=jane,ou=people,dc=example,dc=test", "user-secret", True),
    ]


def test_authenticate_creates_ldap_user_without_ui_access(db_session, monkeypatch):
    service = _service(db_session)
    monkeypatch.setattr(
        service,
        "_authenticate_directory",
        lambda *args, **kwargs: LDAPIdentity(
            provider="corp",
            subject="uuid-123",
            dn="uid=jane,ou=people,dc=example,dc=test",
            email="jane@example.test",
            full_name="Jane Doe",
        ),
    )

    user, created = service.authenticate("corp", "jane", "secret-password")

    assert created is True
    assert user.email == "jane@example.test"
    assert user.role == UserRole.UI_NONE.value
    identity = db_session.query(ExternalIdentity).one()
    assert identity.user_id == user.id
    assert identity.provider_type == "ldap"
    assert identity.provider_id == "corp"
    assert identity.subject == "uuid-123"
    assert user.hashed_password is None
    assert user.last_login_at is not None


def test_authenticate_rejects_email_collision_by_default(db_session, monkeypatch):
    db_session.add(
        User(
            email="jane@example.test",
            hashed_password="hash",
            is_active=True,
            role=UserRole.UI_USER.value,
        )
    )
    db_session.commit()
    service = _service(db_session)
    monkeypatch.setattr(
        service,
        "_authenticate_directory",
        lambda *args, **kwargs: LDAPIdentity(
            provider="corp",
            subject="uuid-123",
            dn="uid=jane,ou=people,dc=example,dc=test",
            email="jane@example.test",
            full_name="Jane Doe",
        ),
    )

    with pytest.raises(ExternalIdentityLinkRequiredError):
        service.authenticate("corp", "jane", "secret-password")
    request = db_session.query(ExternalIdentityLinkRequest).one()
    assert request.provider_type == "ldap"
    assert request.provider_id == "corp"
    assert request.subject == "uuid-123"
    assert request.status == "pending"


def test_authenticate_never_links_existing_email_automatically(db_session, monkeypatch):
    db_session.add(
        User(
            email="jane@example.test",
            hashed_password="hash",
            is_active=True,
            role=UserRole.UI_USER.value,
        )
    )
    db_session.commit()
    service = _service(db_session)
    monkeypatch.setattr(
        service,
        "_authenticate_directory",
        lambda *args, **kwargs: LDAPIdentity(
            provider="corp",
            subject="uuid-123",
            dn="uid=jane,ou=people,dc=example,dc=test",
            email="jane@example.test",
            full_name="Jane Doe",
        ),
    )

    with pytest.raises(ExternalIdentityLinkRequiredError):
        service.authenticate("corp", "jane", "secret-password")
    assert db_session.query(ExternalIdentity).count() == 0
    assert db_session.query(ExternalIdentityLinkRequest).count() == 1
