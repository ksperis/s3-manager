# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import hashlib
import logging
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import User, UserRole


logger = logging.getLogger(__name__)


class ExternalIdentityUserService:
    """Reconcile OIDC and LDAP identities with canonical UI users."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def get_or_create_oidc_user(
        self,
        *,
        provider: str,
        subject: str,
        email: Optional[str],
        full_name: Optional[str],
        picture_url: Optional[str],
    ) -> tuple[User, bool]:
        normalized_provider = str(provider or "").strip().lower()
        normalized_subject = str(subject or "").strip()
        if not normalized_provider or not normalized_subject:
            raise ValueError("OIDC provider and subject are required")
        normalized_email = self._normalize_email(email)
        existing = self._find_mapping(
            normalized_provider,
            normalized_subject,
        )
        if existing is not None:
            changed = self._set_display_name_if_unset(existing, full_name)
            if picture_url and existing.picture_url != picture_url:
                existing.picture_url = picture_url
                changed = True
            if changed:
                self._save(existing)
            return existing, False

        if normalized_email:
            user = self._find_email(normalized_email)
            if user is not None:
                self._require_compatible_mapping(
                    user,
                    normalized_provider,
                    normalized_subject,
                )
                user.auth_provider = normalized_provider
                user.auth_provider_subject = normalized_subject
                self._set_display_name_if_missing(user, full_name)
                if picture_url:
                    user.picture_url = picture_url
                self._save(user)
                logger.debug(
                    "Linked local user id=%s to OIDC provider=%s",
                    user.id,
                    normalized_provider,
                )
                return user, False

        generated_email = (
            normalized_email
            or f"{normalized_provider}-{normalized_subject}@oidc.local"
        )
        user = self._create_user(
            email=generated_email,
            full_name=full_name,
            picture_url=picture_url,
            provider=normalized_provider,
            subject=normalized_subject,
        )
        logger.debug(
            "Created OIDC user id=%s provider=%s",
            user.id,
            normalized_provider,
        )
        return user, True

    def get_or_create_ldap_user(
        self,
        *,
        provider: str,
        subject: str,
        email: Optional[str],
        full_name: Optional[str],
        allow_email_linking: bool = False,
    ) -> tuple[User, bool]:
        provider_name = str(provider or "").strip().lower()
        normalized_provider = f"ldap:{provider_name}"
        normalized_subject = str(subject or "").strip()
        if not provider_name:
            raise ValueError("LDAP provider is required")
        if not normalized_subject:
            raise ValueError("LDAP subject is required")
        normalized_email = self._normalize_email(email)
        existing = self._find_mapping(
            normalized_provider,
            normalized_subject,
        )
        if existing is not None:
            changed = False
            if normalized_email and normalized_email != existing.email:
                other = self._find_email(normalized_email)
                if other is not None and other.id != existing.id:
                    raise ValueError("Email already in use by another account")
                existing.email = normalized_email
                changed = True
            changed = self._set_display_name_if_unset(
                existing,
                full_name,
            ) or changed
            if changed:
                self._save(existing)
            return existing, False

        if normalized_email:
            user = self._find_email(normalized_email)
            if user is not None:
                if not allow_email_linking:
                    raise ValueError("Email already in use by another account")
                self._require_compatible_mapping(
                    user,
                    normalized_provider,
                    normalized_subject,
                )
                user.auth_provider = normalized_provider
                user.auth_provider_subject = normalized_subject
                self._set_display_name_if_missing(user, full_name)
                self._save(user)
                logger.debug(
                    "Linked local user id=%s to LDAP provider=%s",
                    user.id,
                    normalized_provider,
                )
                return user, False

        generated_email = normalized_email or self._generated_ldap_email(
            provider_name,
            normalized_subject,
        )
        user = self._create_user(
            email=generated_email,
            full_name=full_name,
            picture_url=None,
            provider=normalized_provider,
            subject=normalized_subject,
        )
        logger.debug(
            "Created LDAP user id=%s provider=%s",
            user.id,
            normalized_provider,
        )
        return user, True

    def _find_mapping(self, provider: str, subject: str) -> User | None:
        return (
            self.db.query(User)
            .filter(
                User.auth_provider == provider,
                User.auth_provider_subject == subject,
            )
            .first()
        )

    def _find_email(self, email: str) -> User | None:
        return (
            self.db.query(User)
            .filter(func.lower(User.email) == email)
            .first()
        )

    @staticmethod
    def _normalize_email(email: Optional[str]) -> Optional[str]:
        return str(email or "").strip().lower() or None

    @staticmethod
    def _set_display_name_if_unset(
        user: User,
        full_name: Optional[str],
    ) -> bool:
        if full_name and user.display_name != full_name and not user.full_name:
            user.display_name = full_name
            return True
        return False

    @staticmethod
    def _set_display_name_if_missing(
        user: User,
        full_name: Optional[str],
    ) -> bool:
        if full_name and not user.display_name:
            user.display_name = full_name
            return True
        return False

    @staticmethod
    def _require_compatible_mapping(
        user: User,
        provider: str,
        subject: str,
    ) -> None:
        if user.auth_provider and (
            user.auth_provider != provider
            or user.auth_provider_subject != subject
        ):
            raise ValueError("Email already linked to another external identity")

    def _create_user(
        self,
        *,
        email: str,
        full_name: Optional[str],
        picture_url: Optional[str],
        provider: str,
        subject: str,
    ) -> User:
        user = User(
            email=email,
            full_name=full_name,
            display_name=full_name,
            picture_url=picture_url,
            hashed_password=None,
            is_active=True,
            role=UserRole.UI_NONE.value,
            auth_provider=provider,
            auth_provider_subject=subject,
        )
        self._save(user)
        return user

    def _save(self, user: User) -> None:
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)

    @staticmethod
    def _generated_ldap_email(provider: str, subject: str) -> str:
        digest = hashlib.sha256(f"{provider}:{subject}".encode()).hexdigest()[:16]
        return f"ldap-{provider}-{digest}@ldap.local"
