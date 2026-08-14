# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db import AuthRateLimit
from app.utils.time import utcnow


class LoginRateLimitedError(ValueError):
    def __init__(self, retry_after: int) -> None:
        super().__init__("Too many authentication attempts")
        self.retry_after = max(1, retry_after)


class AuthRateLimitService:
    def __init__(self, db: Session, settings: Settings | None = None) -> None:
        self.db = db
        self.settings = settings or get_settings()

    def check(self, *, account: str, ip_address: str) -> None:
        now = utcnow()
        window = self._window_start(now)
        limits = (
            (self._key("account_ip", account.lower(), ip_address), self.settings.login_rate_limit_max_attempts),
            (self._key("ip", ip_address), self.settings.login_rate_limit_max_attempts * 5),
        )
        for key, maximum in limits:
            row = self.db.query(AuthRateLimit).filter(
                AuthRateLimit.bucket_key == key,
                AuthRateLimit.window_started_at == window,
            ).first()
            if row and row.attempts >= maximum:
                elapsed = int((now - window).total_seconds())
                raise LoginRateLimitedError(self.settings.login_rate_limit_window_seconds - elapsed)

    def record_failure(self, *, account: str, ip_address: str) -> None:
        now = utcnow()
        window = self._window_start(now)
        for key in (
            self._key("account_ip", account.lower(), ip_address),
            self._key("ip", ip_address),
        ):
            changed = self.db.execute(
                update(AuthRateLimit)
                .where(AuthRateLimit.bucket_key == key, AuthRateLimit.window_started_at == window)
                .values(attempts=AuthRateLimit.attempts + 1, updated_at=now)
            )
            if changed.rowcount == 0:
                try:
                    with self.db.begin_nested():
                        self.db.add(
                            AuthRateLimit(
                                id=str(uuid.uuid4()),
                                bucket_key=key,
                                window_started_at=window,
                                attempts=1,
                                updated_at=now,
                            )
                        )
                        self.db.flush()
                except IntegrityError:
                    self.db.execute(
                        update(AuthRateLimit)
                        .where(AuthRateLimit.bucket_key == key, AuthRateLimit.window_started_at == window)
                        .values(attempts=AuthRateLimit.attempts + 1, updated_at=now)
                    )
        self.db.commit()

    def clear_account(self, *, account: str, ip_address: str) -> None:
        key = self._key("account_ip", account.lower(), ip_address)
        self.db.query(AuthRateLimit).filter(AuthRateLimit.bucket_key == key).delete(synchronize_session=False)
        self.db.commit()

    def _window_start(self, now: datetime) -> datetime:
        timestamp = int(now.timestamp())
        start = timestamp - (timestamp % self.settings.login_rate_limit_window_seconds)
        return datetime.fromtimestamp(start, tz=timezone.utc)

    @staticmethod
    def _key(*parts: str) -> str:
        return hashlib.sha256("\x00".join(parts).encode()).hexdigest()
