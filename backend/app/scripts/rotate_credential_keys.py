# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import argparse
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.security import (
    clear_credential_keys_override,
    decrypt_secret,
    encrypt_secret,
    set_credential_keys_override,
)
from app.db.s3_account import AccountIAMUser, S3Account
from app.db.s3_connection import S3Connection
from app.db.s3_user import S3User
from app.db.session import RgwSession
from app.db.storage_endpoint import StorageEndpoint

logger = logging.getLogger(__name__)


def _rotate_encrypted_fields(session: Session, model, fields: list[str]) -> int:
    rows = session.execute(select(model)).scalars().all()
    updated = 0
    for row in rows:
        for field in fields:
            value = getattr(row, field)
            if value is None:
                continue
            setattr(row, field, value)
            flag_modified(row, field)
            updated += 1
    return updated


def _rotate_session_fields(session: Session) -> int:
    rows = session.execute(select(RgwSession)).scalars().all()
    updated = 0
    for row in rows:
        for field in ("access_key_enc", "secret_key_enc"):
            value = getattr(row, field)
            if value is None:
                continue
            plaintext = decrypt_secret(value)
            setattr(row, field, encrypt_secret(plaintext))
            flag_modified(row, field)
            updated += 1
    return updated


def rotate_credentials(*, new_key: str) -> int:
    settings = get_settings()
    old_keys = list(settings.credential_keys)
    override_keys = [new_key] + [key for key in old_keys if key != new_key]
    set_credential_keys_override(override_keys)

    session = SessionLocal()
    try:
        updated = 0
        updated += _rotate_encrypted_fields(
            session,
            StorageEndpoint,
            ["admin_secret_key", "supervision_secret_key", "ceph_admin_secret_key"],
        )
        updated += _rotate_encrypted_fields(session, S3Account, ["rgw_secret_key"])
        updated += _rotate_encrypted_fields(session, AccountIAMUser, ["active_secret_key"])
        updated += _rotate_encrypted_fields(session, S3User, ["rgw_secret_key"])
        updated += _rotate_encrypted_fields(session, S3Connection, ["secret_access_key", "session_token"])
        updated += _rotate_session_fields(session)
        session.commit()
        return updated
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
        clear_credential_keys_override()


def main() -> None:
    parser = argparse.ArgumentParser(description="Rotate credential encryption keys.")
    parser.add_argument("--new-key", required=True, help="New credential key to use for encryption.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    updated = rotate_credentials(new_key=args.new_key)
    logger.info("Re-encrypted %s credential field(s). Update CREDENTIAL_KEY/CREDENTIAL_KEYS accordingly.", updated)


if __name__ == "__main__":
    main()
