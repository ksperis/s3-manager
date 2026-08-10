# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
import random
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db import (
    AccountIAMUser,
    AuditLog,
    S3Account,
    StorageEndpoint,
    StorageProvider,
    UiGroup,
    UiGroupS3Account,
    User,
    UserRole,
    UserS3Account,
    UserUiGroup,
    is_admin_ui_role,
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
from app.services.rgw_admin import RGWAdminClient, get_rgw_admin_client, RGWAdminError
from app.services.tags_service import TagsService
from app.services.ui_group_avatar_service import UiGroupAvatarService
from app.services.user_avatar_service import UserAvatarService
from app.utils.storage_endpoint_features import (
    features_to_capabilities,
    normalize_features_config,
    resolve_admin_endpoint,
    resolve_feature_flags,
)
from app.utils.rgw_identifiers import normalize_rgw_identifier, resolve_admin_uid
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.usage_stats import extract_usage_stats
from app.utils.quota_stats import bytes_to_gb, extract_positive_limit, extract_quota_limits
from app.utils.size_units import size_to_bytes
from app.utils.name_ordering import name_order_by
from app.utils.account_roles import require_account_role
from app.utils.time import utcnow


logger = logging.getLogger(__name__)


class S3AccountsService:
    _ROOT_UID_SUFFIX = "-admin"

    def __init__(self, db: Session) -> None:
        self.db = db
        self.tags = TagsService(db)
        self._topics_cache: dict[tuple[int, str], tuple[Optional[int], Optional[list[str]]]] = {}
        self._topics_global_cache: dict[int, Optional[dict[str, list[str]]]] = {}

    def _endpoint_capabilities(self, endpoint: StorageEndpoint) -> dict[str, bool]:
        features = normalize_features_config(endpoint.provider, endpoint.features_config)
        return features_to_capabilities(features)

    def _resolve_storage_endpoint(self, storage_endpoint_id: int, require_ceph: bool = False) -> StorageEndpoint:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == storage_endpoint_id).first()
        if not endpoint:
            raise ValueError("Storage endpoint not found.")
        if require_ceph and StorageProvider(str(endpoint.provider)) != StorageProvider.CEPH:
            raise ValueError("This endpoint is not a Ceph endpoint.")
        return endpoint

    def _admin_for_endpoint(self, endpoint: StorageEndpoint, allow_missing: bool = False) -> Optional[RGWAdminClient]:
        if StorageProvider(str(endpoint.provider)) != StorageProvider.CEPH:
            if allow_missing:
                return None
            raise ValueError("This endpoint does not support Ceph admin operations.")
        admin_endpoint = resolve_admin_endpoint(endpoint)
        if not admin_endpoint:
            if allow_missing:
                return None
            raise ValueError("Admin operations are disabled for this endpoint.")
        try:
            return get_rgw_admin_client(
                access_key=endpoint.admin_access_key,
                secret_key=endpoint.admin_secret_key,
                endpoint=admin_endpoint,
                region=endpoint.region,
                verify_tls=bool(getattr(endpoint, "verify_tls", True)),
            )
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
        if not account.rgw_account_id:
            raise ValueError("RGW account ID is missing; cannot apply quotas.")
        admin = self._admin_for_account(account)
        try:
            max_size_bytes = size_to_bytes(max_size_gb, max_size_unit)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
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

    def _account_usage(self, acc: S3Account) -> tuple[Optional[int], Optional[int], Optional[int]]:
        endpoint = self._resolve_storage_endpoint(acc.storage_endpoint_id)
        if not resolve_feature_flags(endpoint).metrics_enabled:
            return None, None, None
        admin = self._admin_for_account(acc, allow_missing=True)
        if not admin:
            return None, None, None
        uid = resolve_admin_uid(acc.rgw_account_id, acc.rgw_user_uid)
        if not uid:
            return None, None, None
        try:
            payload = admin.get_all_buckets(uid=uid, with_stats=True)
        except RGWAdminError as exc:
            logger.warning("Unable to list buckets for account %s: %s", acc.rgw_account_id or acc.id, exc)
            return None, None, None
        buckets = extract_bucket_list(payload)
        bucket_count: int = len(buckets)
        total_bytes: int = 0
        total_objects: int = 0
        has_any = False
        has_objects = False
        for b in buckets:
            usage = b.get("usage") if isinstance(b, dict) else None
            usage_bytes, usage_objects = extract_usage_stats(usage)
            if usage_bytes is not None:
                total_bytes += usage_bytes
                has_any = True
            if usage_objects is not None:
                total_objects += usage_objects
                has_objects = True
        return (
            total_bytes if has_any else None,
            total_objects if has_objects else None,
            bucket_count,
        )

    def get_account_usage(self, account: S3Account) -> tuple[Optional[int], Optional[int], Optional[int]]:
        return self._account_usage(account)

    def _account_quota(
        self,
        acc: S3Account,
        admin: Optional[RGWAdminClient] = None,
    ) -> tuple[Optional[float], Optional[int]]:
        if not acc.rgw_account_id:
            return None, None
        rgw_admin = admin or self._admin_for_account(acc, allow_missing=True)
        if not rgw_admin:
            return None, None
        try:
            max_size_bytes, max_objects = rgw_admin.get_account_quota(acc.rgw_account_id)
        except RGWAdminError as exc:
            logger.warning("Unable to fetch account quota for %s: %s", acc.rgw_account_id, exc)
            return None, None
        return bytes_to_gb(max_size_bytes), max_objects

    def get_account_quota(self, account: S3Account) -> tuple[Optional[float], Optional[int]]:
        return self._account_quota(account)

    def get_account_limits(
        self,
        account: S3Account,
    ) -> tuple[Optional[float], Optional[int], Optional[int], Optional[int], Optional[int], Optional[int]]:
        if not account.rgw_account_id:
            return None, None, None, None, None, None
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
        if max_size_bytes is None and max_objects is None:
            try:
                max_size_bytes, max_objects = rgw_admin.get_account_quota(account.rgw_account_id)
            except RGWAdminError as exc:
                logger.warning("Unable to fetch account quota fallback for %s: %s", account.rgw_account_id, exc)
        return (
            bytes_to_gb(max_size_bytes),
            max_objects,
            extract_positive_limit(payload, "max_buckets"),
            extract_positive_limit(payload, "max_users"),
            extract_positive_limit(payload, "max_roles"),
            extract_positive_limit(payload, "max_groups"),
        )

    def _normalize_account_key(self, account_id: Optional[str]) -> Optional[str]:
        if not account_id:
            return None
        return str(account_id).lower()

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
        return base or "s3-manager admin user"

    def _topic_entry_metadata(self, topic: Any) -> tuple[Optional[str], Optional[str]]:
        name: Optional[str] = None
        account: Optional[str] = None
        arn: Optional[str] = None
        if isinstance(topic, dict):
            name = (
                topic.get("topic")
                or topic.get("name")
                or topic.get("topic_name")
                or topic.get("Topic")
            )
            arn = topic.get("arn") or topic.get("TopicArn") or topic.get("topic_arn")
            account = topic.get("account") or topic.get("account_id") or topic.get("tenant")
        else:
            name = str(topic)
        if arn and not account:
            parts = str(arn).split(":")
            if len(parts) >= 5:
                account = parts[4] or account
        if name and not account and ":" in name:
            prefix = name.split(":", 1)[0]
            if prefix.upper().startswith("RGW"):
                account = prefix
        if not name and arn:
            name = arn
        return (str(name) if name else None, str(account) if account else None)

    def _topics_from_response(self, topics: Optional[list[Any]]) -> Optional[tuple[int, list[str]]]:
        if topics is None:
            return None
        names: list[str] = []
        for topic in topics:
            name, _ = self._topic_entry_metadata(topic)
            if name:
                names.append(name)
        deduped = sorted(set(names))
        return (len(deduped), deduped)

    def _all_topics_by_account(
        self,
        admin: RGWAdminClient,
        storage_endpoint_id: int,
    ) -> Optional[dict[str, list[str]]]:
        if storage_endpoint_id in self._topics_global_cache:
            return self._topics_global_cache[storage_endpoint_id]
        try:
            topics = admin.list_topics(None)
        except RGWAdminError as exc:
            logger.debug("Unable to list global topics: %s", exc)
            self._topics_global_cache[storage_endpoint_id] = None
            return None
        if topics is None:
            self._topics_global_cache[storage_endpoint_id] = None
            return None
        mapping: dict[str, list[str]] = {}
        for topic in topics:
            name, account = self._topic_entry_metadata(topic)
            norm_key = self._normalize_account_key(account)
            if not norm_key or not name:
                continue
            mapping.setdefault(norm_key, []).append(name)
        for key in list(mapping.keys()):
            mapping[key] = sorted(set(mapping[key]))
        self._topics_global_cache[storage_endpoint_id] = mapping
        return mapping

    def _account_topics_info(
        self,
        account_identifier: Optional[str],
        admin: Optional[RGWAdminClient],
        storage_endpoint_id: int,
    ) -> tuple[Optional[int], Optional[list[str]]]:
        if not account_identifier or not admin:
            return None, None
        normalized_key = self._normalize_account_key(account_identifier)
        if not normalized_key:
            return None, None
        cache_key = (storage_endpoint_id, normalized_key)
        cached = self._topics_cache.get(cache_key)
        if cached is not None:
            return cached
        topics_response: Optional[list[Any]]
        topics_response = None
        try:
            topics_response = admin.list_topics(account_identifier)
        except RGWAdminError as exc:
            if any(code in str(exc).lower() for code in ("405", "methodnotallowed")):
                logger.debug("Topic API unavailable for %s: treating as zero topics", account_identifier)
                result = (0, [])
                self._topics_cache[cache_key] = result
                return result
            logger.debug("Unable to list topics for account %s: %s", account_identifier, exc)
        result = self._topics_from_response(topics_response)
        if result is None:
            global_topics = self._all_topics_by_account(admin, storage_endpoint_id)
            if global_topics is not None:
                names = list(global_topics.get(normalized_key, []))
                result = (len(names), names)
            else:
                result = (0, [])
        self._topics_cache[cache_key] = result
        return result

    def _account_rgw_users(
        self,
        account_identifier: Optional[str],
        precomputed_users: Optional[dict[str, list[str]]],
        admin: Optional[RGWAdminClient],
        endpoint_capabilities: Optional[dict[str, bool]] = None,
    ) -> tuple[Optional[int], Optional[list[str]]]:
        normalized_key = self._normalize_account_key(account_identifier)
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

    def _load_non_root_user_links(
        self,
        account_ids: list[int],
    ) -> dict[int, list[AccountUserLink]]:
        if not account_ids:
            return {}
        rows = (
            self.db.query(
                UserS3Account.account_id,
                User,
                UserS3Account.role,
                UserS3Account.allow_manager_browser_data_access,
            )
            .join(User, User.id == UserS3Account.user_id)
            .filter(
                UserS3Account.account_id.in_(account_ids),
                UserS3Account.is_root.is_(False),
            )
            .order_by(UserS3Account.account_id.asc(), User.email.asc(), User.id.asc())
            .all()
        )
        user_links_by_account: dict[int, list[AccountUserLink]] = {}
        avatar_service = UserAvatarService(self.db)
        for account_id, user, role, allow_manager_browser_data_access in rows:
            normalized_account_id = int(account_id)
            normalized_user_id = int(user.id)
            user_links_by_account.setdefault(normalized_account_id, []).append(
                AccountUserLink(
                    user_id=normalized_user_id,
                    role=role,
                    allow_manager_browser_data_access=bool(
                        allow_manager_browser_data_access
                    ),
                    user_email=user.email,
                    user_full_name=user.display_name or user.full_name,
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
                UiGroupS3Account.role,
                UiGroupS3Account.allow_manager_browser_data_access,
            )
            .join(UiGroup, UiGroup.id == UiGroupS3Account.group_id)
            .filter(UiGroupS3Account.account_id.in_(account_ids))
            .order_by(UiGroupS3Account.account_id.asc(), UiGroup.name.asc(), UiGroup.id.asc())
            .all()
        )
        group_links_by_account: dict[int, list[AccountGroupLink]] = {}
        avatar_service = UiGroupAvatarService(self.db)
        for account_id, group, role, allow_manager_browser_data_access in rows:
            normalized_account_id = int(account_id)
            normalized_group_id = int(group.id)
            group_links_by_account.setdefault(normalized_account_id, []).append(
                AccountGroupLink(
                    group_id=normalized_group_id,
                    group_name=group.name,
                    group_avatar=avatar_service.descriptor(group),
                    role=role,
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
        user_links_by_account = self._load_non_root_user_links(account_ids)
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
                used_bytes, used_objects, bucket_count = self._account_usage(acc)
            account_identifier = acc.rgw_account_id or str(acc.id)
            admin = None
            if include_quota or include_rgw_details:
                admin = self._admin_for_account(acc, allow_missing=True)
            if include_quota and admin:
                quota_max_size_gb, quota_max_objects = self._account_quota(acc, admin)
            if include_rgw_details and admin:
                rgw_user_count, rgw_user_uids = self._account_rgw_users(
                    account_identifier,
                    None,
                    admin,
                    endpoint_capabilities=endpoint_capabilities,
                )
                rgw_topic_count, rgw_topics = self._account_topics_info(
                    account_identifier,
                    admin,
                    acc.storage_endpoint_id,
                )
            results.append(
                s3_account_from_db(
                    acc,
                    public_id=str(account_identifier),
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
        user_links_by_account = self._load_non_root_user_links(account_ids)
        group_links_by_account = self._load_group_links(account_ids)
        summaries: list[S3AccountSummary] = []
        for acc in db_accounts:
            endpoint = self._resolve_storage_endpoint(acc.storage_endpoint_id)
            summaries.append(
                s3_account_summary_from_db(
                    acc,
                    public_id=acc.rgw_account_id or str(acc.id),
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
        user_links = self._load_non_root_user_links([account.id]).get(account.id, [])
        group_links = self._load_group_links([account.id]).get(account.id, [])
        used_bytes = used_objects = bucket_count = None
        if include_usage:
            used_bytes, used_objects, bucket_count = self._account_usage(account)
        account_identifier = account.rgw_account_id or str(account.id)
        admin = self._admin_for_account(account, allow_missing=True)
        rgw_user_count = rgw_user_uids = rgw_topic_count = rgw_topics = None
        quota_max_size_gb, quota_max_objects = self._account_quota(account, admin)
        endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)
        endpoint_capabilities = self._endpoint_capabilities(endpoint)
        if admin:
            rgw_user_count, rgw_user_uids = self._account_rgw_users(
                account_identifier,
                None,
                admin,
                endpoint_capabilities=endpoint_capabilities,
            )
            rgw_topic_count, rgw_topics = self._account_topics_info(
                account_identifier,
                admin,
                account.storage_endpoint_id,
            )
        return s3_account_from_db(
            account,
            public_id=account_identifier,
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

    def import_accounts(self, imports: list[S3AccountImport]) -> list[S3AccountSchema]:
        created: list[S3AccountSchema] = []
        for item in imports:
            endpoint = self._resolve_storage_endpoint(item.storage_endpoint_id, require_ceph=True)
            admin = self._admin_for_endpoint(endpoint, allow_missing=False)

            # Skip if already present
            if self.db.query(S3Account).filter(S3Account.rgw_account_id == item.rgw_account_id).first():
                continue
            # Validate RGW account id format
            if not item.rgw_account_id.startswith("RGW") or not item.rgw_account_id[3:].isdigit():
                raise ValueError(f"Invalid account id format: {item.rgw_account_id}")
            # Verify account exists in RGW
            rgw_info = admin.get_account(item.rgw_account_id, allow_not_found=True)
            if not rgw_info or rgw_info.get("not_found"):
                raise ValueError(f"S3Account {item.rgw_account_id} not found in RGW")
            account_name = rgw_info.get("name") or item.name or item.rgw_account_id
            # We do not create the account in RGW (assumed existing); ensure root user keys
            root_uid = self._root_uid(item.rgw_account_id)
            root_display = self._root_display_name(account_name, item.rgw_account_id)
            access_key = None
            secret_key = None
            existing_root = None
            for tenant in (item.rgw_account_id, None):
                if existing_root:
                    break
                try:
                    existing_root = admin.get_user(root_uid, tenant=tenant, allow_not_found=True)
                except RGWAdminError:
                    existing_root = None
            keys = admin._extract_keys(existing_root or {})
            access_key = access_key or (keys[0].get("access_key") if keys else None)
            secret_key = secret_key or (keys[0].get("secret_key") if keys else None)
            if not existing_root:
                resp = admin.create_user_with_account_id(
                    uid=root_uid,
                    account_id=item.rgw_account_id,
                    display_name=root_display,
                    account_root=True,
                )
                keys = admin._extract_keys(resp)
                access_key = access_key or (keys[0].get("access_key") if keys else None)
                secret_key = secret_key or (keys[0].get("secret_key") if keys else None)
                if not access_key or not secret_key:
                    try:
                        existing_root = admin.get_user(root_uid, tenant=item.rgw_account_id, allow_not_found=True)
                    except RGWAdminError:
                        existing_root = None
                    keys = admin._extract_keys(existing_root or {})
                    access_key = access_key or (keys[0].get("access_key") if keys else None)
                    secret_key = secret_key or (keys[0].get("secret_key") if keys else None)
            if not access_key or not secret_key:
                try:
                    resp = admin.create_access_key(
                        root_uid,
                        tenant=item.rgw_account_id,
                        key_name="s3-manager",
                    )
                    keys = admin._extract_keys(resp)
                    access_key = access_key or (keys[0].get("access_key") if keys else None)
                    secret_key = secret_key or (keys[0].get("secret_key") if keys else None)
                except RGWAdminError:
                    pass
            if not access_key or not secret_key:
                raise ValueError(f"Unable to obtain root keys for account {item.rgw_account_id}")
            account = S3Account(
                name=account_name,
                rgw_account_id=item.rgw_account_id,
                rgw_access_key=access_key,
                rgw_secret_key=secret_key,
                rgw_user_uid=root_uid,
                email=item.email,
                storage_endpoint_id=endpoint.id,
            )
            self.db.add(account)
            self.db.flush()
            created.append(
                s3_account_from_db(
                    account,
                    public_id=str(account.id),
                    quota_max_size_gb=None,
                    quota_max_objects=None,
                    user_links=[],
                    group_links=[],
                    storage_endpoint=endpoint,
                    storage_endpoint_capabilities=self._endpoint_capabilities(endpoint),
                    tags=[],
                )
            )
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
        root_keys = admin._extract_keys(root_user_resp)
        access_key = root_keys[0].get("access_key") if root_keys else None
        secret_key = root_keys[0].get("secret_key") if root_keys else None
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
        quota_max_size_gb, quota_max_objects = self._account_quota(account, admin)

        self.db.commit()
        self.db.refresh(account)
        return s3_account_from_db(
            account,
            public_id=str(account.id),
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

        affected_portal_user_ids: set[int] = set()
        if payload.user_links is not None:
            affected_portal_user_ids.update(
                row[0]
                for row in self.db.query(UserS3Account.user_id)
                .filter(UserS3Account.account_id == account.id, UserS3Account.is_root.is_(False))
                .all()
            )
            affected_portal_user_ids.update(int(link.user_id) for link in payload.user_links)
        if payload.group_links is not None:
            affected_group_ids = {
                row[0]
                for row in self.db.query(UiGroupS3Account.group_id)
                .filter(UiGroupS3Account.account_id == account.id)
                .all()
            }
            affected_group_ids.update(int(link.group_id) for link in payload.group_links)
            if affected_group_ids:
                affected_portal_user_ids.update(
                    row[0]
                    for row in self.db.query(UserUiGroup.user_id)
                    .filter(UserUiGroup.group_id.in_(affected_group_ids))
                    .all()
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
                    StorageProvider(str(endpoint.provider)) == StorageProvider.CEPH
                    and resolve_feature_flags(endpoint).admin_enabled
                ):
                    self._apply_account_quota(
                        account,
                        payload.quota_max_size_gb,
                        payload.quota_max_objects,
                        payload.quota_max_size_unit,
                    )

        # Update UI user associations (non-root links only)
        if payload.user_links is not None:
            desired_links = payload.user_links

            existing_links = (
                self.db.query(UserS3Account)
                .filter(UserS3Account.account_id == account.id, UserS3Account.is_root.is_(False))
                .all()
            )
            existing_by_user = {link.user_id: link for link in existing_links}
            desired_ids = {int(link.user_id) for link in desired_links}

            to_remove = set(existing_by_user.keys()) - desired_ids
            if to_remove:
                (
                    self.db.query(UserS3Account)
                    .filter(
                        UserS3Account.account_id == account.id,
                        UserS3Account.user_id.in_(to_remove),
                        UserS3Account.is_root.is_(False),
                    )
                    .delete(synchronize_session="fetch")
                )

            for link in desired_links:
                user_id = int(link.user_id)
                db_link = existing_by_user.get(user_id)
                role = require_account_role(link.role)
                if not db_link:
                    user = self.db.query(User).filter(User.id == user_id).first()
                    if not user:
                        raise ValueError(f"User not found: {user_id}")
                    if not is_admin_ui_role(user.role):
                        user.role = UserRole.UI_USER.value
                        self.db.add(user)
                    db_link = UserS3Account(
                        user_id=user_id,
                        account_id=account.id,
                        is_root=False,
                        role=role,
                        allow_manager_browser_data_access=bool(
                            link.allow_manager_browser_data_access
                        ),
                    )
                db_link.role = role
                db_link.allow_manager_browser_data_access = bool(
                    link.allow_manager_browser_data_access
                )
                db_link.updated_at = utcnow()
                self.db.add(db_link)

        if payload.group_links is not None:
            desired_links: dict[int, AccountGroupLink] = {}
            for link in payload.group_links:
                group_id = int(link.group_id)
                desired_links[group_id] = AccountGroupLink(
                    group_id=group_id,
                    role=require_account_role(link.role),
                    allow_manager_browser_data_access=bool(
                        link.allow_manager_browser_data_access
                    ),
                )

            desired_ids = set(desired_links)
            if desired_ids:
                found = {row[0] for row in self.db.query(UiGroup.id).filter(UiGroup.id.in_(desired_ids)).all()}
                missing = desired_ids - found
                if missing:
                    missing_str = ", ".join(str(mid) for mid in sorted(missing))
                    raise ValueError(f"UI groups not found: {missing_str}")

            existing_links = self.db.query(UiGroupS3Account).filter(UiGroupS3Account.account_id == account.id).all()
            existing_by_group = {link.group_id: link for link in existing_links}
            for group_id in set(existing_by_group) - desired_ids:
                self.db.delete(existing_by_group[group_id])
            for group_id, link in desired_links.items():
                db_link = existing_by_group.get(group_id)
                if db_link is None:
                    db_link = UiGroupS3Account(
                        group_id=group_id,
                        account_id=account.id,
                        role=link.role,
                        allow_manager_browser_data_access=bool(
                            link.allow_manager_browser_data_access
                        ),
                    )
                db_link.role = require_account_role(link.role)
                db_link.allow_manager_browser_data_access = bool(
                    link.allow_manager_browser_data_access
                )
                db_link.updated_at = utcnow()
                self.db.add(db_link)

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

        user_links = self._load_non_root_user_links([account.id]).get(account.id, [])
        group_links = self._load_group_links([account.id]).get(account.id, [])
        endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)
        quota_max_size_gb, quota_max_objects = self._account_quota(account)

        return s3_account_from_db(
            account,
            public_id=str(account.id),
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
            if not account.rgw_account_id:
                raise ValueError("Unable to delete RGW tenant: rgw_account_id is missing for this account.")
            admin = self._admin_for_account(account, allow_missing=False)
            account_identifier = account.rgw_account_id
            endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)
            endpoint_capabilities = self._endpoint_capabilities(endpoint)

            # Safety: only allow RGW deletion when we can prove the tenant is empty.
            _, _, bucket_count = self._account_usage(account)
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
            rgw_topic_count, _ = self._account_topics_info(
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

            self._delete_root_user(account, required=True)
            try:
                admin.delete_account(account_identifier)
            except RGWAdminError as exc:
                raise ValueError(f"Unable to delete RGW account {account_identifier}: {exc}") from exc
        self._remove_account_entry(account)

    def unlink_account(self, account_id: int) -> None:
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise ValueError("S3Account not found")
        if account.rgw_account_id:
            self._delete_root_user(account, required=True)
        self._remove_account_entry(account)

    def _delete_root_user(self, account: S3Account, required: bool) -> None:
        if not account.rgw_account_id:
            if required:
                raise ValueError("RGW account ID is missing; cannot delete the root user.")
            return
        rgw_id = account.rgw_account_id
        candidate_uids = [self._root_uid(rgw_id)]
        last_error: Optional[str] = None
        admin = self._admin_for_account(account, allow_missing=False)
        for candidate_uid in candidate_uids:
            try:
                admin.delete_user(candidate_uid, tenant=None)
                logger.debug("Deleted RGW root user %s", candidate_uid)
                return
            except RGWAdminError as exc:
                last_error = str(exc)
                logger.debug("Unable to delete RGW root user %s: %s", candidate_uid, exc)
        if required:
            raise ValueError(
                f"Unable to delete RGW root user {candidate_uids[0]} for account {account.id}: {last_error or 'unknown error'}"
            )

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
        self.tags.cleanup_orphan_definitions()
        self.db.commit()


def get_s3_accounts_service(db: Session) -> S3AccountsService:
    return S3AccountsService(db)
