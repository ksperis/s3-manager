# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
from dataclasses import dataclass

from ._shared import *
from app.services.mappers.portal import portal_access_key_from_iam_metadata


@dataclass
class _ProjectAccessKeyScope:
    scope_id: str
    label: str
    zonegroup_key: Optional[str]
    zonegroup_name: Optional[str]
    authority_account: Optional[S3Account]
    account_links: list[ProjectS3Account]
    unavailable_reason: Optional[str] = None


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
        portal_settings = self._effective_portal_settings_for_access(access)
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

    def _project_zonegroup_key(self, account: S3Account) -> Optional[str]:
        endpoint = getattr(account, "storage_endpoint", None)
        zonegroup = str(getattr(endpoint, "ceph_zonegroup_name", None) or "").strip()
        return zonegroup.lower() if zonegroup else None

    def _project_scope_id(self, zonegroup_key: str) -> str:
        digest = hashlib.sha1(zonegroup_key.encode("utf-8")).hexdigest()[:12]
        return f"zg-{digest}"

    def _project_scope_accounts(self, scope: _ProjectAccessKeyScope) -> list[PortalAccessKeyScopeAccount]:
        accounts: list[PortalAccessKeyScopeAccount] = []
        for link in scope.account_links:
            account = link.account
            if account is None:
                continue
            endpoint = getattr(account, "storage_endpoint", None)
            accounts.append(
                PortalAccessKeyScopeAccount(
                    account_id=account.id,
                    account_name=account.name,
                    display_name=link.display_name,
                    storage_endpoint_id=endpoint.id if endpoint else None,
                    storage_endpoint_name=endpoint.name if endpoint else None,
                    storage_endpoint_url=endpoint.endpoint_url if endpoint else None,
                    storage_endpoint_zonegroup=endpoint.ceph_zonegroup_name if endpoint else None,
                )
            )
        return accounts

    def _project_access_key_scopes(self, access: "PortalProjectAccess") -> list[_ProjectAccessKeyScope]:
        grouped: dict[str, list[ProjectS3Account]] = {}
        zonegroup_names: dict[str, str] = {}
        unavailable: list[_ProjectAccessKeyScope] = []
        for link in access.account_links:
            account = link.account
            if account is None:
                continue
            zonegroup_key = self._project_zonegroup_key(account)
            endpoint = getattr(account, "storage_endpoint", None)
            if not zonegroup_key:
                label = link.display_name or account.name
                unavailable.append(
                    _ProjectAccessKeyScope(
                        scope_id=f"account-{account.id}",
                        label=label,
                        zonegroup_key=None,
                        zonegroup_name=None,
                        authority_account=account,
                        account_links=[link],
                        unavailable_reason="Ceph zonegroup is not configured for this storage location.",
                    )
                )
                continue
            grouped.setdefault(zonegroup_key, []).append(link)
            zonegroup_names.setdefault(zonegroup_key, str(getattr(endpoint, "ceph_zonegroup_name", None) or zonegroup_key))

        scopes: list[_ProjectAccessKeyScope] = []
        for zonegroup_key, links in sorted(grouped.items(), key=lambda item: (zonegroup_names[item[0]].lower(), item[0])):
            authority_link = sorted(
                links,
                key=lambda item: (
                    getattr(getattr(item.account, "storage_endpoint", None), "id", 0) or 0,
                    item.sort_order,
                    item.account_id,
                ),
            )[0]
            zonegroup_name = zonegroup_names[zonegroup_key]
            scopes.append(
                _ProjectAccessKeyScope(
                    scope_id=self._project_scope_id(zonegroup_key),
                    label=zonegroup_name,
                    zonegroup_key=zonegroup_key,
                    zonegroup_name=zonegroup_name,
                    authority_account=authority_link.account,
                    account_links=links,
                )
            )
        return scopes + unavailable

    def _resolve_project_access_key_scope(self, access: "PortalProjectAccess", scope_id: str) -> _ProjectAccessKeyScope:
        for scope in self._project_access_key_scopes(access):
            if scope.scope_id == scope_id:
                return scope
        raise RuntimeError("Access key scope is not available for this project.")

    def _project_portal_settings(self, access: "PortalProjectAccess", authority_account: S3Account) -> PortalSettings:
        return self._effective_portal_settings(
            authority_account,
            admin_override=self._load_project_portal_settings_overrides(access.project),
        )

    def _existing_project_iam_link(
        self,
        user: User,
        project: Project,
        zonegroup_key: str,
    ) -> Optional[ProjectIAMUser]:
        return (
            self.db.query(ProjectIAMUser)
            .filter(
                ProjectIAMUser.user_id == user.id,
                ProjectIAMUser.project_id == project.id,
                ProjectIAMUser.zonegroup_key == zonegroup_key,
            )
            .first()
        )

    def _generate_project_iam_username(self, user: User, project: Project, zonegroup_key: str) -> str:
        digest = hashlib.sha1(zonegroup_key.encode("utf-8")).hexdigest()[:10]
        return f"portal-p{project.id}-zg{digest}-u{user.id}"[:63]

    def _ensure_project_iam_user(
        self,
        user: User,
        access: "PortalProjectAccess",
        scope: _ProjectAccessKeyScope,
        iam_service: RGWIAMService,
    ) -> tuple[ProjectIAMUser, Optional[IAMUser], bool]:
        if not scope.zonegroup_key or scope.authority_account is None:
            raise RuntimeError(scope.unavailable_reason or "Access key scope is not configurable.")
        link = self._existing_project_iam_link(user, access.project, scope.zonegroup_key)
        iam_user: Optional[IAMUser] = None
        created = False
        if link and link.iam_username:
            iam_user = iam_service.get_user(link.iam_username)
        if link is None or iam_user is None:
            username = link.iam_username if link and link.iam_username else self._generate_project_iam_username(user, access.project, scope.zonegroup_key)
            iam_user, _created_key = iam_service.create_user(username, create_key=False, allow_existing=True)
            if link is None:
                link = ProjectIAMUser(
                    user_id=user.id,
                    project_id=access.project.id,
                    zonegroup_key=scope.zonegroup_key,
                    zonegroup_name=scope.zonegroup_name,
                    authority_account_id=scope.authority_account.id,
                    iam_user_id=iam_user.user_id or iam_user.arn or username,
                    iam_username=iam_user.name,
                )
                created = True
            else:
                link.zonegroup_name = scope.zonegroup_name
                link.authority_account_id = scope.authority_account.id
                link.iam_user_id = iam_user.user_id or iam_user.arn or username
                link.iam_username = iam_user.name
            try:
                self.db.add(link)
                self.db.commit()
            except IntegrityError:
                self.db.rollback()
                link = self._existing_project_iam_link(user, access.project, scope.zonegroup_key)
                if link is None:
                    raise
                iam_user = iam_service.get_user(link.iam_username) if link.iam_username else None
            else:
                self.db.refresh(link)
        if link.zonegroup_name != scope.zonegroup_name or link.authority_account_id != scope.authority_account.id:
            link.zonegroup_name = scope.zonegroup_name
            link.authority_account_id = scope.authority_account.id
            self.db.add(link)
            self.db.commit()
            self.db.refresh(link)
        return link, iam_user, created

    def _project_scope_access_by_bucket(
        self,
        user: User,
        access: "PortalProjectAccess",
        scope: _ProjectAccessKeyScope,
    ) -> dict[str, PortalStorageSpaceRole]:
        access_by_bucket: dict[str, PortalStorageSpaceRole] = {}
        for link in scope.account_links:
            if link.account is None:
                continue
            for bucket_name, role in self._db_storage_space_content_access(user, link.account, access.role).items():
                self._merge_storage_space_role(access_by_bucket, bucket_name, role)
        return access_by_bucket

    def _sync_project_scope_iam_projection(
        self,
        user: User,
        access: "PortalProjectAccess",
        scope: _ProjectAccessKeyScope,
        link: ProjectIAMUser,
        iam_service: RGWIAMService,
        portal_settings: PortalSettings,
    ) -> None:
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal project user")
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        access_by_bucket = self._project_scope_access_by_bucket(user, access, scope)
        self._sync_user_storage_space_policy_projection(iam_service, link.iam_username, access_by_bucket)
        for account_link in scope.account_links:
            if account_link.account is not None:
                self._sync_account_storage_space_bucket_policies(account_link.account)

    def _project_scope_to_model(
        self,
        user: User,
        access: "PortalProjectAccess",
        scope: _ProjectAccessKeyScope,
    ) -> PortalAccessKeyScope:
        authority = scope.authority_account
        settings = self._project_portal_settings(access, authority) if authority is not None else self._portal_settings()
        can_manage = bool(settings.allow_portal_user_access_key_create and not scope.unavailable_reason and authority is not None)
        iam_user = None
        access_keys: list[PortalAccessKey] = []
        if authority is not None and scope.zonegroup_key:
            link = self._existing_project_iam_link(user, access.project, scope.zonegroup_key)
            if link and link.iam_username:
                iam_service = self._get_iam_service(authority)
                iam_user = iam_service.get_user(link.iam_username)
                if iam_user:
                    metas = iam_service.list_access_keys(link.iam_username)
                    access_keys = [
                        portal_access_key_from_iam_metadata(meta, is_portal=False, deletable=True)
                        for meta in metas
                    ]
        return PortalAccessKeyScope(
            scope_id=scope.scope_id,
            label=scope.label,
            zonegroup=scope.zonegroup_name,
            s3_endpoint=resolve_s3_endpoint(authority) if authority is not None else None,
            authority_account_id=authority.id if authority is not None else None,
            accounts=self._project_scope_accounts(scope),
            iam_user=PortalIAMUser(
                iam_user_id=getattr(iam_user, "user_id", None),
                iam_username=getattr(iam_user, "name", None),
                arn=getattr(iam_user, "arn", None),
            ),
            access_keys=access_keys,
            can_manage_access_keys=can_manage,
            max_access_keys=settings.max_portal_user_access_keys if can_manage else 0,
            unavailable_reason=scope.unavailable_reason if scope.unavailable_reason else None,
        )

    def get_project_access_keys_state(self, user: User, access: "PortalProjectAccess") -> PortalProjectAccessKeysState:
        return PortalProjectAccessKeysState(
            scopes=[self._project_scope_to_model(user, access, scope) for scope in self._project_access_key_scopes(access)]
        )

    def _ensure_project_access_key_scope_allowed(
        self,
        user: User,
        access: "PortalProjectAccess",
        scope_id: str,
    ) -> tuple[_ProjectAccessKeyScope, PortalSettings, RGWIAMService, ProjectIAMUser]:
        scope = self._resolve_project_access_key_scope(access, scope_id)
        if scope.unavailable_reason or scope.authority_account is None or not scope.zonegroup_key:
            raise PortalAccessKeyManagementDisabled(scope.unavailable_reason or "Access-key scope is not configurable.")
        portal_settings = self._project_portal_settings(access, scope.authority_account)
        if not portal_settings.allow_portal_user_access_key_create:
            raise PortalAccessKeyManagementDisabled("Portal access-key management is disabled for this project.")
        iam_service = self._get_iam_service(scope.authority_account)
        link, _iam_user, _created = self._ensure_project_iam_user(user, access, scope, iam_service)
        self._sync_project_scope_iam_projection(user, access, scope, link, iam_service, portal_settings)
        return scope, portal_settings, iam_service, link

    def create_project_access_key(self, user: User, access: "PortalProjectAccess", scope_id: str) -> PortalAccessKey:
        _scope, portal_settings, iam_service, link = self._ensure_project_access_key_scope_allowed(user, access, scope_id)
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal project user")
        existing_user_keys = iam_service.list_access_keys(link.iam_username)
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

    def update_project_access_key_status(
        self,
        user: User,
        access: "PortalProjectAccess",
        scope_id: str,
        access_key_id: str,
        active: bool,
    ) -> PortalAccessKey:
        _scope, _settings, iam_service, link = self._ensure_project_access_key_scope_allowed(user, access, scope_id)
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal project user")
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

    def delete_project_access_key(
        self,
        user: User,
        access: "PortalProjectAccess",
        scope_id: str,
        access_key_id: str,
    ) -> None:
        _scope, _settings, iam_service, link = self._ensure_project_access_key_scope_allowed(user, access, scope_id)
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal project user")
        iam_service.delete_access_key(link.iam_username, access_key_id)

    def _ensure_access_key_management_allowed(self, access: "AccountAccess") -> PortalSettings:
        portal_settings = self._effective_portal_settings_for_access(access)
        if not portal_settings.allow_portal_user_access_key_create:
            raise PortalAccessKeyManagementDisabled("Portal access-key management is disabled for this account.")
        return portal_settings

    def create_access_key(self, user: User, access: "AccountAccess") -> PortalAccessKey:
        portal_settings = self._effective_portal_settings_for_access(access)
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
        portal_settings = self._effective_portal_settings_for_access(access)
        self._sync_user_group_membership(iam_service, link.iam_username, access.role, portal_settings=portal_settings)
        self._ensure_policy_and_key(link, iam_service)
        state = self.get_state(user, access)
        state.just_created = created
        return state

    def rotate_portal_key(self, user: User, access: "AccountAccess") -> PortalAccessKey:
        iam_service = self._get_iam_service(access.account)
        link, _, _ = self._ensure_portal_user(user, access.account, iam_service)
        portal_settings = self._effective_portal_settings_for_access(access)
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
