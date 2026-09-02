# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from dataclasses import dataclass
import logging
import random
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import (
    AccountIAMUser,
    AuditLog,
    S3Account,
    StorageEndpoint,
    StorageProvider,
    UiGroup,
    UiGroupS3Account,
    User,
    UserS3Account,
)
from app.models.s3_account import (
    AccountGroupLink,
    AccountUserLink,
    S3Account as S3AccountSchema,
    S3AccountCreate,
    S3AccountImport,
    S3AccountSummary,
    S3AccountUpdate,
)
from app.services.mappers.s3_account import s3_account_from_db, s3_account_summary_from_db
from app.services.portal_role_sync import (
    capture_effective_portal_roles,
    sync_portal_role_downgrades,
    sync_portal_role_promotions,
)
from app.services.resource_deletion_purge_service import ResourceDeletionPurgeService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_account_topics_resolver import (
    RgwAccountTopicsResolver,
    normalize_account_key,
)
from app.services.rgw_endpoint_clients import get_endpoint_admin_rgw_client
from app.services.rgw_user_key_parser import RgwUserKeyParser
from app.services.s3_account_associations_service import S3AccountAssociationsService
from app.services.tags_service import TagsService
from app.utils.tagging import TAG_DOMAIN_ADMIN_MANAGED
from app.services.ui_group_avatar_service import UiGroupAvatarService
from app.services.user_avatar_service import UserAvatarService
from app.utils.storage_endpoint_features import (
    features_to_capabilities,
    normalize_features_config,
    resolve_admin_endpoint,
    resolve_feature_flags,
)
from app.utils.rgw_identifiers import normalize_rgw_identifier
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.usage_stats import aggregate_bucket_usage
from app.utils.quota_stats import bytes_to_gb, extract_positive_limit, extract_quota_limits
from app.utils.size_units import size_to_bytes
from app.utils.name_ordering import name_order_by
from app.utils.normalize import normalize_storage_provider


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _PreparedAccountImport:
    source: S3AccountImport
    endpoint: StorageEndpoint
    admin: RGWAdminClient
    account_name: str
    root_uid: str
    root_display_name: str


