# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *
from app.services.mappers.portal import portal_access_key_from_iam_metadata


class PortalAccessKeysMixin:
    def list_access_keys(self, user: User, access: "AccountAccess") -> list[PortalAccessKey]:
        link = self._existing_portal_link(user, access.account)
        if not link or not link.iam_username:
            return []
        iam_service = self._get_iam_service(access.account)
        if not iam_service.get_user(link.iam_username):
            return []
        return self._list_access_keys(link, iam_service, include_portal=False)

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

    def _ensure_access_key_management_allowed(self, access: "AccountAccess") -> PortalSettings:
        portal_settings = self._effective_portal_settings(access.account)
        if not portal_settings.allow_portal_user_access_key_create:
            raise PortalAccessKeyManagementDisabled("Portal access-key management is disabled for this account.")
        return portal_settings

    def create_access_key(self, user: User, access: "AccountAccess") -> PortalAccessKey:
        portal_settings = self._effective_portal_settings(access.account)
        if not portal_settings.allow_portal_user_access_key_create:
            raise PortalAccessKeyManagementDisabled("Portal access-key management is disabled for this account.")
        iam_service = self._get_iam_service(access.account)
        link, _, _ = self._ensure_portal_user(user, access.account, iam_service)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        existing_user_keys = self._list_access_keys(link, iam_service, include_portal=False)
        if len(existing_user_keys) >= portal_settings.max_portal_user_access_keys:
            raise PortalAccessKeyLimitExceeded(
                f"Maximum IAM user keys reached ({portal_settings.max_portal_user_access_keys}). Delete a key before creating a new one."
            )
        new_key = iam_service.create_access_key(link.iam_username)
        return portal_access_key_from_iam_metadata(
            new_key,
            is_portal=False,
            deletable=True,
            secret_access_key=new_key.secret_access_key,
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

    def delete_access_key(self, user: User, access: "AccountAccess", access_key_id: str) -> None:
        portal_settings = self._ensure_access_key_management_allowed(access)
        iam_service = self._get_iam_service(access.account)
        link, _, _ = self._ensure_portal_user(user, access.account, iam_service)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        if access_key_id == link.active_access_key:
            raise PortalAccessKeyProtected("Cannot delete the portal access key")
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        iam_service.delete_access_key(link.iam_username, access_key_id)
