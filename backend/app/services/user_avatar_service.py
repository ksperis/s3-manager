# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import re
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.db import (
    AccountRole,
    UiGroupS3Account,
    User,
    UserS3Account,
    UserUiGroup,
    is_admin_ui_role,
)
from app.models.user import UserAvatar, UserAvatarPreference
from app.services.avatar_image_service import (
    ALLOWED_AVATAR_CONTENT_TYPES,
    MAX_AVATAR_BYTES,
    validate_avatar_image,
)
from app.utils.time import utcnow


PORTAL_ACCOUNT_ROLES = {
    AccountRole.PORTAL_USER.value,
    AccountRole.PORTAL_MANAGER.value,
    AccountRole.ACCOUNT_ADMINISTRATOR.value,
}


def _remote_picture_url(value: object) -> str | None:
    candidate = str(value or "").strip()
    if not candidate:
        return None
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return candidate


def _avatar_initials(user: User) -> str:
    label = str(user.display_name or user.full_name or "").strip()
    if label:
        parts = [part for part in re.split(r"[^\w]+", label, flags=re.UNICODE) if part]
        if len(parts) >= 2:
            return f"{parts[0][0]}{parts[-1][0]}".upper()
        if parts:
            return parts[0][:2].upper()
    local_part = str(user.email or "user").split("@", 1)[0]
    email_parts = [part for part in re.split(r"[^\w]+", local_part, flags=re.UNICODE) if part]
    if len(email_parts) >= 2:
        return f"{email_parts[0][0]}{email_parts[-1][0]}".upper()
    return (email_parts[0][:2] if email_parts else "U").upper()


def _gravatar_url(email: str) -> str:
    normalized = str(email or "").strip().lower().encode("utf-8")
    digest = hashlib.sha256(normalized).hexdigest()
    return f"https://gravatar.com/avatar/{digest}?s=160&d=404&r=g"


class UserAvatarService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def descriptor(self, user: User) -> UserAvatar:
        preference = str(user.avatar_preference or "auto")
        if preference not in {"auto", "uploaded", "gravatar", "initials"}:
            preference = "auto"
        initials = _avatar_initials(user)
        uploaded_available = bool(user.avatar_image and user.avatar_content_type in ALLOWED_AVATAR_CONTENT_TYPES)
        provider_url = _remote_picture_url(user.picture_url)

        if preference == "initials":
            return UserAvatar(preference="initials", source="initials", initials=initials)
        if preference == "gravatar":
            return UserAvatar(
                preference="gravatar",
                source="gravatar",
                url=_gravatar_url(user.email),
                initials=initials,
            )
        if preference == "uploaded" and uploaded_available:
            return self._uploaded_descriptor(user, preference="uploaded", initials=initials)
        if preference == "auto" and uploaded_available:
            return self._uploaded_descriptor(user, preference="auto", initials=initials)
        if preference == "auto" and provider_url:
            return UserAvatar(
                preference="auto",
                source="provider",
                url=provider_url,
                initials=initials,
                updated_at=user.avatar_updated_at,
            )
        return UserAvatar(
            preference="auto" if preference == "uploaded" else preference,
            source="gravatar",
            url=_gravatar_url(user.email),
            initials=initials,
            updated_at=user.avatar_updated_at,
        )

    def _uploaded_descriptor(
        self,
        user: User,
        *,
        preference: UserAvatarPreference,
        initials: str,
    ) -> UserAvatar:
        version = int(user.avatar_updated_at.timestamp()) if user.avatar_updated_at else 0
        return UserAvatar(
            preference=preference,
            source="uploaded",
            url=f"/users/{user.id}/avatar?v={version}",
            initials=initials,
            updated_at=user.avatar_updated_at,
        )

    def set_preference(self, user: User, preference: UserAvatarPreference) -> None:
        if preference == "uploaded" and not user.avatar_image:
            raise ValueError("Upload a profile image before selecting it.")
        user.avatar_preference = preference

    def store_uploaded_image(self, user: User, payload: bytes, content_type: str | None) -> None:
        detected_type = validate_avatar_image(payload, content_type)
        user.avatar_image = payload
        user.avatar_content_type = detected_type
        user.avatar_preference = "uploaded"
        user.avatar_updated_at = utcnow()
        self._persist(user)

    def remove_uploaded_image(self, user: User) -> None:
        user.avatar_image = None
        user.avatar_content_type = None
        user.avatar_updated_at = utcnow()
        if user.avatar_preference == "uploaded":
            user.avatar_preference = "auto"
        self._persist(user)

    def _persist(self, user: User) -> None:
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)

    def image_for_viewer(self, viewer: User, target_user_id: int) -> tuple[bytes, str, str]:
        target = self.db.query(User).filter(User.id == target_user_id, User.is_active.is_(True)).first()
        if target is None or not target.avatar_image or target.avatar_content_type not in ALLOWED_AVATAR_CONTENT_TYPES:
            raise ValueError("Avatar not found.")
        if not self._can_view(viewer, target):
            raise ValueError("Avatar not found.")
        version = str(int(target.avatar_updated_at.timestamp()) if target.avatar_updated_at else 0)
        return bytes(target.avatar_image), str(target.avatar_content_type), version

    def _can_view(self, viewer: User, target: User) -> bool:
        if viewer.id == target.id or is_admin_ui_role(viewer.role):
            return True
        return bool(self._portal_account_ids(viewer.id) & self._portal_account_ids(target.id))

    def _portal_account_ids(self, user_id: int) -> set[int]:
        direct_rows = (
            self.db.query(UserS3Account.account_id)
            .filter(
                UserS3Account.user_id == user_id,
                UserS3Account.role.in_(PORTAL_ACCOUNT_ROLES),
            )
            .all()
        )
        group_rows = (
            self.db.query(UiGroupS3Account.account_id)
            .join(UserUiGroup, UserUiGroup.group_id == UiGroupS3Account.group_id)
            .filter(
                UserUiGroup.user_id == user_id,
                UiGroupS3Account.role.in_(PORTAL_ACCOUNT_ROLES),
            )
            .all()
        )
        return {account_id for (account_id,) in [*direct_rows, *group_rows]}
