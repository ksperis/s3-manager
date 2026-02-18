# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import hashlib
import json
import logging
import uuid
from datetime import datetime
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.core.security import decrypt_secret, encrypt_secret
from app.db import RgwSession, UserRole
from app.models.session import ManagerSessionPrincipal, SessionCapabilities

from app.services import s3_client
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_iam import get_iam_client

logger = logging.getLogger(__name__)


class SessionIntrospectionError(RuntimeError):
    pass


class SessionService:
    def __init__(self, db):
        self.db = db

    # public API
    def create_session(
        self,
        *,
        access_key: str,
        secret_key: str,
        actor_type: str,
        account_id: Optional[str],
        account_name: Optional[str],
        user_uid: Optional[str],
        capabilities: SessionCapabilities,
    ) -> ManagerSessionPrincipal:
        self._cleanup_existing_sessions(access_key)

        session = RgwSession(
            id=str(uuid.uuid4()),
            access_key_enc=encrypt_secret(access_key),
            secret_key_enc=encrypt_secret(secret_key),
            access_key_hash=self._hash_key(access_key),
            actor_type=actor_type,
            role=UserRole.UI_USER.value,
            account_id=account_id,
            account_name=account_name,
            user_uid=user_uid,
            capabilities=capabilities.model_dump_json(),
            can_manage_iam=capabilities.can_manage_iam,
            can_manage_buckets=capabilities.can_manage_buckets,
            can_view_traffic=capabilities.can_view_traffic,
            created_at=datetime.utcnow(),
            last_used_at=datetime.utcnow(),
        )
        self.db.add(session)
        self.db.commit()
        return self._to_principal(session)

    def get_principal(self, session_id: str) -> Optional[ManagerSessionPrincipal]:
        session = self.db.query(RgwSession).filter(RgwSession.id == session_id).first()
        if not session:
            return None
        session.last_used_at = datetime.utcnow()
        self.db.add(session)
        self.db.commit()
        return self._to_principal(session)

    def introspect_credentials(
        self,
        access_key: str,
        secret_key: str,
        endpoint: Optional[str] = None,
    ) -> tuple[str, Optional[str], Optional[str], Optional[str], SessionCapabilities]:
        if not endpoint:
            raise SessionIntrospectionError("S3 endpoint is required")
        raw_client = s3_client.get_s3_client(access_key, secret_key, endpoint=endpoint)
        try:
            raw = raw_client.list_buckets()
        except (BotoCoreError, ClientError) as exc:
            raise SessionIntrospectionError(f"Unable to validate access keys: {exc}") from exc
        owner = raw.get("Owner") or {}
        owner_id = owner.get("ID") or owner.get("Id")
        account_name = owner.get("DisplayName") or owner.get("display_name")
        user_info = self._fetch_admin_identity(access_key, secret_key, endpoint=endpoint)
        actor_type = "account_user"
        account_id = owner_id
        user_uid = None
        if user_info:
            account_id = (
                user_info.get("account_id")
                or user_info.get("account")
                or user_info.get("tenant")
                or account_id
            )
            user_uid = user_info.get("user_id") or user_info.get("uid") or user_info.get("display_name")
            account_name = user_info.get("account_name") or account_name
            if str(user_info.get("account_root")).lower() in {"true", "1", "yes"}:
                actor_type = "account_root"
        iam_full_access = self._probe_iam_manage(access_key, secret_key, endpoint=endpoint)
        capabilities = self._derive_capabilities(actor_type, user_info, iam_full_access)
        return actor_type, account_id, account_name, user_uid, capabilities

    # helpers
    def _cleanup_existing_sessions(self, access_key: str) -> None:
        hashed = self._hash_key(access_key)
        existing = self.db.query(RgwSession).filter(RgwSession.access_key_hash == hashed).all()
        for row in existing:
            self.db.delete(row)
        if existing:
            self.db.commit()

    def _fetch_admin_identity(self, access_key: str, secret_key: str, endpoint: Optional[str] = None) -> Optional[dict]:
        try:
            client = RGWAdminClient(access_key=access_key, secret_key=secret_key, endpoint=endpoint)
            data = client.get_user_by_access_key(access_key, allow_not_found=True)
            if data and data.get("not_found"):
                return None
            return data
        except RGWAdminError as exc:
            logger.debug("RGW admin lookup failed for key %s: %s", access_key, exc)
            return None

    def _derive_capabilities(self, actor_type: str, user_info: Optional[dict], iam_full_access: bool) -> SessionCapabilities:
        can_manage_iam = actor_type == "account_root" or iam_full_access
        can_view_traffic = actor_type == "account_root"
        can_manage_buckets = True
        return SessionCapabilities(
            can_manage_iam=can_manage_iam,
            can_manage_buckets=can_manage_buckets,
            can_view_traffic=can_view_traffic,
        )

    def _to_principal(self, session: RgwSession) -> ManagerSessionPrincipal:
        capabilities = self._capabilities_from_row(session)
        access_key = decrypt_secret(session.access_key_enc)
        secret_key = decrypt_secret(session.secret_key_enc)
        email = f"rgw:{session.account_id or 'session'}"
        return ManagerSessionPrincipal(
            session_id=session.id,
            access_key=access_key,
            secret_key=secret_key,
            actor_type=session.actor_type,
            account_id=session.account_id,
            account_name=session.account_name,
            user_uid=session.user_uid,
            capabilities=capabilities,
            role=session.role,
            email=email,
            id=None,
        )

    def _capabilities_from_row(self, session: RgwSession) -> SessionCapabilities:
        raw = session.capabilities
        if not raw:
            return SessionCapabilities(
                can_manage_iam=session.can_manage_iam,
                can_manage_buckets=session.can_manage_buckets,
                can_view_traffic=session.can_view_traffic,
            )
        try:
            data = json.loads(raw)
            return SessionCapabilities(**data)
        except (TypeError, ValueError):
            return SessionCapabilities(
                can_manage_iam=session.can_manage_iam,
                can_manage_buckets=session.can_manage_buckets,
                can_view_traffic=session.can_view_traffic,
            )

    def _hash_key(self, access_key: str) -> str:
        return hashlib.sha256(access_key.encode()).hexdigest()

    def _probe_iam_manage(self, access_key: str, secret_key: str, endpoint: Optional[str] = None) -> bool:
        try:
            client = get_iam_client(access_key, secret_key, endpoint=endpoint)
            client.list_users(MaxItems=1)
            return True
        except (ClientError, BotoCoreError, RuntimeError):
            return False
