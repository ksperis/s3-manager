# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from sqlalchemy.orm import Session

from app.db import S3Connection, S3User


def load_s3_user_names(db: Session, ids: list[int]) -> dict[int, str]:
    if not ids:
        return {}
    rows = db.query(S3User.id, S3User.name).filter(S3User.id.in_(ids)).all()
    return {int(row[0]): str(row[1]) for row in rows}


def load_shared_s3_connection_names(
    db: Session,
    ids: list[int],
) -> dict[int, str]:
    if not ids:
        return {}
    rows = db.query(S3Connection.id, S3Connection.name).filter(
        S3Connection.id.in_(ids),
        S3Connection.is_shared.is_(True),
    ).all()
    return {int(row[0]): str(row[1]) for row in rows}
