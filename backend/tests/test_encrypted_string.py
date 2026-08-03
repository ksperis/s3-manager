# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.core.security import (
    EncryptedString,
    clear_credential_keys_override,
    decrypt_secret,
    set_credential_keys_override,
)


def test_encrypted_string_encrypts_writes_and_rejects_plaintext_reads():
    set_credential_keys_override(["encrypted-string-test-key"])
    try:
        column_type = EncryptedString()
        encrypted = column_type.process_bind_param("secret", dialect=None)

        assert encrypted != "secret"
        assert decrypt_secret(encrypted) == "secret"
        assert column_type.process_result_value(encrypted, dialect=None) == "secret"
        with pytest.raises(ValueError, match="Unable to decrypt secret"):
            column_type.process_result_value("plaintext", dialect=None)
    finally:
        clear_credential_keys_override()