class S3AccountsService:
    _ROOT_UID_SUFFIX = "-admin"

    def __init__(self, db: Session) -> None:
        self.db = db
        self.tags = TagsService(db)
        self.account_topics = RgwAccountTopicsResolver()

    def _endpoint_capabilities(self, endpoint: StorageEndpoint) -> dict[str, bool]:
        features = normalize_features_config(endpoint.provider, endpoint.features_config)
        return features_to_capabilities(features)

    def _resolve_storage_endpoint(self, storage_endpoint_id: int, require_ceph: bool = False) -> StorageEndpoint:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == storage_endpoint_id).first()
        if not endpoint:
            raise ValueError("Storage endpoint not found.")
        if (
            require_ceph
            and normalize_storage_provider(endpoint.provider) != StorageProvider.CEPH
        ):
            raise ValueError("This endpoint is not a Ceph endpoint.")
        return endpoint

    def _admin_for_endpoint(self, endpoint: StorageEndpoint, allow_missing: bool = False) -> Optional[RGWAdminClient]:
        if (
            normalize_storage_provider(endpoint.provider)
            != StorageProvider.CEPH
        ):
            if allow_missing:
                return None
            raise ValueError("This endpoint does not support Ceph admin operations.")
        admin_endpoint = resolve_admin_endpoint(endpoint)
        if not admin_endpoint:
            if allow_missing:
                return None
            raise ValueError("Admin operations are disabled for this endpoint.")
        try:
            return get_endpoint_admin_rgw_client(endpoint)
        except Exception as exc:
            if allow_missing:
                logger.warning("Unable to build RGW admin client for endpoint %s: %s", endpoint.name, exc)
                return None
            raise

    def _admin_for_account(self, account: S3Account, allow_missing: bool = False) -> Optional[RGWAdminClient]:
        endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)
        return self._admin_for_endpoint(endpoint, allow_missing=allow_missing)

    def _apply_account_quota(
        self,
        account: S3Account,
        max_size_gb: Optional[float],
        max_objects: Optional[int],
        max_size_unit: Optional[str] = None,
    ) -> None:
        admin = self._admin_for_account(account)
        try:
            max_size_bytes = size_to_bytes(max_size_gb, max_size_unit)
        except ValueError as exc:
            raise ValueError(sanitized_error_log_detail(exc)) from exc
        enabled = max_size_bytes is not None or max_objects is not None
        try:
            response = admin.set_account_quota(
                account_id=account.rgw_account_id,
                max_size_bytes=max_size_bytes,
                max_objects=max_objects,
                enabled=enabled,
            )
        except RGWAdminError as exc:
            raise ValueError(f"RGW account quota update failed: {exc}") from exc
        if response.get("not_found"):
            raise ValueError(f"RGW account not found for quota update: {account.rgw_account_id}")
        if response.get("not_implemented"):
            raise ValueError("RGW account quota update is not supported on this cluster.")

    def get_account_usage(self, account: S3Account) -> tuple[Optional[int], Optional[int], Optional[int]]:
        endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)
        if not resolve_feature_flags(endpoint).metrics_enabled:
            return None, None, None
        admin = self._admin_for_account(account, allow_missing=True)
        if not admin:
            return None, None, None
        try:
            payload = admin.get_all_buckets(uid=account.rgw_user_uid, with_stats=True)
        except RGWAdminError as exc:
            logger.warning("Unable to list buckets for account %s: %s", account.rgw_account_id, exc)
            return None, None, None
        return aggregate_bucket_usage(extract_bucket_list(payload))

    def get_account_quota(
        self,
        account: S3Account,
        admin: Optional[RGWAdminClient] = None,
    ) -> tuple[Optional[float], Optional[int]]:
        rgw_admin = admin or self._admin_for_account(account, allow_missing=True)
        if not rgw_admin:
            return None, None
        try:
            max_size_bytes, max_objects = rgw_admin.get_account_quota(account.rgw_account_id)
        except RGWAdminError as exc:
            logger.warning("Unable to fetch account quota for %s: %s", account.rgw_account_id, exc)
            return None, None
        return bytes_to_gb(max_size_bytes), max_objects

    def get_account_limits(
        self,
        account: S3Account,
    ) -> tuple[Optional[float], Optional[int], Optional[int], Optional[int], Optional[int], Optional[int]]:
        rgw_admin = self._admin_for_account(account, allow_missing=True)
        if not rgw_admin:
            return None, None, None, None, None, None
        try:
            payload = rgw_admin.get_account(
                account.rgw_account_id,
                allow_not_found=True,
                allow_not_implemented=True,
            ) or {}
        except RGWAdminError as exc:
            logger.warning("Unable to fetch account limits for %s: %s", account.rgw_account_id, exc)
            return None, None, None, None, None, None
        max_size_bytes, max_objects = extract_quota_limits(payload, keys=("quota", "account_quota"))
        return (
            bytes_to_gb(max_size_bytes),
            max_objects,
            extract_positive_limit(payload, "max_buckets"),
            extract_positive_limit(payload, "max_users"),
            extract_positive_limit(payload, "max_roles"),
            extract_positive_limit(payload, "max_groups"),
        )

    def _root_uid(self, identifier: Any) -> str:
        value = str(identifier or "").strip()
        if not value:
            raise ValueError("Missing account identifier for RGW root user")
        normalized = normalize_rgw_identifier(value)
        if not normalized:
            raise ValueError("Missing account identifier for RGW root user")
        return f"{normalized}{self._ROOT_UID_SUFFIX}"

    def _root_display_name(self, account_name: Optional[str], account_identifier: str) -> str:
        base = (account_name or account_identifier or "").strip()
        return base or "bucketreef admin user"

    def _account_rgw_users(
        self,
        account_identifier: Optional[str],
        precomputed_users: Optional[dict[str, list[str]]],
        admin: Optional[RGWAdminClient],
        endpoint_capabilities: Optional[dict[str, bool]] = None,
    ) -> tuple[Optional[int], Optional[list[str]]]:
        normalized_key = normalize_account_key(account_identifier)
        if not normalized_key:
            return None, None
        if precomputed_users is not None:
            users = list(precomputed_users.get(normalized_key, []))
            return len(users), users
        if not admin:
            return None, None
        if endpoint_capabilities is not None and not endpoint_capabilities.get("account", False):
            return None, None
        try:
            account_info = admin.get_account(
                account_identifier,
                allow_not_found=True,
                allow_not_implemented=True,
            )
        except RGWAdminError as exc:
            logger.debug("Unable to fetch account info for %s: %s", account_identifier, exc)
            return None, None
        if getattr(admin, "account_api_supported", None) is False:
            return None, None
        if not account_info:
            return 0, []
        user_list = account_info.get("user_list") or account_info.get("users")
        if not isinstance(user_list, list):
            return 0, []
        cleaned: list[str] = []
        root_uid = self._root_uid(account_identifier)
        for entry in user_list:
            uid = str(entry) if entry is not None else ""
            if not uid:
                continue
            if uid.lower() == root_uid.lower():
                continue
            cleaned.append(uid)
        deduped = sorted(set(cleaned))
        return len(deduped), deduped

    def _generate_account_id(self) -> str:
        return f"RGW{random.randint(0, 10**17 - 1):017d}"

    def _load_user_links(
        self,
        account_ids: list[int],
    ) -> dict[int, list[AccountUserLink]]:
        if not account_ids:
            return {}
        rows = (
            self.db.query(
                UserS3Account.account_id,
                User,
                UserS3Account.manager_role,
                UserS3Account.portal_role,
                UserS3Account.allow_manager_browser_data_access,
            )
            .join(User, User.id == UserS3Account.user_id)
            .filter(UserS3Account.account_id.in_(account_ids))
            .order_by(UserS3Account.account_id.asc(), User.email.asc(), User.id.asc())
            .all()
        )
        user_links_by_account: dict[int, list[AccountUserLink]] = {}
        avatar_service = UserAvatarService(self.db)
        for account_id, user, manager_role, portal_role, allow_manager_browser_data_access in rows:
            normalized_account_id = int(account_id)
            normalized_user_id = int(user.id)
            user_links_by_account.setdefault(normalized_account_id, []).append(
                AccountUserLink(
                    user_id=normalized_user_id,
                    manager_role=manager_role,
                    portal_role=portal_role,
                    allow_manager_browser_data_access=bool(
                        allow_manager_browser_data_access
                    ),
                    user_email=user.email,
                    user_full_name=user.full_name,
                    user_avatar=avatar_service.descriptor(user),
                )
            )
        return user_links_by_account

    def _load_group_links(
        self,
        account_ids: list[int],
    ) -> dict[int, list[AccountGroupLink]]:
        if not account_ids:
            return {}
        rows = (
            self.db.query(
                UiGroupS3Account.account_id,
                UiGroup,
                UiGroupS3Account.manager_role,
                UiGroupS3Account.portal_role,
                UiGroupS3Account.allow_manager_browser_data_access,
            )
            .join(UiGroup, UiGroup.id == UiGroupS3Account.group_id)
            .filter(UiGroupS3Account.account_id.in_(account_ids))
            .order_by(UiGroupS3Account.account_id.asc(), UiGroup.name.asc(), UiGroup.id.asc())
            .all()
        )
        group_links_by_account: dict[int, list[AccountGroupLink]] = {}
        avatar_service = UiGroupAvatarService(self.db)
        for account_id, group, manager_role, portal_role, allow_manager_browser_data_access in rows:
            normalized_account_id = int(account_id)
            normalized_group_id = int(group.id)
            group_links_by_account.setdefault(normalized_account_id, []).append(
                AccountGroupLink(
                    group_id=normalized_group_id,
                    group_name=group.name,
                    group_avatar=avatar_service.descriptor(group),
                    manager_role=manager_role,
                    portal_role=portal_role,
                    allow_manager_browser_data_access=bool(
                        allow_manager_browser_data_access
                    ),
                )
            )
        return group_links_by_account

    def list_accounts(
        self,
        include_usage_stats: bool = True,
        include_quota: bool = True,
        include_rgw_details: bool = True,
    ) -> list[S3AccountSchema]:
        db_accounts = self.db.query(S3Account).order_by(*name_order_by(S3Account)).all()
        account_ids = [account.id for account in db_accounts]
        user_links_by_account = self._load_user_links(account_ids)
        group_links_by_account = self._load_group_links(account_ids)

        results: list[S3AccountSchema] = []
        for acc in db_accounts:
            endpoint = self._resolve_storage_endpoint(acc.storage_endpoint_id)
            endpoint_capabilities = self._endpoint_capabilities(endpoint)
            used_bytes = None
            used_objects = None
            bucket_count = None
            rgw_user_count = None
            rgw_user_uids = None
            rgw_topic_count = None
            rgw_topics = None
            quota_max_size_gb = None
            quota_max_objects = None
            if include_usage_stats:
                used_bytes, used_objects, bucket_count = self.get_account_usage(acc)
            account_identifier = acc.rgw_account_id
            admin = None
            if include_quota or include_rgw_details:
                admin = self._admin_for_account(acc, allow_missing=True)
            if include_quota and admin:
                quota_max_size_gb, quota_max_objects = self.get_account_quota(acc, admin)
            if include_rgw_details and admin:
                rgw_user_count, rgw_user_uids = self._account_rgw_users(
                    account_identifier,
                    None,
                    admin,
                    endpoint_capabilities=endpoint_capabilities,
                )
                rgw_topic_count, rgw_topics = self.account_topics.resolve(
                    account_identifier,
                    admin,
                    acc.storage_endpoint_id,
                )
            results.append(
                s3_account_from_db(
                    acc,
                    quota_max_size_gb=quota_max_size_gb,
                    quota_max_objects=quota_max_objects,
                    used_bytes=used_bytes,
                    used_objects=used_objects,
                    rgw_user_count=rgw_user_count,
                    rgw_user_uids=rgw_user_uids,
                    rgw_topic_count=rgw_topic_count,
                    rgw_topics=rgw_topics,
                    bucket_count=bucket_count,
                    user_links=user_links_by_account.get(acc.id, []),
                    group_links=group_links_by_account.get(acc.id, []),
                    storage_endpoint=endpoint,
                    storage_endpoint_capabilities=endpoint_capabilities,
                    tags=self.tags.get_account_tags(acc),
                )
            )
        return results

    def list_accounts_minimal(self) -> list[S3AccountSummary]:
        db_accounts = self.db.query(S3Account).order_by(*name_order_by(S3Account)).all()
        account_ids = [account.id for account in db_accounts]
        user_links_by_account = self._load_user_links(account_ids)
        group_links_by_account = self._load_group_links(account_ids)
        summaries: list[S3AccountSummary] = []
        for acc in db_accounts:
            endpoint = self._resolve_storage_endpoint(acc.storage_endpoint_id)
            summaries.append(
                s3_account_summary_from_db(
                    acc,
                    user_links=user_links_by_account.get(acc.id, []),
                    group_links=group_links_by_account.get(acc.id, []),
                    storage_endpoint=endpoint,
                    storage_endpoint_capabilities=self._endpoint_capabilities(endpoint),
                    tags=self.tags.get_account_tags(acc),
                )
            )
        return summaries

    def get_account_detail(self, account_id: int, include_usage: bool = False) -> S3AccountSchema:
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise ValueError("S3Account not found")
        user_links = self._load_user_links([account.id]).get(account.id, [])
        group_links = self._load_group_links([account.id]).get(account.id, [])
        used_bytes = used_objects = bucket_count = None
        if include_usage:
            used_bytes, used_objects, bucket_count = self.get_account_usage(account)
        account_identifier = account.rgw_account_id
        admin = self._admin_for_account(account, allow_missing=True)
        rgw_user_count = rgw_user_uids = rgw_topic_count = rgw_topics = None
        quota_max_size_gb, quota_max_objects = self.get_account_quota(account, admin)
        endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)
        endpoint_capabilities = self._endpoint_capabilities(endpoint)
        if admin:
            rgw_user_count, rgw_user_uids = self._account_rgw_users(
                account_identifier,
                None,
                admin,
                endpoint_capabilities=endpoint_capabilities,
            )
            rgw_topic_count, rgw_topics = self.account_topics.resolve(
                account_identifier,
                admin,
                account.storage_endpoint_id,
            )
        return s3_account_from_db(
            account,
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            used_bytes=used_bytes,
            used_objects=used_objects,
            bucket_count=bucket_count,
            rgw_user_count=rgw_user_count,
            rgw_user_uids=rgw_user_uids,
            rgw_topic_count=rgw_topic_count,
            rgw_topics=rgw_topics,
            user_links=user_links,
            group_links=group_links,
            storage_endpoint=endpoint,
            storage_endpoint_capabilities=endpoint_capabilities,
            tags=self.tags.get_account_tags(account),
        )

    @staticmethod
    def _load_existing_root_user(
        admin: RGWAdminClient,
        root_uid: str,
        account_id: str,
    ) -> Optional[dict[str, Any]]:
        for tenant in (account_id, None):
            try:
                payload = admin.get_user(root_uid, tenant=tenant, allow_not_found=True)
            except RGWAdminError:
                continue
            if payload and not payload.get("not_found"):
                return payload
        return None

    def _prepare_account_imports(self, imports: list[S3AccountImport]) -> list[_PreparedAccountImport]:
        requested_ids = {item.rgw_account_id for item in imports}
        existing_ids = {
            str(row[0])
            for row in self.db.query(S3Account.rgw_account_id)
            .filter(S3Account.rgw_account_id.in_(requested_ids))
            .all()
        }
        seen_ids = set(existing_ids)
        prepared: list[_PreparedAccountImport] = []
        for item in imports:
            if item.rgw_account_id in seen_ids:
                continue
            seen_ids.add(item.rgw_account_id)
            endpoint = self._resolve_storage_endpoint(item.storage_endpoint_id, require_ceph=True)
            admin = self._admin_for_endpoint(endpoint, allow_missing=False)
            if admin is None:
                raise ValueError("Admin operations are disabled for this endpoint.")
            rgw_info = admin.get_account(item.rgw_account_id, allow_not_found=True)
            if not rgw_info or rgw_info.get("not_found"):
                raise ValueError(f"S3Account {item.rgw_account_id} not found in RGW")
            account_name = rgw_info.get("name") or item.name or item.rgw_account_id
            root_uid = self._root_uid(item.rgw_account_id)
            prepared.append(
                _PreparedAccountImport(
                    source=item,
                    endpoint=endpoint,
                    admin=admin,
                    account_name=str(account_name),
                    root_uid=root_uid,
                    root_display_name=self._root_display_name(str(account_name), item.rgw_account_id),
                )
            )

        names = [item.account_name for item in prepared]
        existing_names = {
            str(row[0])
            for row in self.db.query(S3Account.name).filter(S3Account.name.in_(names)).all()
        }
        seen_names = set(existing_names)
        for item in prepared:
            if item.account_name in seen_names:
                raise ValueError(f"S3Account name already exists: {item.account_name}")
            seen_names.add(item.account_name)
        return prepared

    def _obtain_import_root_keys(self, prepared: _PreparedAccountImport) -> tuple[str, str]:
        item = prepared.source
        admin = prepared.admin
        existing_root = self._load_existing_root_user(admin, prepared.root_uid, item.rgw_account_id)
        access_key, secret_key = RgwUserKeyParser.select_complete_credentials(
            admin.extract_keys(existing_root or {})
        )
        if not access_key or not secret_key:
            if not existing_root:
                resp = admin.create_user_with_account_id(
                    uid=prepared.root_uid,
                    account_id=item.rgw_account_id,
                    display_name=prepared.root_display_name,
                    account_root=True,
                )
                access_key, secret_key = RgwUserKeyParser.select_complete_credentials(
                    admin.extract_keys(resp)
                )
                if not access_key or not secret_key:
                    try:
                        existing_root = admin.get_user(
                            prepared.root_uid,
                            tenant=item.rgw_account_id,
                            allow_not_found=True,
                        )
                    except RGWAdminError:
                        existing_root = None
                    access_key, secret_key = RgwUserKeyParser.select_complete_credentials(
                        admin.extract_keys(existing_root or {})
                    )
            if not access_key or not secret_key:
                try:
                    resp = admin.create_access_key(
                        prepared.root_uid,
                        tenant=item.rgw_account_id,
                        key_name="bucketreef",
                    )
                    access_key, secret_key = RgwUserKeyParser.select_complete_credentials(
                        admin.extract_keys(resp)
                    )
                except RGWAdminError:
                    pass
        if not access_key or not secret_key:
            raise ValueError(f"Unable to obtain root keys for account {item.rgw_account_id}")
        return access_key, secret_key

    def import_accounts(self, imports: list[S3AccountImport]) -> list[S3AccountSchema]:
        prepared = self._prepare_account_imports(imports)
        resolved = [
            (item, *self._obtain_import_root_keys(item))
            for item in prepared
        ]
        accounts: list[tuple[S3Account, StorageEndpoint]] = []
        for item, access_key, secret_key in resolved:
            account = S3Account(
                name=item.account_name,
                rgw_account_id=item.source.rgw_account_id,
                rgw_access_key=access_key,
                rgw_secret_key=secret_key,
                rgw_user_uid=item.root_uid,
                email=item.source.email,
                storage_endpoint_id=item.endpoint.id,
            )
            self.db.add(account)
            accounts.append((account, item.endpoint))
        self.db.flush()
        created = [
            s3_account_from_db(
                account,
                quota_max_size_gb=None,
                quota_max_objects=None,
                user_links=[],
                group_links=[],
                storage_endpoint=endpoint,
                storage_endpoint_capabilities=self._endpoint_capabilities(endpoint),
                tags=[],
            )
            for account, endpoint in accounts
        ]
        self.db.commit()
        return created

    def create_account_with_manager(self, payload: S3AccountCreate) -> S3AccountSchema:
        existing = self.db.query(S3Account).filter(S3Account.name == payload.name).first()
        if existing:
            raise ValueError("S3Account already exists")

        endpoint = self._resolve_storage_endpoint(payload.storage_endpoint_id, require_ceph=True)
        endpoint_capabilities = self._endpoint_capabilities(endpoint)
        if not endpoint_capabilities.get("account", False):
            raise ValueError("Selected endpoint does not support RGW account API (/admin/account).")
        admin = self._admin_for_endpoint(endpoint)
        if not admin:
            raise ValueError("Unable to create account: RGW credentials are missing for the selected endpoint.")

        rgw_account_id = self._generate_account_id()
        # Create account in RGW
        try:
            admin.create_account(account_id=rgw_account_id, account_name=payload.name)
            logger.debug("Created RGW account %s (%s)", rgw_account_id, payload.name)
        except RGWAdminError as exc:
            raise ValueError(f"RGW account creation failed: {exc}") from exc

        # Create root user in RGW for this account
        root_uid = self._root_uid(rgw_account_id)
        root_display = self._root_display_name(payload.name, rgw_account_id)
        try:
            root_user_resp = admin.create_user_with_account_id(
                uid=root_uid,
                account_id=rgw_account_id,
                display_name=root_display,
                account_root=True,
            )
        except RGWAdminError as exc:
            raise ValueError(f"RGW root user creation failed: {exc}") from exc
        access_key, secret_key = RgwUserKeyParser.select_complete_credentials(
            admin.extract_keys(root_user_resp)
        )
        if not access_key or not secret_key:
            raise ValueError("Unable to obtain root access/secret keys for account")

        account = S3Account(
            name=payload.name,
            rgw_account_id=rgw_account_id,
            rgw_access_key=access_key,
            rgw_secret_key=secret_key,
            rgw_user_uid=root_uid,
            email=payload.email,
            storage_endpoint_id=endpoint.id,
        )
        self.db.add(account)
        self.db.flush()
        self.tags.replace_account_tags(account, payload.tags)

        if payload.quota_max_size_gb is not None or payload.quota_max_objects is not None:
            self._apply_account_quota(
                account,
                payload.quota_max_size_gb,
                payload.quota_max_objects,
                payload.quota_max_size_unit,
            )
        quota_max_size_gb, quota_max_objects = self.get_account_quota(account, admin)

        self.db.commit()
        self.db.refresh(account)
        return s3_account_from_db(
            account,
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            user_links=[],
            group_links=[],
            storage_endpoint=endpoint,
            storage_endpoint_capabilities=self._endpoint_capabilities(endpoint),
            tags=self.tags.get_account_tags(account),
        )

    def update_account(self, account_id: int, payload: S3AccountUpdate) -> S3AccountSchema:
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise ValueError("S3Account not found")

        associations = S3AccountAssociationsService(self.db)
        affected_portal_user_ids = associations.affected_portal_user_ids(
            account,
            payload,
        )
        portal_roles_before = capture_effective_portal_roles(
            self.db,
            user_ids=affected_portal_user_ids,
            account_ids=[account.id],
        )

        if payload.name:
            account.name = payload.name
        if payload.email is not None:
            account.email = payload.email
        if payload.storage_endpoint_id is not None:
            endpoint = self._resolve_storage_endpoint(payload.storage_endpoint_id, require_ceph=True)
            account.storage_endpoint_id = endpoint.id
        if payload.tags is not None:
            self.tags.replace_account_tags(account, payload.tags)
        if payload.allow_bucket_quota_management is not None:
            account.allow_bucket_quota_management = bool(payload.allow_bucket_quota_management)

        if {"quota_max_size_gb", "quota_max_objects"} & payload.model_fields_set:
            quota_requested = payload.quota_max_size_gb is not None or payload.quota_max_objects is not None
            if quota_requested:
                self._apply_account_quota(
                    account,
                    payload.quota_max_size_gb,
                    payload.quota_max_objects,
                    payload.quota_max_size_unit,
                )
            elif account.rgw_account_id:
                endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)
                if (
                    normalize_storage_provider(endpoint.provider) == StorageProvider.CEPH
                    and resolve_feature_flags(endpoint).admin_enabled
                ):
                    self._apply_account_quota(
                        account,
                        payload.quota_max_size_gb,
                        payload.quota_max_objects,
                        payload.quota_max_size_unit,
                    )

        if payload.user_links is not None:
            associations.set_user_links(account, payload.user_links)

        if payload.group_links is not None:
            associations.set_group_links(account, payload.group_links)

        self.db.add(account)
        self.db.flush()
        portal_roles_after = capture_effective_portal_roles(
            self.db,
            user_ids=affected_portal_user_ids,
            account_ids=[account.id],
        )
        try:
            sync_portal_role_downgrades(
                self.db,
                before=portal_roles_before,
                after=portal_roles_after,
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        sync_portal_role_promotions(
            self.db,
            before=portal_roles_before,
            after=portal_roles_after,
        )
        self.db.refresh(account)

        user_links = self._load_user_links([account.id]).get(account.id, [])
        group_links = self._load_group_links([account.id]).get(account.id, [])
        endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)
        quota_max_size_gb, quota_max_objects = self.get_account_quota(account)

        return s3_account_from_db(
            account,
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            user_links=user_links,
            group_links=group_links,
            storage_endpoint=endpoint,
            storage_endpoint_capabilities=self._endpoint_capabilities(endpoint),
            tags=self.tags.get_account_tags(account),
        )

    def delete_account(self, account_id: int, delete_rgw: bool = False) -> None:
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise ValueError("S3Account not found")
        if delete_rgw:
            admin = self._admin_for_account(account, allow_missing=False)
            account_identifier = account.rgw_account_id
            endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)
            endpoint_capabilities = self._endpoint_capabilities(endpoint)

            # Safety: only allow RGW deletion when we can prove the tenant is empty.
            _, _, bucket_count = self.get_account_usage(account)
            if bucket_count is None:
                raise ValueError("Unable to verify bucket existence; cannot delete the RGW tenant.")
            rgw_user_count, _ = self._account_rgw_users(
                account_identifier,
                None,
                admin,
                endpoint_capabilities=endpoint_capabilities,
            )
            if rgw_user_count is None:
                raise ValueError("Unable to verify RGW users; cannot delete the RGW tenant.")
            rgw_topic_count, _ = self.account_topics.resolve(
                account_identifier,
                admin,
                account.storage_endpoint_id,
            )
            if rgw_topic_count is None:
                raise ValueError("Unable to verify RGW notification topics; cannot delete the RGW tenant.")
            if bucket_count > 0 or rgw_user_count > 0 or rgw_topic_count > 0:
                raise ValueError(
                    f"RGW tenant still has attached resources (buckets={bucket_count}, users={rgw_user_count}, topics={rgw_topic_count}); remove them first."
                )

            self._delete_root_user(account)
            try:
                admin.delete_account(account_identifier)
            except RGWAdminError as exc:
                raise ValueError(f"Unable to delete RGW account {account_identifier}: {exc}") from exc
        self._remove_account_entry(account)

    def unlink_account(self, account_id: int) -> None:
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise ValueError("S3Account not found")
        self._delete_root_user(account)
        self._remove_account_entry(account)

    def _delete_root_user(self, account: S3Account) -> None:
        admin = self._admin_for_account(account, allow_missing=False)
        try:
            admin.delete_user(account.rgw_user_uid, tenant=None)
            logger.debug("Deleted RGW root user %s", account.rgw_user_uid)
        except RGWAdminError as exc:
            logger.debug("Unable to delete RGW root user %s: %s", account.rgw_user_uid, exc)
            raise ValueError(
                f"Unable to delete RGW root user {account.rgw_user_uid} for account {account.id}: {exc}"
            ) from exc

    def _remove_account_entry(self, account: S3Account) -> None:
        self.db.query(AccountIAMUser).filter(AccountIAMUser.account_id == account.id).delete()
        self.db.query(UserS3Account).filter(UserS3Account.account_id == account.id).delete()
        self.db.query(UiGroupS3Account).filter(UiGroupS3Account.account_id == account.id).delete(
            synchronize_session=False
        )
        ResourceDeletionPurgeService(self.db).purge_account_derived_data(account.id)
        (
            self.db.query(AuditLog)
            .filter(AuditLog.account_id == account.id)
            .update({AuditLog.account_id: None}, synchronize_session=False)
        )
        self.db.delete(account)
        self.db.flush()
        self.tags.cleanup_orphan_definitions(
            domain_kinds=[TAG_DOMAIN_ADMIN_MANAGED]
        )
        self.db.commit()


def get_s3_accounts_service(db: Session) -> S3AccountsService:
    return S3AccountsService(db)
