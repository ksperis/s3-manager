# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import uuid
from datetime import timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import ExternalIdentity, ExternalIdentityLinkRequest, User, UserRole
from app.services.auth_session_service import AuthSessionService
from app.utils.time import utcnow


class ExternalIdentityLinkRequiredError(ValueError):
    def __init__(self, request_id: str) -> None:
        super().__init__("External identity linking requires superadmin approval")
        self.request_id = request_id


class ExternalIdentityUserService:
    """Resolve immutable provider subjects without automatic email linking."""

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
        return self._get_or_create(
            provider_type="oidc",
            provider_id=provider,
            subject=subject,
            email=email,
            email_verified=bool(self._normalize_email(email)),
            full_name=full_name,
            picture_url=picture_url,
        )

    def get_or_create_ldap_user(
        self,
        *,
        provider: str,
        subject: str,
        email: Optional[str],
        full_name: Optional[str],
    ) -> tuple[User, bool]:
        return self._get_or_create(
            provider_type="ldap",
            provider_id=provider,
            subject=subject,
            email=email,
            email_verified=False,
            full_name=full_name,
            picture_url=None,
        )

    def list_link_requests(self, *, include_decided: bool = False) -> list[ExternalIdentityLinkRequest]:
        query = self.db.query(ExternalIdentityLinkRequest)
        if not include_decided:
            query = query.filter(
                ExternalIdentityLinkRequest.status == "pending",
                ExternalIdentityLinkRequest.expires_at > utcnow(),
            )
        return query.order_by(ExternalIdentityLinkRequest.created_at.desc()).all()

    def list_for_user(self, user_id: int, *, include_revoked: bool = False) -> list[ExternalIdentity]:
        query = self.db.query(ExternalIdentity).filter(ExternalIdentity.user_id == user_id)
        if not include_revoked:
            query = query.filter(ExternalIdentity.revoked_at.is_(None))
        return query.order_by(ExternalIdentity.created_at.asc()).all()

    def decide_link_request(
        self,
        request_id: str,
        *,
        superadmin: User,
        approve: bool,
        reason: Optional[str] = None,
    ) -> ExternalIdentityLinkRequest:
        now = utcnow()
        request = (
            self.db.query(ExternalIdentityLinkRequest)
            .filter(ExternalIdentityLinkRequest.id == request_id)
            .with_for_update()
            .first()
        )
        if not request or request.status != "pending" or request.expires_at <= now:
            raise ValueError("External identity link request is unavailable")
        request.status = "approved" if approve else "rejected"
        request.decided_at = now
        request.decided_by_user_id = superadmin.id
        request.decision_reason = (reason or "").strip() or None
        if approve:
            if self._find_mapping(
                request.provider_type,
                request.provider_id,
                request.subject,
                include_revoked=True,
            ):
                raise ValueError("External identity is already linked")
            identity = ExternalIdentity(
                id=str(uuid.uuid4()),
                user_id=request.user_id,
                provider_type=request.provider_type,
                provider_id=request.provider_id,
                subject=request.subject,
                email=request.email,
                email_verified=request.provider_type == "oidc",
                created_at=now,
            )
            user = self.db.query(User).filter(User.id == request.user_id).first()
            if not user:
                raise ValueError("Target user no longer exists")
            user.auth_version += 1
            self.db.add_all([identity, user])
        self.db.add(request)
        self.db.commit()
        if approve:
            AuthSessionService(self.db).revoke_all_for_user(
                user,
                "external_identity_changed",
                increment_version=False,
            )
        self.db.refresh(request)
        return request

    def revoke_identity(self, identity_id: str, *, reason: str = "identity_revoked") -> ExternalIdentity:
        identity = self.db.query(ExternalIdentity).filter(ExternalIdentity.id == identity_id).first()
        if not identity or identity.revoked_at is not None:
            raise ValueError("External identity not found")
        identity.revoked_at = utcnow()
        user = self.db.query(User).filter(User.id == identity.user_id).first()
        if user:
            user.auth_version += 1
            self.db.add(user)
        self.db.add(identity)
        self.db.commit()
        if user:
            AuthSessionService(self.db).revoke_all_for_user(
                user,
                reason,
                increment_version=False,
            )
        self.db.refresh(identity)
        return identity

    def _get_or_create(
        self,
        *,
        provider_type: str,
        provider_id: str,
        subject: str,
        email: Optional[str],
        email_verified: bool,
        full_name: Optional[str],
        picture_url: Optional[str],
    ) -> tuple[User, bool]:
        provider_key = str(provider_id or "").strip().lower()
        normalized_subject = str(subject or "").strip()
        if not provider_key or not normalized_subject:
            raise ValueError("External provider and subject are required")
        normalized_email = self._normalize_email(email)
        identity = self._find_mapping(provider_type, provider_key, normalized_subject, include_revoked=True)
        if identity and identity.revoked_at is not None:
            raise ValueError("External identity has been revoked")
        if identity:
            user = self.db.query(User).filter(User.id == identity.user_id).first()
            if not user:
                raise ValueError("External identity target does not exist")
            identity.last_login_at = utcnow()
            if picture_url and user.picture_url != picture_url:
                user.picture_url = picture_url
            if full_name and not user.display_name:
                user.display_name = full_name
            self.db.add_all([identity, user])
            self.db.commit()
            self.db.refresh(user)
            return user, False

        if normalized_email:
            existing = self._find_email(normalized_email)
            if existing is not None:
                request = self._create_link_request(
                    user=existing,
                    provider_type=provider_type,
                    provider_id=provider_key,
                    subject=normalized_subject,
                    email=normalized_email,
                    full_name=full_name,
                    picture_url=picture_url,
                )
                raise ExternalIdentityLinkRequiredError(request.id)

        generated_email = normalized_email or self._generated_email(provider_type, provider_key, normalized_subject)
        user = User(
            email=generated_email,
            full_name=full_name,
            display_name=full_name,
            picture_url=picture_url,
            hashed_password=None,
            is_active=True,
            role=UserRole.UI_NONE.value,
            auth_version=1,
        )
        self.db.add(user)
        self.db.flush()
        identity = ExternalIdentity(
            id=str(uuid.uuid4()),
            user_id=user.id,
            provider_type=provider_type,
            provider_id=provider_key,
            subject=normalized_subject,
            email=normalized_email,
            email_verified=email_verified,
            created_at=utcnow(),
        )
        self.db.add(identity)
        self.db.commit()
        self.db.refresh(user)
        return user, True

    def _create_link_request(
        self,
        *,
        user: User,
        provider_type: str,
        provider_id: str,
        subject: str,
        email: str,
        full_name: Optional[str],
        picture_url: Optional[str],
    ) -> ExternalIdentityLinkRequest:
        existing = self.db.query(ExternalIdentityLinkRequest).filter(
            ExternalIdentityLinkRequest.provider_type == provider_type,
            ExternalIdentityLinkRequest.provider_id == provider_id,
            ExternalIdentityLinkRequest.subject == subject,
        ).first()
        now = utcnow()
        if existing:
            if existing.status == "pending" and existing.expires_at > now:
                return existing
            existing.status = "pending"
            existing.created_at = now
            existing.expires_at = now + timedelta(hours=24)
            existing.decided_at = None
            existing.decided_by_user_id = None
            existing.decision_reason = None
            request = existing
        else:
            request = ExternalIdentityLinkRequest(
                id=str(uuid.uuid4()),
                user_id=user.id,
                provider_type=provider_type,
                provider_id=provider_id,
                subject=subject,
                email=email,
                display_name=full_name,
                picture_url=picture_url,
                status="pending",
                created_at=now,
                expires_at=now + timedelta(hours=24),
            )
        self.db.add(request)
        self.db.commit()
        self.db.refresh(request)
        return request

    def _find_mapping(
        self,
        provider_type: str,
        provider_id: str,
        subject: str,
        *,
        include_revoked: bool = False,
    ) -> ExternalIdentity | None:
        query = self.db.query(ExternalIdentity).filter(
            ExternalIdentity.provider_type == provider_type,
            ExternalIdentity.provider_id == provider_id,
            ExternalIdentity.subject == subject,
        )
        if not include_revoked:
            query = query.filter(ExternalIdentity.revoked_at.is_(None))
        return query.first()

    def _find_email(self, email: str) -> User | None:
        return self.db.query(User).filter(func.lower(User.email) == email).first()

    @staticmethod
    def _normalize_email(email: Optional[str]) -> Optional[str]:
        return str(email or "").strip().lower() or None

    @staticmethod
    def _generated_email(provider_type: str, provider: str, subject: str) -> str:
        digest = hashlib.sha256(f"{provider_type}:{provider}:{subject}".encode()).hexdigest()[:16]
        return f"{provider_type}-{provider}-{digest}@identity.local"
