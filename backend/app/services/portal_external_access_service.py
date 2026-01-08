# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.db_models import AccessGrant, IamIdentity, S3Account, StorageEndpoint, User
from app.models.portal_access import PortalExternalAccessCredentials, PortalExternalAccessKey, PortalExternalAccessStatus, PortalAccessGrant
from app.services.rgw_iam import RGWIAMService, get_iam_service
from app.utils.s3_endpoint import resolve_s3_endpoint


logger = logging.getLogger(__name__)


class PortalExternalAccessService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def _account_root_credentials(self, account: S3Account) -> tuple[str, str]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("Account is missing root credentials")
        return access_key, secret_key

    def _iam(self, account: S3Account) -> RGWIAMService:
        access_key, secret_key = self._account_root_credentials(account)
        return get_iam_service(access_key, secret_key, endpoint=resolve_s3_endpoint(account))

    def _external_username(self, account: S3Account, user: User) -> str:
        base = f"ptl-{account.id}-{user.id}"
        return base[:63]

    def _get_identity(self, account_id: int, user_id: int) -> Optional[IamIdentity]:
        return (
            self.db.query(IamIdentity)
            .filter(IamIdentity.account_id == account_id, IamIdentity.user_id == user_id)
            .first()
        )

    def _ensure_identity(self, account: S3Account, user: User) -> IamIdentity:
        identity = self._get_identity(account.id, user.id)
        if identity:
            if not identity.iam_username:
                identity.iam_username = self._external_username(account, user)
            if identity.is_enabled is False:
                identity.is_enabled = True
            self.db.add(identity)
            self.db.commit()
            self.db.refresh(identity)
            return identity
        identity = IamIdentity(
            user_id=user.id,
            account_id=account.id,
            iam_username=self._external_username(account, user),
            is_enabled=True,
        )
        self.db.add(identity)
        self.db.commit()
        self.db.refresh(identity)
        return identity

    def get_status(self, account: S3Account, user: User, endpoint: StorageEndpoint) -> PortalExternalAccessStatus:
        identity = self._get_identity(account.id, user.id)
        allow_external_access = bool(getattr(endpoint, "allow_external_access", False))
        allowed_packages = getattr(endpoint, "allowed_packages", None)
        if not isinstance(allowed_packages, list):
            allowed_packages = []

        keys: list[PortalExternalAccessKey] = []
        grants: list[PortalAccessGrant] = []
        if identity and identity.is_enabled and identity.iam_username:
            try:
                iam = self._iam(account)
                for key in iam.list_access_keys(identity.iam_username):
                    keys.append(
                        PortalExternalAccessKey(
                            access_key_id=key.access_key_id,
                            status=key.status,
                            created_at=key.created_at,
                            is_active=bool(identity.active_access_key_id and key.access_key_id == identity.active_access_key_id),
                        )
                    )
            except Exception as exc:
                logger.info("Unable to list portal external keys for %s: %s", identity.iam_username, exc)
            grant_rows = (
                self.db.query(AccessGrant)
                .join(IamIdentity, IamIdentity.id == AccessGrant.iam_identity_id)
                .filter(IamIdentity.account_id == account.id, IamIdentity.user_id == user.id)
                .all()
            )
            for grant in grant_rows:
                grants.append(
                    PortalAccessGrant(
                        id=grant.id,
                        user_id=user.id,
                        package_key=grant.package_key,
                        bucket=grant.bucket,
                        prefix=grant.prefix,
                        materialization_status=grant.materialization_status,
                        materialization_error=grant.materialization_error,
                    )
                )

        return PortalExternalAccessStatus(
            allow_external_access=allow_external_access,
            external_enabled=bool(identity and identity.is_enabled and identity.iam_username),
            iam_username=identity.iam_username if identity else None,
            active_access_key_id=identity.active_access_key_id if identity else None,
            keys=keys,
            grants=grants,
            allowed_packages=[p for p in allowed_packages if isinstance(p, str) and p.strip()],
        )

    def enable_external_access(self, account: S3Account, user: User, endpoint: StorageEndpoint) -> PortalExternalAccessCredentials:
        if not getattr(endpoint, "allow_external_access", False):
            raise RuntimeError("External access is disabled for this endpoint")

        identity = self._ensure_identity(account, user)
        iam = self._iam(account)

        iam_username = identity.iam_username
        if not iam_username:
            raise RuntimeError("IAM username is missing for this identity")

        iam_user, _ = iam.create_user(iam_username, create_key=False, allow_existing=True)
        identity.iam_user_id = iam_user.user_id
        identity.arn = iam_user.arn

        # Rotate existing keys (keep at most one active key).
        existing = iam.list_access_keys(iam_username)
        if len(existing) >= 2:
            for key in existing:
                iam.delete_access_key(iam_username, key.access_key_id)
            existing = []

        new_key = iam.create_access_key(iam_username)
        for key in existing:
            if key.access_key_id != new_key.access_key_id:
                iam.delete_access_key(iam_username, key.access_key_id)

        identity.active_access_key_id = new_key.access_key_id
        identity.is_enabled = True
        self.db.add(identity)
        self.db.commit()
        self.db.refresh(identity)

        if not new_key.secret_access_key:
            raise RuntimeError("IAM did not return a secret access key")
        return PortalExternalAccessCredentials(
            iam_username=iam_username,
            access_key_id=new_key.access_key_id,
            secret_access_key=new_key.secret_access_key,
            created_at=new_key.created_at,
        )

    def rotate_access_key(self, account: S3Account, user: User) -> PortalExternalAccessCredentials:
        identity = self._get_identity(account.id, user.id)
        if not identity or not identity.is_enabled or not identity.iam_username:
            raise RuntimeError("External access is not enabled")
        iam = self._iam(account)
        iam_username = identity.iam_username
        keys = iam.list_access_keys(iam_username)

        # Ensure we can create a new key (max 2).
        if len(keys) >= 2:
            keep = identity.active_access_key_id
            for key in keys:
                if keep and key.access_key_id == keep:
                    continue
                iam.delete_access_key(iam_username, key.access_key_id)
            keys = iam.list_access_keys(iam_username)
            if len(keys) >= 2:
                for key in keys:
                    iam.delete_access_key(iam_username, key.access_key_id)

        new_key = iam.create_access_key(iam_username)
        for key in iam.list_access_keys(iam_username):
            if key.access_key_id != new_key.access_key_id:
                iam.delete_access_key(iam_username, key.access_key_id)

        identity.active_access_key_id = new_key.access_key_id
        self.db.add(identity)
        self.db.commit()
        self.db.refresh(identity)

        if not new_key.secret_access_key:
            raise RuntimeError("IAM did not return a secret access key")
        return PortalExternalAccessCredentials(
            iam_username=iam_username,
            access_key_id=new_key.access_key_id,
            secret_access_key=new_key.secret_access_key,
            created_at=new_key.created_at,
        )

    def revoke_access(self, account: S3Account, user: User) -> None:
        identity = self._get_identity(account.id, user.id)
        if not identity or not identity.iam_username:
            return
        iam = self._iam(account)
        for key in iam.list_access_keys(identity.iam_username):
            iam.delete_access_key(identity.iam_username, key.access_key_id)
        identity.active_access_key_id = None
        identity.is_enabled = False
        self.db.add(identity)
        self.db.commit()


def get_portal_external_access_service(db: Session) -> PortalExternalAccessService:
    return PortalExternalAccessService(db)

