# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *
from app.services.mappers.portal import portal_access_key_from_external_credential, portal_access_key_from_iam_metadata


class PortalAccessKeysMixin:
    def list_access_keys(self, user: User, access: "AccountAccess") -> list[PortalAccessKey]:
        keys: list[PortalAccessKey] = []
        link = self._existing_portal_link(user, access.account)
        if link and link.iam_username:
            iam_service = self._get_iam_service(access.account)
            if iam_service.get_user(link.iam_username):
                keys.extend(self._list_access_keys(link, iam_service, include_portal=False))
        keys.extend(self._list_external_access_keys(user, access.account))
        return keys

    def get_access_keys_state(self, user: User, access: "AccountAccess") -> PortalAccessKeysState:
        portal_settings = self._effective_portal_settings(access.account)
        link = self._existing_portal_link(user, access.account)
        iam_user = None
        access_keys: list[PortalAccessKey] = []
        if link and link.iam_username:
            iam_service = self._get_iam_service(access.account)
            iam_user = iam_service.get_user(link.iam_username)
            if iam_user:
                access_keys = self._list_access_keys(link, iam_service, include_portal=False)
        access_keys.extend(self._list_external_access_keys(user, access.account))
        return PortalAccessKeysState(
            iam_user=PortalIAMUser(
                iam_user_id=link.iam_user_id if link else None,
                iam_username=link.iam_username if link else None,
                arn=iam_user.arn if iam_user else None,
                created_at=link.created_at if link else None,
            ),
            s3_endpoint=resolve_s3_endpoint(access.account),
            access_keys=access_keys,
            can_manage_access_keys=portal_settings.allow_portal_user_access_key_create,
            max_access_keys=portal_settings.max_portal_user_access_keys,
        )

    def _active_external_access_key_count(self, user: User, account: S3Account) -> int:
        return (
            self.db.query(PortalExternalAccessCredential)
            .filter(
                PortalExternalAccessCredential.account_id == account.id,
                PortalExternalAccessCredential.created_by_user_id == user.id,
                PortalExternalAccessCredential.revoked_at.is_(None),
            )
            .count()
        )

    def _list_external_credentials(
        self,
        user: User,
        account: S3Account,
    ) -> list[PortalExternalAccessCredential]:
        return (
            self.db.query(PortalExternalAccessCredential)
            .filter(
                PortalExternalAccessCredential.account_id == account.id,
                PortalExternalAccessCredential.created_by_user_id == user.id,
                PortalExternalAccessCredential.revoked_at.is_(None),
            )
            .order_by(PortalExternalAccessCredential.created_at.desc(), PortalExternalAccessCredential.id.desc())
            .all()
        )

    def _list_external_access_keys(self, user: User, account: S3Account) -> list[PortalAccessKey]:
        keys: list[PortalAccessKey] = []
        for credential in self._list_external_credentials(user, account):
            metadata = credential.storage_space
            keys.append(
                portal_access_key_from_external_credential(
                    credential,
                    storage_space_name=self._display_storage_space_name(credential.bucket_name, metadata),
                )
            )
        return keys

    def _find_external_credential(
        self,
        user: User,
        account: S3Account,
        access_key_id: str,
    ) -> Optional[PortalExternalAccessCredential]:
        return (
            self.db.query(PortalExternalAccessCredential)
            .filter(
                PortalExternalAccessCredential.account_id == account.id,
                PortalExternalAccessCredential.created_by_user_id == user.id,
                PortalExternalAccessCredential.access_key_id == access_key_id,
                PortalExternalAccessCredential.revoked_at.is_(None),
            )
            .first()
        )

    def _ensure_access_key_management_allowed(self, access: "AccountAccess") -> PortalSettings:
        portal_settings = self._effective_portal_settings(access.account)
        if not portal_settings.allow_portal_user_access_key_create:
            raise PortalAccessKeyManagementDisabled("Portal access-key management is disabled for this account.")
        return portal_settings

    def _personal_access_key_count(self, user: User, account: S3Account, iam_service: RGWIAMService) -> int:
        link = self._existing_portal_link(user, account)
        if not link or not link.iam_username:
            return 0
        if not iam_service.get_user(link.iam_username):
            return 0
        return len(self._list_access_keys(link, iam_service, include_portal=False))

    def _ensure_user_access_key_limit(
        self,
        *,
        user: User,
        access: "AccountAccess",
        portal_settings: PortalSettings,
        personal_key_count: int,
    ) -> None:
        total_keys = personal_key_count + self._active_external_access_key_count(user, access.account)
        if total_keys >= portal_settings.max_portal_user_access_keys:
            raise PortalAccessKeyLimitExceeded(
                f"Maximum IAM user keys reached ({portal_settings.max_portal_user_access_keys}). Delete a key before creating a new one."
            )

    def create_access_key(
        self,
        user: User,
        access: "AccountAccess",
        payload: Optional[PortalAccessKeyCreate] = None,
    ) -> PortalAccessKey:
        request = payload or PortalAccessKeyCreate()
        if request.target_type == "external":
            return self.create_external_access_key(user, access, request)
        return self.create_personal_access_key(user, access)

    def create_personal_access_key(self, user: User, access: "AccountAccess") -> PortalAccessKey:
        portal_settings = self._effective_portal_settings(access.account)
        if not portal_settings.allow_portal_user_access_key_create:
            raise PortalAccessKeyManagementDisabled("Portal access-key management is disabled for this account.")
        iam_service = self._get_iam_service(access.account)
        link, _, _ = self._ensure_portal_user(user, access.account, iam_service)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        existing_user_keys = self._list_access_keys(link, iam_service, include_portal=False)
        self._ensure_user_access_key_limit(
            user=user,
            access=access,
            portal_settings=portal_settings,
            personal_key_count=len(existing_user_keys),
        )
        new_key = iam_service.create_access_key(link.iam_username)
        return portal_access_key_from_iam_metadata(
            new_key,
            is_portal=False,
            deletable=True,
            secret_access_key=new_key.secret_access_key,
        )

    def _external_username(self, account: S3Account, metadata: PortalStorageSpaceMetadata, external_email: str) -> str:
        local_part = external_email.split("@", 1)[0]
        slug = re.sub(r"[^a-z0-9-]+", "-", local_part.strip().lower())
        slug = re.sub(r"-+", "-", slug).strip("-") or "external"
        token = secrets.token_hex(4)
        return f"portal-ext-{account.id}-{metadata.id}-{slug[:24]}-{token}"[:63]

    def _external_permission_role(self, permission: Optional[str]) -> PortalStorageSpaceRole:
        if permission == "read_write":
            return "Editor"
        return "Viewer"

    def _external_access_policy(self, bucket_name: str, permission: Optional[str]) -> dict:
        role = self._external_permission_role(permission)
        return {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "PortalExternalStorageSpace",
                    "Effect": "Allow",
                    "Action": self._storage_space_role_actions(role),
                    "Resource": self._bucket_arns(bucket_name),
                }
            ],
        }

    def _validate_external_access_key_request(
        self,
        user: User,
        access: "AccountAccess",
        payload: PortalAccessKeyCreate,
    ) -> tuple[PortalStorageSpaceMetadata, str, str]:
        if payload.target_type != "external":
            raise RuntimeError("External credential payload required.")
        storage_space_id = (payload.storage_space_id or "").strip()
        if not storage_space_id:
            raise RuntimeError("Storage Space is required for external credentials.")
        external_email = (payload.external_email or "").strip()
        if not external_email:
            raise RuntimeError("External user label is required.")
        bucket_name = self._resolve_storage_space_bucket_name(user, access, storage_space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        self._require_storage_space_content_owner(user, access, bucket_name)
        metadata = self._require_storage_space_active(access.account, bucket_name)
        if metadata is None:
            raise RuntimeError("Storage space metadata is missing.")
        permission = payload.permission if payload.permission in {"read_only", "read_write"} else "read_only"
        return metadata, external_email, permission

    def create_external_access_key(
        self,
        user: User,
        access: "AccountAccess",
        payload: PortalAccessKeyCreate,
    ) -> PortalAccessKey:
        portal_settings = self._ensure_access_key_management_allowed(access)
        metadata, external_email, permission = self._validate_external_access_key_request(user, access, payload)
        iam_service = self._get_iam_service(access.account)
        self._ensure_user_access_key_limit(
            user=user,
            access=access,
            portal_settings=portal_settings,
            personal_key_count=self._personal_access_key_count(user, access.account, iam_service),
        )
        iam_username = self._external_username(access.account, metadata, external_email)
        iam_user: Optional[IAMUser] = None
        new_key: Optional[ModelAccessKey] = None
        try:
            iam_user, _ = iam_service.create_user(iam_username, create_key=False, allow_existing=False)
            iam_service.put_user_inline_policy(
                iam_username,
                self._external_access_policy_name,
                self._external_access_policy(metadata.bucket_name, permission),
            )
            new_key = iam_service.create_access_key(iam_username)
            credential = PortalExternalAccessCredential(
                account_id=access.account.id,
                storage_space_metadata_id=metadata.id,
                bucket_name=metadata.bucket_name,
                created_by_user_id=user.id,
                external_email=external_email,
                permission=permission,
                iam_user_id=iam_user.user_id or iam_user.arn or iam_username,
                iam_username=iam_user.name or iam_username,
                access_key_id=new_key.access_key_id,
                status=new_key.status or "Active",
            )
            self.db.add(credential)
            self.db.flush()
            self._sync_storage_space_bucket_policy(access.account, metadata.bucket_name, metadata)
            self.db.commit()
            self.db.refresh(credential)
        except Exception:
            self.db.rollback()
            if new_key is not None:
                try:
                    iam_service.delete_access_key(iam_username, new_key.access_key_id)
                except Exception as exc:  # pragma: no cover - defensive
                    logger.warning("Unable to clean external access key %s: %s", new_key.access_key_id, exc)
            if iam_user is not None:
                try:
                    iam_service.delete_user_inline_policy(iam_username, self._external_access_policy_name)
                    iam_service.delete_user(iam_username)
                except Exception as exc:  # pragma: no cover - defensive
                    logger.warning("Unable to clean external IAM user %s: %s", iam_username, exc)
            raise
        return portal_access_key_from_external_credential(
            credential,
            storage_space_name=self._display_storage_space_name(metadata.bucket_name, metadata),
            secret_access_key=new_key.secret_access_key if new_key else None,
        )

    def get_portal_access_key(self, user: User, access: "AccountAccess") -> PortalAccessKey:
        link = self._existing_portal_link(user, access.account)
        if not link or not link.iam_username:
            raise RuntimeError("Portal IAM identity is not provisioned for this user.")
        iam_service = self._get_iam_service(access.account)
        if not iam_service.get_user(link.iam_username):
            raise RuntimeError("Portal IAM user is missing. Re-run portal bootstrap.")
        if not link.active_access_key or not link.active_secret_key:
            raise RuntimeError("Portal access key is not provisioned for this user.")
        metas = iam_service.list_access_keys(link.iam_username)
        meta = next((item for item in metas if item.access_key_id == link.active_access_key), None)
        if meta is None:
            raise RuntimeError("Portal access key is missing in IAM. Re-run portal bootstrap.")
        return portal_access_key_from_iam_metadata(
            meta,
            is_portal=True,
            deletable=False,
            secret_access_key=link.active_secret_key,
        )

    def bootstrap_portal_identity(self, user: User, access: "AccountAccess") -> PortalState:
        account = access.account
        iam_service = self._get_iam_service(account)
        link, _, created = self._ensure_portal_user(user, account, iam_service)
        portal_settings = self._effective_portal_settings(account)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        self._ensure_policy_and_key(link, iam_service)
        state = self.get_state(user, access)
        state.just_created = created
        return state

    def rotate_portal_key(self, user: User, access: "AccountAccess") -> PortalAccessKey:
        iam_service = self._get_iam_service(access.account)
        link, _, _ = self._ensure_portal_user(user, access.account, iam_service)
        portal_settings = self._effective_portal_settings(access.account)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        new_key = iam_service.create_access_key(link.iam_username)
        previous_active = link.active_access_key
        portal_key = self._persist_portal_key(link, new_key)
        if previous_active:
            try:
                iam_service.update_access_key_status(link.iam_username, previous_active, "Inactive")
                logger.info("Previous portal key %s disabled after renewal", previous_active)
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Unable to disable previous portal key %s: %s", previous_active, exc)
        return portal_key

    def update_access_key_status(self, user: User, access: "AccountAccess", access_key_id: str, active: bool) -> PortalAccessKey:
        portal_settings = self._ensure_access_key_management_allowed(access)
        iam_service = self._get_iam_service(access.account)
        external = self._find_external_credential(user, access.account, access_key_id)
        if external is not None:
            status_value = "Active" if active else "Inactive"
            iam_service.update_access_key_status(external.iam_username, access_key_id, status_value)
            external.status = status_value
            external.updated_at = utcnow()
            self.db.add(external)
            self.db.flush()
            metadata = external.storage_space
            if metadata is not None:
                self._sync_storage_space_bucket_policy(access.account, external.bucket_name, metadata)
            self.db.commit()
            self.db.refresh(external)
            return portal_access_key_from_external_credential(
                external,
                storage_space_name=self._display_storage_space_name(external.bucket_name, metadata),
            )
        link, _, _ = self._ensure_portal_user(user, access.account, iam_service)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        if access_key_id == link.active_access_key:
            raise PortalAccessKeyProtected("Cannot update the portal access key")
        status_value = "Active" if active else "Inactive"
        iam_service.update_access_key_status(link.iam_username, access_key_id, status_value)
        metas = iam_service.list_access_keys(link.iam_username)
        meta = next((m for m in metas if m.access_key_id == access_key_id), None)
        if meta is None:
            raise RuntimeError("Clé introuvable après mise à jour")
        return portal_access_key_from_iam_metadata(
            meta,
            is_portal=False,
            deletable=True,
            active_default=active,
            status=meta.status or status_value,
        )

    def delete_access_key(self, user: User, access: "AccountAccess", access_key_id: str) -> Optional[PortalAccessKey]:
        portal_settings = self._ensure_access_key_management_allowed(access)
        iam_service = self._get_iam_service(access.account)
        external = self._find_external_credential(user, access.account, access_key_id)
        if external is not None:
            metadata = external.storage_space
            deleted = portal_access_key_from_external_credential(
                external,
                storage_space_name=self._display_storage_space_name(external.bucket_name, metadata),
            )
            iam_service.delete_access_key(external.iam_username, access_key_id)
            try:
                iam_service.delete_user_inline_policy(external.iam_username, self._external_access_policy_name)
                iam_service.delete_user(external.iam_username)
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Unable to delete external IAM user %s: %s", external.iam_username, exc)
            external.status = "Inactive"
            external.revoked_at = utcnow()
            external.updated_at = utcnow()
            self.db.add(external)
            self.db.flush()
            if metadata is not None:
                self._sync_storage_space_bucket_policy(access.account, external.bucket_name, metadata)
            self.db.commit()
            return deleted
        link, _, _ = self._ensure_portal_user(user, access.account, iam_service)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        if access_key_id == link.active_access_key:
            raise PortalAccessKeyProtected("Cannot delete the portal access key")
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        iam_service.delete_access_key(link.iam_username, access_key_id)
        return None
