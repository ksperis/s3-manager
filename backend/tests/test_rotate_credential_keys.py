# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from app.core.security import (
    clear_credential_keys_override,
    decrypt_secret,
    set_credential_keys_override,
)
from app.db.ldap import LdapProvider
from app.db.oidc import OidcProvider
from app.db.s3_account import AccountIAMUser
from app.scripts import rotate_credential_keys


def test_rotate_credentials_includes_iam_and_authentication_provider_secrets(
    db_session,
    monkeypatch,
):
    db_session.add_all(
        [
            AccountIAMUser(
                user_id=1,
                account_id=1,
                iam_user_id="iam-user",
                active_secret_key="iam-secret",
            ),
            LdapProvider(
                provider_id="ldap",
                display_name="LDAP",
                url="ldaps://ldap.example.test",
                bind_dn="cn=reader,dc=example,dc=test",
                bind_password="ldap-secret",
                user_base_dn="ou=people,dc=example,dc=test",
                user_filter="(uid={username})",
            ),
            OidcProvider(
                provider_id="oidc",
                display_name="OIDC",
                discovery_url="https://id.example.test/.well-known/openid-configuration",
                client_id="client",
                client_secret="oidc-secret",
                redirect_uri="https://app.example.test/api/auth/oidc/callback",
            ),
        ]
    )
    db_session.commit()

    session_factory = sessionmaker(bind=db_session.bind, future=True)
    monkeypatch.setattr(rotate_credential_keys, "SessionLocal", session_factory)

    assert rotate_credential_keys.rotate_credentials(new_key="rotated-key") == 3

    set_credential_keys_override(["rotated-key"])
    try:
        with db_session.bind.connect() as connection:
            encrypted_values = {
                "iam": connection.execute(
                    text("SELECT active_secret_key FROM account_iam_users")
                ).scalar_one(),
                "ldap": connection.execute(
                    text("SELECT bind_password FROM ldap_providers")
                ).scalar_one(),
                "oidc": connection.execute(
                    text("SELECT client_secret FROM oidc_providers")
                ).scalar_one(),
            }
        assert {name: decrypt_secret(value) for name, value in encrypted_values.items()} == {
            "iam": "iam-secret",
            "ldap": "ldap-secret",
            "oidc": "oidc-secret",
        }
    finally:
        clear_credential_keys_override()
