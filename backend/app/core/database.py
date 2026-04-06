# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DatabaseError

from .config import get_settings

settings = get_settings()
_SQLITE_BUSY_TIMEOUT_MS = 30_000


def is_sqlite_url(url: str | None) -> bool:
    text = str(url or "").strip().lower()
    return text.startswith("sqlite")


def is_sqlite_malformed_database_error(exc: BaseException) -> bool:
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        text = str(current).strip().lower()
        if "database disk image is malformed" in text or "database malformed" in text:
            return True
        current = getattr(current, "orig", None) or current.__cause__
    return False


def _configure_sqlite_connection(dbapi_connection, _connection_record) -> None:  # noqa: ANN001
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute(f"PRAGMA busy_timeout = {_SQLITE_BUSY_TIMEOUT_MS}")
        cursor.execute("PRAGMA journal_mode = WAL")
        cursor.execute("PRAGMA synchronous = FULL")
    finally:
        cursor.close()


def sqlite_integrity_status(engine: Engine) -> tuple[bool, str]:
    if not is_sqlite_url(str(engine.url)):
        return True, "not_sqlite"
    try:
        with engine.connect() as connection:
            result = connection.exec_driver_sql("PRAGMA quick_check;").scalar()
    except DatabaseError as exc:
        return False, str(exc)
    text = str(result or "").strip() or "unknown"
    return text.lower() == "ok", text


def _create_engine() -> Engine:
    connect_args = {}
    if is_sqlite_url(settings.database_url):
        connect_args = {"check_same_thread": False, "timeout": _SQLITE_BUSY_TIMEOUT_MS / 1000}
    engine = create_engine(
        settings.database_url,
        echo=False,
        future=True,
        connect_args=connect_args,
        pool_pre_ping=True,
    )
    if is_sqlite_url(settings.database_url):
        event.listen(engine, "connect", _configure_sqlite_connection)
    return engine


engine = _create_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
