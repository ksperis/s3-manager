# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.utils.time import utcnow

import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, hash_refresh_token
from app.db import ApiToken, User, is_admin_ui_role

settings = get_settings()


class ApiTokenError(ValueError):
    pass


class ApiTokenNotFoundError(ApiTokenError):
    pass


class ApiTokenService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create_for_user(
        self,
        user: User,
        *,
        name: str,
        expires_in_days: Optional[int] = None,
    ) -> tuple[str, ApiToken]:
        if not is_admin_ui_role(user.role):
            raise ApiTokenError("Only UI admins can create API tokens")
        if user.id is None:
            raise ApiTokenError("User id is required to create API tokens")
        token_name = (name or "").strip()
        if not token_name:
            raise ApiTokenError("Token name is required")
        days = expires_in_days or settings.api_token_default_expire_days
        if days < 1 or days > settings.api_token_max_expire_days:
            raise ApiTokenError(
                f"Token expiry must be between 1 and {settings.api_token_max_expire_days} days",
            )
        now = utcnow()
        expires_at = now + timedelta(days=days)
        jti = uuid.uuid4().hex
        token = create_access_token(
            data={
                "sub": user.email,
                "uid": user.id,
                "role": user.role,
                "auth_type": "api_token",
                "typ": "api_admin",
                "jti": jti,
            },
            expires_delta=expires_at - now,
        )
        row = ApiToken(
            id=str(uuid.uuid4()),
            jti=jti,
            token_hash=hash_refresh_token(token),
            user_id=user.id,
            name=token_name,
            created_at=now,
            expires_at=expires_at,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return token, row

    def list_for_user(self, user_id: int, *, include_revoked: bool = False) -> list[ApiToken]:
        query = self.db.query(ApiToken).filter(ApiToken.user_id == user_id)
        if not include_revoked:
            query = query.filter(
                ApiToken.revoked_at.is_(None),
                ApiToken.expires_at > utcnow(),
            )
        return query.order_by(ApiToken.created_at.desc()).all()

    def revoke_for_user(self, *, user_id: int, token_id: str) -> ApiToken:
        row = (
            self.db.query(ApiToken)
            .filter(
                ApiToken.id == token_id,
                ApiToken.user_id == user_id,
            )
            .first()
        )
        if not row:
            raise ApiTokenNotFoundError("API token not found")
        if row.revoked_at is None:
            row.revoked_at = utcnow()
            self.db.add(row)
            self.db.commit()
            self.db.refresh(row)
        return row

    def resolve_user_from_claims(self, claims: dict) -> Optional[User]:
        token_type = claims.get("typ")
        auth_type = claims.get("auth_type")
        if token_type != "api_admin" and auth_type != "api_token":
            return None
        jti = claims.get("jti")
        uid = claims.get("uid")
        if not isinstance(jti, str) or not jti:
            return None
        try:
            user_id = int(uid)
        except (TypeError, ValueError):
            return None
        row = self.db.query(ApiToken).filter(ApiToken.jti == jti).first()
        if not row:
            return None
        now = utcnow()
        if row.revoked_at is not None or row.expires_at <= now:
            return None
        if row.user_id != user_id:
            return None
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_active or not is_admin_ui_role(user.role):
            return None
        row.last_used_at = now
        self.db.add(row)
        self.db.commit()
        return user
